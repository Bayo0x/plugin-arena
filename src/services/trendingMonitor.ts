/**
 * Arena Trending Monitor Service
 *
 * Periodically scans Arena for trending posts, communities, and tokens
 * Stores data in ElizaOS memory for trading decisions and content generation
 */

import type { IAgentRuntime, Memory, State } from "@elizaos/core";
import { Service } from "@elizaos/core";
import type { ArenaClient } from "../client/arenaClient";
import { detectTrendingThreads, type TrendingThread } from "../utils/analytics";

interface TrendingSnapshot {
  timestamp: string;
  feed: string;
  trendingThreads: TrendingThread[];
  topTopics: string[];
  topMentions: string[];
  emergingTokens: string[];
}

interface TrendingMonitorConfig {
  enabled: boolean;
  scanInterval: number; // minutes
  feedsToMonitor: string[];
  storeInMemory: boolean;
  maxSnapshotsToKeep: number;
}

export class ArenaTrendingMonitorService extends Service {
  static serviceType = "arena_trending_monitor";
  capabilityDescription = "Monitors Arena trending posts, topics, and tokens periodically";

  protected monitorConfig: TrendingMonitorConfig;
  protected client: ArenaClient | null = null;
  protected intervalId: NodeJS.Timeout | null = null;
  protected isRunning = false;

  constructor(runtime?: IAgentRuntime) {
    super(runtime);

    // Load config from env
    this.monitorConfig = {
      enabled: process.env.ARENA_TRENDING_MONITOR_ENABLED === "true",
      scanInterval: parseInt(process.env.ARENA_TRENDING_SCAN_INTERVAL || "15", 10),
      feedsToMonitor: (process.env.ARENA_TRENDING_FEEDS || "trending,suggested")
        .split(",")
        .map(f => f.trim()),
      storeInMemory: process.env.ARENA_TRENDING_STORE_MEMORY !== "false", // default true
      maxSnapshotsToKeep: parseInt(process.env.ARENA_TRENDING_MAX_SNAPSHOTS || "20", 10),
    };
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new ArenaTrendingMonitorService(runtime);
    await service.initialize();
    return service;
  }

  private async initialize(): Promise<void> {

    if (!this.monitorConfig.enabled) {
      console.log("[Arena Trending Monitor] Disabled via config");
      return;
    }

    // Get Arena client from runtime
    const arenaToken =
      this.runtime?.getSetting("ARENA_ACCESS_TOKEN") ||
      process.env.ARENA_ACCESS_TOKEN;

    if (!arenaToken) {
      console.warn("[Arena Trending Monitor] No ARENA_ACCESS_TOKEN found, service disabled");
      return;
    }

    // Import ArenaClient dynamically to avoid circular deps
    const { ArenaClient } = await import("../client/arenaClient");
    this.client = new ArenaClient(arenaToken);

    console.log("[Arena Trending Monitor] Initialized");
    console.log(`  - Scan interval: ${this.monitorConfig.scanInterval} minutes`);
    console.log(`  - Monitoring feeds: ${this.monitorConfig.feedsToMonitor.join(", ")}`);
    console.log(`  - Store in memory: ${this.monitorConfig.storeInMemory}`);

    // Start monitoring if enabled
    if (this.monitorConfig.enabled && this.client) {
      this.startMonitoring();
    }
  }

  private startMonitoring(): void {
    if (this.isRunning) {
      console.log("[Arena Trending Monitor] Already running");
      return;
    }

    this.isRunning = true;
    console.log("[Arena Trending Monitor] Starting...");

    // Schedule periodic scans (don't run immediately to avoid runtime issues)
    const intervalMs = this.monitorConfig.scanInterval * 60 * 1000;

    // Run first scan after a short delay to ensure runtime is ready
    setTimeout(() => {
      this.scanTrending().catch(error => {
        console.error("[Arena Trending Monitor] Initial scan error:", error);
      });
    }, 5000); // 5 second delay for runtime to be ready

    this.intervalId = setInterval(() => {
      this.scanTrending().catch(error => {
        console.error("[Arena Trending Monitor] Scan error:", error);
      });
    }, intervalMs);

    console.log(`[Arena Trending Monitor] Started - first scan in 5 seconds, then every ${this.monitorConfig.scanInterval} minutes`);
  }

  override async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log("[Arena Trending Monitor] Stopped");
  }

  private async scanTrending(): Promise<void> {
    if (!this.client || !this.runtime) return;

    console.log(`\n[Arena Trending Monitor] 🔍 Scanning trending content...`);

    for (const feedKey of this.monitorConfig.feedsToMonitor) {
      try {
        await this.scanFeed(feedKey);
      } catch (error) {
        console.error(`[Arena Trending Monitor] Error scanning ${feedKey}:`, error);
      }
    }

    console.log(`[Arena Trending Monitor] ✅ Scan complete\n`);
  }

  private async scanFeed(feedKey: string): Promise<void> {
    if (!this.client || !this.runtime) return;

    console.log(`  📊 Scanning ${feedKey} feed...`);

    // Fetch feed
    const feed = await this.client.getFeed(feedKey, {
      page: 1,
      pageSize: 100, // Get more for better analysis
    });

    // Detect trending threads
    const trending = detectTrendingThreads(feed.threads, {
      timeWindow: 24,
      minEngagement: 10,
    });

    console.log(`    Found ${trending.length} trending posts`);

    // Extract topics and mentions
    const topTopics = this.extractTopics(trending.map(t => t.thread.content));
    const topMentions = this.extractMentions(trending.map(t => t.thread.content));
    const emergingTokens = this.extractTokenSymbols(trending.map(t => t.thread.content));

    console.log(`    Topics: ${topTopics.slice(0, 5).join(", ")}`);
    console.log(`    Tokens: ${emergingTokens.slice(0, 5).join(", ")}`);

    // Create snapshot
    const snapshot: TrendingSnapshot = {
      timestamp: new Date().toISOString(),
      feed: feedKey,
      trendingThreads: trending.slice(0, 20), // Top 20
      topTopics,
      topMentions,
      emergingTokens,
    };

    // Store in ElizaOS memory
    if (this.monitorConfig.storeInMemory) {
      await this.storeSnapshot(snapshot);
    }

    // Event emission for real-time listeners (if supported by runtime)
    try {
      (this.runtime as any).emit?.("arena:trending:update", snapshot);
    } catch {
      // Event emission not supported
    }
  }

  // In-memory snapshot storage (fallback when runtime memory APIs unavailable)
  private snapshotCache: TrendingSnapshot[] = [];

  private async storeSnapshot(snapshot: TrendingSnapshot): Promise<void> {
    if (!this.runtime || !this.monitorConfig.storeInMemory) return;

    // Store in local cache
    this.snapshotCache.push(snapshot);

    // Clean up old snapshots from cache
    if (this.snapshotCache.length > this.monitorConfig.maxSnapshotsToKeep) {
      this.snapshotCache = this.snapshotCache.slice(-this.monitorConfig.maxSnapshotsToKeep);
    }

    // Try to store in runtime memory if available
    const messageManager = (this.runtime as any).messageManager;
    if (messageManager?.createMemory) {
      try {
        const memory: Memory = {
          entityId: this.runtime.agentId,
          agentId: this.runtime.agentId,
          roomId: this.runtime.agentId,
          content: {
            text: `Arena trending snapshot from ${snapshot.feed} feed`,
            metadata: snapshot,
          },
        };
        await messageManager.createMemory(memory);
        await this.cleanupOldSnapshots();
      } catch {
        // Memory storage not available, using cache only
      }
    }
  }

  private async cleanupOldSnapshots(): Promise<void> {
    const messageManager = (this.runtime as any)?.messageManager;
    if (!messageManager?.getMemories) return;

    try {
      const memories = await messageManager.getMemories({
        roomId: this.runtime?.agentId,
        count: 100,
      });

      const trendingMemories = memories.filter(
        (m: Memory) => m.content.text?.includes("Arena trending snapshot")
      );

      if (trendingMemories.length > this.monitorConfig.maxSnapshotsToKeep) {
        const toDelete = trendingMemories
          .sort((a: Memory, b: Memory) => ((a as any).createdAt || 0) - ((b as any).createdAt || 0))
          .slice(0, trendingMemories.length - this.monitorConfig.maxSnapshotsToKeep);

        for (const memory of toDelete) {
          if ((memory as any).id && messageManager.removeMemory) {
            await messageManager.removeMemory((memory as any).id);
          }
        }

        console.log(`  Cleaned up ${toDelete.length} old snapshots`);
      }
    } catch {
      // Cleanup not available
    }
  }

  // Helper: Extract topics from content
  private extractTopics(contents: string[]): string[] {
    const topicMap = new Map<string, number>();

    // Common crypto/arena topics
    const topics = [
      "AVAX", "Avalanche", "ETH", "Ethereum", "BTC", "Bitcoin",
      "DeFi", "NFT", "trading", "blockchain", "memecoin",
      "Arena", "community", "alpha", "bullish", "bearish",
      "pump", "degen", "gem", "airdrop", "launch", "token"
    ];

    contents.forEach(content => {
      if (!content) return;
      const lower = content.toLowerCase();
      topics.forEach(topic => {
        if (lower.includes(topic.toLowerCase())) {
          topicMap.set(topic, (topicMap.get(topic) || 0) + 1);
        }
      });
    });

    return Array.from(topicMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic);
  }

  // Helper: Extract @mentions
  private extractMentions(contents: string[]): string[] {
    const mentionMap = new Map<string, number>();

    contents.forEach(content => {
      if (!content) return;
      // Match @handle patterns
      const mentions = content.match(/@(\w+)/g) || [];
      mentions.forEach(mention => {
        const handle = mention.substring(1); // Remove @
        mentionMap.set(handle, (mentionMap.get(handle) || 0) + 1);
      });
    });

    return Array.from(mentionMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([handle]) => `@${handle}`);
  }

  // Helper: Extract token symbols ($TOKEN)
  private extractTokenSymbols(contents: string[]): string[] {
    const tokenMap = new Map<string, number>();

    contents.forEach(content => {
      if (!content) return;
      // Match $TOKEN patterns (uppercase, 2-10 chars)
      const tokens = content.match(/\$([A-Z]{2,10})\b/g) || [];
      tokens.forEach(token => {
        tokenMap.set(token, (tokenMap.get(token) || 0) + 1);
      });
    });

    return Array.from(tokenMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([token]) => token);
  }

  /**
   * Get latest trending data
   * Used by agent to access current trending info
   */
  async getLatestTrending(feedKey?: string): Promise<TrendingSnapshot | null> {
    // First try local cache
    if (this.snapshotCache.length > 0) {
      if (feedKey) {
        const cached = [...this.snapshotCache].reverse().find(s => s.feed === feedKey);
        if (cached) return cached;
      } else {
        return this.snapshotCache[this.snapshotCache.length - 1];
      }
    }

    // Fallback to runtime memory if available
    const messageManager = (this.runtime as any)?.messageManager;
    if (!messageManager?.getMemories) return null;

    try {
      const memories = await messageManager.getMemories({
        roomId: this.runtime?.agentId,
        count: 20,
      });

      const trendingMemories = memories
        .filter((m: Memory) => m.content.text?.includes("Arena trending snapshot"))
        .sort((a: Memory, b: Memory) => ((b as any).createdAt || 0) - ((a as any).createdAt || 0));

      if (feedKey) {
        const memory = trendingMemories.find(
          (m: Memory) => (m.content.metadata as any)?.feed === feedKey
        );
        return (memory?.content.metadata as TrendingSnapshot) || null;
      }

      return (trendingMemories[0]?.content.metadata as TrendingSnapshot) || null;
    } catch {
      return null;
    }
  }

  /**
   * Get trending topics across all feeds
   */
  async getTrendingTopics(): Promise<string[]> {
    const latest = await this.getLatestTrending();
    return latest?.topTopics || [];
  }

  /**
   * Get emerging tokens
   */
  async getEmergingTokens(): Promise<string[]> {
    const latest = await this.getLatestTrending();
    return latest?.emergingTokens || [];
  }

  /**
   * Check if topic is currently trending
   */
  async isTopicTrending(topic: string): Promise<boolean> {
    const topics = await this.getTrendingTopics();
    return topics.some(t => t.toLowerCase() === topic.toLowerCase());
  }
}
