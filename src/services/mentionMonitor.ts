/**
 * Arena Mention Monitor Service
 *
 * Periodically checks for new mentions and notifications
 * Tracks replied mentions to prevent duplicate responses
 * Stores in ElizaOS memory for agent decision-making
 */

import type { IAgentRuntime, Memory } from "@elizaos/core";
import { Service } from "@elizaos/core";
import type { ArenaClient } from "../client/arenaClient";
import { filterMentionNotifications, type MentionFilterOptions } from "../utils/mentions";
import type { ArenaNotification } from "../types";

interface MentionMonitorConfig {
  enabled: boolean;
  scanInterval: number; // minutes
  maxAgeHours: number;
  minContentLength: number;
  excludeSpam: boolean;
  storeHistory: boolean;
  maxHistory: number;
}

interface ProcessedMention {
  notificationId: string;
  threadId?: string;
  content: string;
  timestamp: string;
  replied: boolean;
  repliedAt?: string;
}

export class ArenaMentionMonitorService extends Service {
  static serviceType = "arena_mention_monitor";
  capabilityDescription = "Monitors Arena mentions and notifications for the agent";

  protected monitorConfig: MentionMonitorConfig;
  protected client: ArenaClient | null = null;
  protected intervalId: NodeJS.Timeout | null = null;
  protected isRunning = false;

  // In-memory cache of processed mentions for fast lookup
  protected processedMentions = new Set<string>();
  protected repliedThreads = new Set<string>();

  constructor(runtime?: IAgentRuntime) {
    super(runtime);

    this.monitorConfig = {
      enabled: process.env.ARENA_MENTION_MONITOR_ENABLED === "true",
      scanInterval: parseInt(process.env.ARENA_MENTION_SCAN_INTERVAL || "10", 10),
      maxAgeHours: parseInt(process.env.ARENA_MENTION_MAX_AGE_HOURS || "48", 10),
      minContentLength: parseInt(process.env.ARENA_MENTION_MIN_LENGTH || "10", 10),
      excludeSpam: process.env.ARENA_MENTION_EXCLUDE_SPAM !== "false",
      storeHistory: process.env.ARENA_MENTION_STORE_HISTORY !== "false",
      maxHistory: parseInt(process.env.ARENA_MENTION_MAX_HISTORY || "50", 10),
    };
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new ArenaMentionMonitorService(runtime);
    await service.initialize();
    return service;
  }

  private async initialize(): Promise<void> {

    if (!this.monitorConfig.enabled) {
      console.log("[Arena Mention Monitor] Disabled via config");
      return;
    }

    const arenaToken = this.runtime?.getSetting("ARENA_ACCESS_TOKEN") || process.env.ARENA_ACCESS_TOKEN;

    if (!arenaToken) {
      console.warn("[Arena Mention Monitor] No ARENA_ACCESS_TOKEN found, service disabled");
      return;
    }

    const { ArenaClient } = await import("../client/arenaClient");
    this.client = new ArenaClient(arenaToken);

    console.log("[Arena Mention Monitor] Initialized");
    console.log(`  - Scan interval: ${this.monitorConfig.scanInterval} minutes`);
    console.log(`  - Max age: ${this.monitorConfig.maxAgeHours} hours`);

    // Start monitoring if enabled
    if (this.monitorConfig.enabled && this.client) {
      this.startMonitoring();
    }
  }

  private startMonitoring(): void {
    if (this.isRunning) {
      console.log("[Arena Mention Monitor] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[Arena Mention Monitor] Starting...");

    // Schedule periodic scans (don't run immediately to avoid runtime issues)
    const intervalMs = this.monitorConfig.scanInterval * 60 * 1000;

    // Run first scan after a short delay to ensure runtime is ready
    setTimeout(() => {
      // Load processed mentions on first run
      this.loadProcessedMentions().then(() => {
        console.log(`  - Loaded ${this.processedMentions.size} processed mentions`);
        console.log(`  - Loaded ${this.repliedThreads.size} replied threads`);
        // Run first scan
        this.scanMentions().catch(error => {
          console.error("[Arena Mention Monitor] Initial scan error:", error);
        });
      }).catch(error => {
        console.error("[Arena Mention Monitor] Failed to load mentions:", error);
      });
    }, 5000); // 5 second delay for runtime to be ready

    this.intervalId = setInterval(() => {
      this.scanMentions().catch(error => {
        console.error("[Arena Mention Monitor] Scan error:", error);
      });
    }, intervalMs);

    console.log(`[Arena Mention Monitor] Started - first scan in 5 seconds, then every ${this.monitorConfig.scanInterval} minutes`);
  }

  override async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[Arena Mention Monitor] Stopped");
  }

  private async scanMentions(): Promise<void> {
    if (!this.client || !this.runtime) return;

    console.log(`\n[Arena Mention Monitor] 🔍 Scanning for new mentions...`);

    try {
      // Get current user
      const me = await this.client.me();
      const userHandle = me.handle || me.userName || me.id;

      // Fetch notifications (first 2 pages)
      const allNotifications: ArenaNotification[] = [];
      for (let page = 1; page <= 2; page++) {
        try {
          const response = await this.client.getNotifications({ page, pageSize: 50 });
          allNotifications.push(...response.notifications);

          if (response.notifications.length < 50) break;
        } catch (error) {
          console.error(`  ❌ Failed to fetch page ${page}:`, error);
          break;
        }
      }

      console.log(`  📋 Fetched ${allNotifications.length} total notifications`);

      // Filter for mentions AND replies
      const filterOptions: MentionFilterOptions = {
        maxAgeHours: this.monitorConfig.maxAgeHours,
        excludeSpam: this.monitorConfig.excludeSpam,
        minContentLength: this.monitorConfig.minContentLength,
      };

      // Get notifications that mention us
      const mentionNotifications = filterMentionNotifications(
        allNotifications,
        userHandle,
        filterOptions
      );

      // Also get REPLY notifications (people replying to our posts without @mention)
      // These are notifications where:
      // - User replied to one of our threads
      // - Notification text might not include @mention
      const replyNotifications = allNotifications.filter(notif => {
        // Filter criteria similar to mention filter
        if (this.monitorConfig.maxAgeHours > 0 && notif.createdOn) {
          const age = Date.now() - new Date(notif.createdOn).getTime();
          const maxAge = this.monitorConfig.maxAgeHours * 60 * 60 * 1000;
          if (age > maxAge) return false;
        }

        const contentText = notif.text || "";
        if (this.monitorConfig.minContentLength > 0 && contentText.length < this.monitorConfig.minContentLength) {
          return false;
        }

        // Spam filter
        if (this.monitorConfig.excludeSpam && contentText) {
          const lowerContent = contentText.toLowerCase();
          const spamPatterns = [
            /\b(click here|buy now|limited time|act now)\b/i,
            /\b(earn money|make money|get rich)\b/i,
            /\b(dm me|check dm|follow back|f4f)\b/i,
            /(🚀|💰|💸|🎁){4,}/,
          ];
          if (spamPatterns.some(p => p.test(lowerContent))) {
            return false;
          }
        }

        // Check if it's a reply notification
        // Common reply notification patterns:
        // - Title/text contains "replied to your post" or similar
        // - Link points to a reply thread
        const titleLower = (notif.title || "").toLowerCase();
        const textLower = (notif.text || "").toLowerCase();
        const isReply =
          titleLower.includes("replied") ||
          textLower.includes("replied") ||
          titleLower.includes("comment") ||
          (notif.link && notif.link.includes("/nested/"));

        // Don't include if already in mention notifications
        if (mentionNotifications.some(m => m.id === notif.id)) {
          return false;
        }

        return isReply;
      });

      // Combine both types
      const allRelevantNotifications = [...mentionNotifications, ...replyNotifications];

      console.log(`  💬 Found ${mentionNotifications.length} mention notifications + ${replyNotifications.length} reply notifications = ${allRelevantNotifications.length} total`);

      // Filter out already processed mentions/replies
      const newMentions = allRelevantNotifications.filter(
        n => !this.processedMentions.has(n.id)
      );

      console.log(`  ✨ ${newMentions.length} new mentions/replies (not yet processed)`);

      if (newMentions.length > 0) {
        // Store new mentions
        for (const mention of newMentions) {
          await this.storeMention(mention);
        }

        // Emit event for agent to handle (if supported by runtime)
        try {
          (this.runtime as any).emit?.("arena:mentions:new", {
            count: newMentions.length,
            mentions: newMentions,
          });
        } catch {
          // Event emission not supported
        }

        console.log(`  📢 Emitted event with ${newMentions.length} new mentions`);

        // Process mentions and auto-reply
        console.log(`  🤖 Processing ${newMentions.length} mentions for auto-reply...`);
        await this.processMentions(newMentions);
      }

      // Cleanup old mentions
      await this.cleanupOldMentions();

    } catch (error) {
      console.error(`[Arena Mention Monitor] Scan failed:`, error);
    }

    console.log(`[Arena Mention Monitor] ✅ Scan complete\n`);
  }

  private async processMentions(mentions: ArenaNotification[]): Promise<void> {
    if (!this.runtime || !this.client) return;

    for (const mention of mentions) {
      try {
        // Extract thread ID from notification link
        let threadId: string | undefined;

        if (mention.link) {
          const nestedMatch = mention.link.match(/\/nested\/([a-f0-9-]+)/i);
          if (nestedMatch) {
            threadId = nestedMatch[1];
          } else {
            const threadMatch = mention.link.match(/\/thread\/([a-f0-9-]+)/i);
            if (threadMatch) {
              threadId = threadMatch[1];
            } else {
              const uuidMatch = mention.link.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})[^\/]*$/i);
              if (uuidMatch) {
                threadId = uuidMatch[1];
              }
            }
          }
        }

        if (!threadId) {
          console.log(`    ⚠️  No thread ID found in mention: ${mention.id}`);
          console.log(`       Link: ${mention.link || 'N/A'}`);
          continue;
        }

        // Check if already replied
        if (this.hasRepliedToThread(threadId)) {
          console.log(`    ⏭️  Already replied to thread ${threadId}, skipping`);
          continue;
        }

        console.log(`    💬 Processing mention in thread ${threadId}`);

        // Try to get the thread for context (optional)
        let thread = null;
        try {
          thread = await this.client.getThread(threadId);
        } catch (error: any) {
          // Thread might be deleted, not exist, or be inaccessible
          console.log(`    ⚠️  Could not fetch thread ${threadId} (${error.message || 'unknown error'})`);

          // If thread is deleted/not found, we can't reply to it anyway
          // Mark as processed to avoid retrying
          this.processedMentions.add(mention.id);
          console.log(`    ⏭️  Skipping deleted/inaccessible thread`);
          continue;
        }

        // Process the mention through the agent's message system
        const replyText = await this.processAgentMention(mention, thread, threadId);

        if (!replyText) {
          console.log(`    ⚠️  No reply generated for thread ${threadId}`);
          continue;
        }

        console.log(`    ✍️  Generated reply: "${replyText.substring(0, 100)}${replyText.length > 100 ? '...' : ''}"`);

        // Reply to the thread
        await this.client.replyToThread(threadId, replyText);

        // Mark as replied
        await this.markAsReplied(threadId, mention.id);

        console.log(`    ✅ Replied to thread ${threadId}`);

      } catch (error) {
        console.error(`    ❌ Failed to process mention ${mention.id}:`, error);
      }
    }
  }

  private async processAgentMention(mention: ArenaNotification, thread: any | null, threadId: string): Promise<string | null> {
    if (!this.runtime) return null;

    try {
      const { MemoryType } = await import("@elizaos/core");

      // Create a message object for the agent to process
      const mentionText = mention.text || "";
      const threadContent = thread?.content || mentionText;
      const authorHandle = thread?.userHandle || "unknown";
      const userId = mention.userId || thread?.userId || "unknown";

      // Use just the threadId as roomId (cast as UUID)
      const roomId = threadId as import("@elizaos/core").UUID;

      console.log(`    🤖 Processing mention through agent action system...`);
      console.log(`       Message: "${mentionText}"`);
      console.log(`       From: @${authorHandle}`);

      // Ensure room and entities exist in ElizaOS database before processing
      // Validate userId is UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUserId = uuidRegex.test(userId);

      // Use a valid UUID for entity (either real userId or generate one)
      const entityId = isValidUserId ? userId : this.runtime.agentId;

      try {
        // Create room in database
        await this.runtime.ensureRoomExists({
          id: roomId,
          name: `Arena Thread ${threadId.substring(0, 8)}`,
          type: "thread",
          source: "arena",
          metadata: {
            threadId,
            platform: "arena",
            authorHandle,
          },
        } as any);

        // Ensure user entity exists and is a participant
        if (isValidUserId) {
          await this.runtime.ensureConnection({
            entityId: entityId as import("@elizaos/core").UUID,
            roomId,
            userName: authorHandle,
            name: authorHandle,
            source: "arena",
            worldId: this.runtime.agentId, // Use agentId as worldId for Arena
            userId: entityId as import("@elizaos/core").UUID,
          });
        }
      } catch (error) {
        console.log(`    ⚠️  Could not create room/participant (${error instanceof Error ? error.message : 'unknown error'})`);
        // Continue anyway - room might already exist
      }

      // Create a proper Memory object for action processing
      const userMessage: import("@elizaos/core").Memory = {
        entityId: entityId as import("@elizaos/core").UUID,
        agentId: this.runtime.agentId,
        roomId,
        content: {
          text: mentionText,
          source: "arena",
          metadata: {
            threadId,
            threadContent,
            authorHandle,
            notificationId: mention.id,
          },
        },
        metadata: {
          type: MemoryType.MESSAGE,
          source: "arena",
        },
      };

      // Compose state for the agent with full context
      const state = await this.runtime.composeState(userMessage);

      // Add Arena-specific context to state
      if (thread) {
        state.arenaThread = thread;
      }
      state.arenaThreadId = threadId;
      state.arenaAuthor = authorHandle;
      state.arenaMention = mention;

      // Response storage
      let responseText: string | null = null;
      const responses: import("@elizaos/core").Memory[] = [];

      // Callback to capture responses from actions
      const callback = async (response: any): Promise<import("@elizaos/core").Memory[]> => {
        console.log(`    ✅ Action callback received:`, response.text?.substring(0, 100));

        if (response.text) {
          // Store the response text
          if (!responseText) {
            responseText = response.text;
          }

          // Create a response memory
          const responseMemory: import("@elizaos/core").Memory = {
            entityId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId,
            content: {
              text: response.text,
              source: "arena",
              action: response.action,
            },
            metadata: {
              type: MemoryType.MESSAGE,
              source: "arena",
            },
          };
          responses.push(responseMemory);
        }
        return responses;
      };

      // Process actions - this will trigger SUMMARIZE_ARENA_USER if @mention is found
      await this.runtime.processActions(userMessage, responses, state, callback);

      // If actions were triggered and generated responses, use them
      if (responseText) {
        console.log(`    🎯 Action-generated response: "${responseText.substring(0, 100)}..."`);
        return responseText;
      }

      // Fallback: If no actions matched, generate a character-based response
      console.log(`    💬 No action matched, generating character-based response...`);

      const { ModelType } = await import("@elizaos/core");
      const prompt = `You are ${this.runtime.character.name}. You've been mentioned on Arena.

User: @${authorHandle} mentioned you
Message: ${mentionText}
${threadContent !== mentionText ? `Thread context: ${threadContent}` : ''}

Respond naturally in your character's voice. Keep it under 280 characters. Be helpful and engaging.`;

      const fallbackResponse = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        max_tokens: 150,
        temperature: 0.8,
      });

      return fallbackResponse?.trim() || null;

    } catch (error) {
      console.error(`    ❌ Failed to process mention through agent:`, error);
      return null;
    }
  }

  private async storeMention(notification: ArenaNotification): Promise<void> {
    // Add to in-memory cache
    this.processedMentions.add(notification.id);

    if (!this.runtime || !this.monitorConfig.storeHistory) return;

    // Store in ElizaOS memory if available
    const messageManager = (this.runtime as any).messageManager;
    if (!messageManager?.createMemory) return;

    try {
      const processedMention: ProcessedMention = {
        notificationId: notification.id,
        threadId: notification.link?.match(/\/thread\/([^\/]+)/)?.[1],
        content: notification.text || "",
        timestamp: notification.createdOn || new Date().toISOString(),
        replied: false,
      };

      const memory: Memory = {
        entityId: this.runtime.agentId,
        agentId: this.runtime.agentId,
        roomId: this.runtime.agentId,
        content: {
          text: `Arena mention: ${notification.text?.substring(0, 100) || "No text"}`,
          metadata: {
            type: "arena_mention",
            processed: processedMention,
          },
        },
      };

      await messageManager.createMemory(memory);
    } catch {
      // Memory storage not available
    }
  }

  private async loadProcessedMentions(): Promise<void> {
    const messageManager = (this.runtime as any)?.messageManager;
    if (!messageManager?.getMemories) return;

    try {
      const memories = await messageManager.getMemories({
        roomId: this.runtime?.agentId,
        count: this.monitorConfig.maxHistory,
      });

      const mentionMemories = memories.filter(
        (m: Memory) => (m.content.metadata as any)?.type === "arena_mention"
      );

      mentionMemories.forEach((m: Memory) => {
        const processed = (m.content.metadata as any)?.processed as ProcessedMention;
        if (processed) {
          this.processedMentions.add(processed.notificationId);
          if (processed.replied && processed.threadId) {
            this.repliedThreads.add(processed.threadId);
          }
        }
      });
    } catch {
      // Memory loading not available
    }
  }

  private async cleanupOldMentions(): Promise<void> {
    const messageManager = (this.runtime as any)?.messageManager;
    if (!messageManager?.getMemories) return;

    try {
      const memories = await messageManager.getMemories({
        roomId: this.runtime?.agentId,
        count: 100,
      });

      const mentionMemories = memories.filter(
        (m: Memory) => (m.content.metadata as any)?.type === "arena_mention"
      );

      if (mentionMemories.length > this.monitorConfig.maxHistory) {
        const toDelete = mentionMemories
          .sort((a: Memory, b: Memory) => ((a as any).createdAt || 0) - ((b as any).createdAt || 0))
          .slice(0, mentionMemories.length - this.monitorConfig.maxHistory);

        for (const memory of toDelete) {
          if ((memory as any).id && messageManager.removeMemory) {
            await messageManager.removeMemory((memory as any).id);
          }
        }

        console.log(`  Cleaned up ${toDelete.length} old mention memories`);
      }
    } catch {
      // Cleanup not available
    }
  }

  /**
   * Mark a thread as replied to prevent duplicate responses
   */
  async markAsReplied(threadId: string, notificationId?: string): Promise<void> {
    // Add to in-memory cache (always works)
    this.repliedThreads.add(threadId);

    // Update memory if available
    const messageManager = (this.runtime as any)?.messageManager;
    if (!messageManager?.getMemories) {
      console.log(`[Arena Mention Monitor] Marked thread ${threadId} as replied (in-memory only)`);
      return;
    }

    // Update memory if we have notification ID
    if (notificationId) {
      try {
        const memories = await messageManager.getMemories({
          roomId: this.runtime?.agentId,
          count: 100,
        });

        const mentionMemory = memories.find(
          (m: Memory) => (m.content.metadata as any)?.processed?.notificationId === notificationId
        );

        if ((mentionMemory?.content.metadata as any)?.processed) {
          (mentionMemory.content.metadata as any).processed.replied = true;
          (mentionMemory.content.metadata as any).processed.repliedAt = new Date().toISOString();

          // Update memory
          if ((mentionMemory as any).id && messageManager.removeMemory && messageManager.createMemory) {
            await messageManager.removeMemory((mentionMemory as any).id);
            await messageManager.createMemory(mentionMemory);
          }
        }
      } catch {
        // Memory update not available
      }
    }

    console.log(`[Arena Mention Monitor] Marked thread ${threadId} as replied`);
  }

  /**
   * Check if we've already replied to a thread
   */
  hasRepliedToThread(threadId: string): boolean {
    return this.repliedThreads.has(threadId);
  }

  /**
   * Check if we've already processed a notification
   */
  hasProcessedMention(notificationId: string): boolean {
    return this.processedMentions.has(notificationId);
  }

  /**
   * Get unprocessed mentions count
   */
  getUnprocessedCount(): number {
    return this.processedMentions.size;
  }

  /**
   * Force a scan now (useful for testing)
   */
  async forceScan(): Promise<void> {
    await this.scanMentions();
  }
}
