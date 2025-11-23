import {
  logger,
  ModelType,
  Service,
  type IAgentRuntime,
  type Memory,
  type Content,
  type UUID,
  ChannelType,
  asUUID,
  type ActionResult,
} from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import type { ArenaConfig, ArenaThread } from "../types";
import {
  DEFAULT_FEED_PAGE_SIZE,
  DEFAULT_MIN_FOLLOWER_COUNT,
} from "../constants";
import { jitteredIntervalMinutes, minutesToMs } from "../utils/scheduling";
import { v4 as uuidv4 } from "uuid";

const ARENA_DISCOVERY_WORLD_ID = asUUID(
  "00000000-0000-0000-0000-00000000ad01",
);
const ARENA_DISCOVERY_ROOM_ID = asUUID("00000000-0000-0000-0000-00000000ad02");
const ARENA_DISCOVERY_SOURCE = "arena-discovery";
const ARENA_ENGAGEMENT_WORLD_ID = asUUID(
  "00000000-0000-0000-0000-00000000ae01",
);
const ARENA_ENGAGEMENT_ROOM_ID = asUUID(
  "00000000-0000-0000-0000-00000000ae02",
);
const ARENA_ENGAGEMENT_SOURCE = "arena-engagement";

interface GeneratedBlock {
  content: string;
  title?: string;
}

interface DiscoverySnapshot {
  startedAt: number;
  feedKey: string;
  scanned: number;
  topThreads: Array<{
    id: string;
    author: string;
    followerCount: number;
    likeCount: number;
    repostCount: number;
    answerCount: number;
    score: number;
    engagement: number;           // ADDED: Total engagement count
    preview: string;
  }>;
}

async function generateBlock(
  runtime: IAgentRuntime,
  context?: string,
): Promise<GeneratedBlock> {
  const topics = runtime.character.topics?.join(", ") ?? "Arena, AVAX, DeFi";
  const today = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const prompt = `You are ${runtime.character.name}, an Arena-native analyst.
Return ONLY valid JSON: {"title":"...", "content":"..."}

Hard rules:
- Title: 4-8 words, no ending punctuation, feel like an Arena hook.
- Content: <=260 characters, EXACTLY 2 sentences. Sentence 1 must reference at least one fact from Latest Arena signals (handles, metrics, dates) if provided; otherwise mention a concrete metric (%, USD, number). Sentence 2 must call readers to act (ask a question, invite reply, propose next step). No hashtags, no markdown fences, no placeholders.
- Must reference at least one of these topics: ${topics}.
- Thread should feel new for ${today}.
- Latest Arena signals:
${context ?? "none provided"}
`;

  const result = await generateThreadFromPrompt(runtime, prompt, 0.9);
  if (result) {
    return result;
  }

  // Fallback: try a simpler prompt if JSON parse failed
  const fallbackPrompt = `Write an Arena thread summary as JSON {"title":"...","content":"..."}.
Requirements:
- Title 4-8 words, no ending punctuation.
- Content two sentences, <=260 characters. Mention a specific Arena/AVAX metric and end with a CTA.
- No placeholders, no instructions.`;

  const fallbackResult = await generateThreadFromPrompt(
    runtime,
    fallbackPrompt,
    0.85,
  );
  if (fallbackResult) {
    return fallbackResult;
  }

  // Final fallback: deterministic template
  const fallbackContextLine = context
    ? `Signals: ${context.split("\n").slice(0, 2).join(" | ")}.`
    : "Keeping tabs on Arena threads and AVAX moves.";
  return {
    title: `Arena pulse ${today}`,
    content: `${fallbackContextLine} Drop your sharpest Arena angle or trade so I can feature it next thread.`,
  };
}

async function generateThreadFromPrompt(
  runtime: IAgentRuntime,
  prompt: string,
  temperature: number,
): Promise<GeneratedBlock | null> {
  try {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      temperature,
      max_tokens: 220,
    });

    const cleanResponse = response
      .trim()
      .replace(/```json/gi, "")
      .replace(/```/g, "");
    const parsed = JSON.parse(cleanResponse);

    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const content =
      typeof parsed.content === "string" ? parsed.content.trim() : "";

    if (
      title.length < 3 ||
      content.length < 10 ||
      content.includes("<") ||
      content.includes("<<") ||
      content.includes("Respond in")
    ) {
      return null;
    }

    return { title, content };
  } catch (error) {
    logger.warn("Arena autopost generation failed, will retry/fallback", error);
    return null;
  }
}

export class ArenaService extends Service {
  static serviceType = "arena";

  capabilityDescription =
    "The agent can publish and curate content on Arena.";

  declare public config: ArenaConfig;
  protected client!: ArenaClient;
  protected postTimer?: ReturnType<typeof setTimeout>;
  protected discoveryTimer?: ReturnType<typeof setTimeout>;
  protected engagementTimer?: ReturnType<typeof setTimeout>;
  protected stopping = false;
  protected lastDiscoverySnapshots: DiscoverySnapshot[] = [];
  protected discoveryRoomReady = false;
  protected engagementRoomReady = false;
  protected followerCache = new Map<
    string,
    { count: number; updatedAt: number }
  >();
  protected engagementCounters = {
    likes: { count: 0, resetAt: 0 },
    reposts: { count: 0, resetAt: 0 },
    replies: { count: 0, resetAt: 0 },
    follows: { count: 0, resetAt: 0 },
  };
  // Track threads we've already engaged with to prevent duplicates
  // Key: `${threadId}:${action}` (e.g., "abc123:like", "abc123:reply")
  protected engagedThreads = new Map<
    string,
    { action: string; timestamp: number; author: string }
  >();

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
  }

  static override async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new ArenaService(runtime);
    await service.initialize();
    return service;
  }

  private async initialize() {
    this.config = loadArenaConfig(this.runtime);
    this.client = new ArenaClient(this.config.accessToken, {
      baseUrl: this.config.baseUrl,
      userAgent: this.config.userAgent,
    });

    logger.info(
      `Arena service initialized for feed "${this.config.defaultFeed}"`,
    );

    if (this.config.enablePost) {
      if (this.config.postImmediately) {
        await this.publishScheduledBlock().catch((error) => {
          logger.error("Initial Arena post failed", error);
        });
      }
      this.scheduleNextPost();
    } else {
      logger.info("Arena scheduled posting disabled");
    }

    if (this.config.enableDiscovery) {
      logger.info("Arena discovery service enabled");
      this.scheduleNextDiscovery();
    } else {
      logger.info("Arena discovery service disabled");
    }

    if (this.config.enableEngagement) {
      logger.info("Arena engagement service enabled");
      this.scheduleNextEngagement();
    } else {
      logger.info("Arena engagement service disabled");
    }
  }

  private scheduleNextPost() {
    if (this.stopping) {
      return;
    }

    const minutes = jitteredIntervalMinutes(
      this.config.postIntervalMin,
      this.config.postIntervalMax,
      this.config.postIntervalMinutes,
    );
    const delay = minutesToMs(minutes);
    logger.info(`Next Arena post scheduled in ${minutes.toFixed(2)} minutes`);

    this.postTimer = setTimeout(async () => {
      try {
        await this.publishScheduledBlock();
      } catch (error) {
        logger.error("Arena scheduled post failed", error);
      } finally {
        this.scheduleNextPost();
      }
    }, delay);
  }

  private async publishScheduledBlock() {
    if (!this.config.enablePost) {
      logger.debug("Arena posting skipped: disabled");
      return;
    }

    const generation = await generateBlock(
      this.runtime,
      this.getLatestDiscoveryContext(),
    );
    logger.info(`Generated Arena thread: "${generation.title || generation.content.substring(0, 50)}..."`);

    if (this.config.dryRun) {
      logger.info("Arena dry-run enabled; skipping API call.");
      return;
    }

    const thread = await this.client.createThread({
      content: generation.content,
      privacyType: this.config.privacyType,
      communityId: this.config.communityId,
    });

    logger.info(
      `Posted Arena thread ${thread.id} to feed ${this.config.defaultFeed}`,
    );
  }

  override async stop(): Promise<void> {
    this.stopping = true;
    if (this.postTimer) {
      clearTimeout(this.postTimer);
      this.postTimer = undefined;
    }
    if (this.discoveryTimer) {
      clearTimeout(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
    if (this.engagementTimer) {
      clearTimeout(this.engagementTimer);
      this.engagementTimer = undefined;
    }
    logger.info("Arena service stopped");
  }

  private scheduleNextDiscovery() {
    if (this.stopping || !this.config.enableDiscovery) {
      return;
    }

    const minutes = jitteredIntervalMinutes(
      this.config.discoveryIntervalMin,
      this.config.discoveryIntervalMax,
      this.config.discoveryInterval,
    );
    const delay = minutesToMs(minutes);
    logger.info(
      `Next Arena discovery scan scheduled in ${minutes.toFixed(2)} minutes`,
    );

    this.discoveryTimer = setTimeout(async () => {
      try {
        await this.runDiscoveryScan();
      } catch (error) {
        logger.error("Arena discovery scan failed", error);
      } finally {
        this.scheduleNextDiscovery();
      }
    }, delay);
  }

  private scheduleNextEngagement() {
    if (this.stopping || !this.config.enableEngagement) {
      return;
    }

    const minutes = jitteredIntervalMinutes(
      this.config.engagementIntervalMin,
      this.config.engagementIntervalMax,
      this.config.engagementInterval,
    );
    const delay = minutesToMs(minutes);
    logger.info(
      `Next Arena engagement pass scheduled in ${minutes.toFixed(2)} minutes`,
    );

    this.engagementTimer = setTimeout(async () => {
      try {
        await this.runEngagementPass();
      } catch (error) {
        logger.error("Arena engagement pass failed", error);
      } finally {
        this.scheduleNextEngagement();
      }
    }, delay);
  }

  private async runDiscoveryScan() {
    const feeds =
      this.config.targetFeeds.length > 0
        ? this.config.targetFeeds
        : ["trending"];
    const targetUsers = this.config.targetUsers.map((u) => u.toLowerCase());
    const minFollowers =
      this.config.minFollowerCount ?? DEFAULT_MIN_FOLLOWER_COUNT;

    logger.info(
      `Arena discovery scan starting for feeds: ${feeds.join(", ")} (targets: ${
        targetUsers.length > 0 ? targetUsers.join(", ") : "all"
      })`,
    );

    for (const feedKey of feeds) {
      try {
        const feed = await this.client.getFeed(feedKey, {
          page: 1,
          pageSize: DEFAULT_FEED_PAGE_SIZE,
        });
        const followerCounts = await this.resolveFollowerCounts(feed.threads);

        const filteredThreads = feed.threads.filter((thread) => {
          const raw = thread.raw as Record<string, unknown> | undefined;
          const authorHandle =
            thread.userHandle ||
            (raw?.user_handle as string | undefined) ||
            "";

          const followerCount =
            followerCounts.get(authorHandle.toLowerCase()) ?? 0;

          const threadRecord = thread as Record<string, unknown>;
          const likeCount =
            getNumericField(threadRecord, ["likeCount", "likes"]) ??
            getNumericField(raw, [
              "likeCount",
              "likes",
              "like_count",
              "likeCountTotal",
            ]) ??
            0;
          const repostCount =
            getNumericField(threadRecord, [
              "repostCount",
              "reposts",
              "repost_count",
            ]) ??
            getNumericField(raw, ["repostCount", "reposts", "repost_count"]) ??
            0;
          const answerCount =
            getNumericField(threadRecord, [
              "answerCount",
              "replies",
              "reply_count",
            ]) ??
            getNumericField(raw, ["answerCount", "replies", "reply_count"]) ??
            0;

          const preview = extractPreview(thread, raw);
          logger.debug(
            `[Arena discovery raw] feed=${feedKey} @${authorHandle} followers=${followerCount} likes=${likeCount} reposts=${repostCount} replies=${answerCount} preview="${preview.substring(
              0,
              80,
            )}"`,
          );

          const matchesTarget =
            targetUsers.length === 0 ||
            targetUsers.includes(authorHandle.toLowerCase());

          const meetsFollowers = followerCount >= minFollowers;

          if (!meetsFollowers) {
            logger.debug(
              `Arena discovery skipped @${authorHandle} in ${feedKey} – followers ${followerCount} < min ${minFollowers}`,
            );
          }

          return matchesTarget && meetsFollowers;
        });

        const topThreads = this.extractTopThreads(
          filteredThreads,
          feedKey,
          followerCounts,
        );

        const snapshot: DiscoverySnapshot = {
          startedAt: Date.now(),
          feedKey,
          scanned: feed.threads.length,
          topThreads,
        };

        this.lastDiscoverySnapshots.unshift(snapshot);
        this.lastDiscoverySnapshots = this.lastDiscoverySnapshots.slice(0, 10);

        await this.saveDiscoverySnapshot(feedKey, snapshot).catch((error) => {
          logger.warn("Failed to persist Arena discovery snapshot", error);
        });

        logger.info(
          `Arena discovery results for ${feedKey}: scanned ${snapshot.scanned} threads, found ${topThreads.length} high-signal posts: ${topThreads.map((t) => `@${t.author}(score:${t.score.toFixed(1)})`).join(", ")}`,
        );
      } catch (error) {
        logger.warn(
          `Arena discovery scan failed for feed ${feedKey}`,
          error,
        );
      }
    }
  }

  private extractTopThreads(
    threads: ArenaThread[],
    feedKey: string,
    followerCounts: Map<string, number>,
  ): DiscoverySnapshot["topThreads"] {
    return threads
      .map((thread) => {
        const raw = thread.raw as Record<string, unknown> | undefined;
        const threadRecord = thread as Record<string, unknown>;
        const likeCount =
          getNumericField(threadRecord, ["likeCount", "likes"]) ??
          getNumericField(raw, [
            "likeCount",
            "likes",
            "like_count",
            "likeCountTotal",
          ]) ??
          0;
        const repostCount =
          getNumericField(threadRecord, [
            "repostCount",
            "reposts",
            "repost_count",
          ]) ??
          getNumericField(raw, ["repostCount", "reposts", "repost_count"]) ??
          0;
        const answerCount =
          getNumericField(threadRecord, [
            "answerCount",
            "replies",
            "reply_count",
          ]) ??
          getNumericField(raw, ["answerCount", "replies", "reply_count"]) ??
          0;

        const content = extractPreview(thread, raw);

        const author =
          thread.userHandle ||
          (raw?.user_handle as string | undefined) ||
          thread.userName ||
          (raw?.user_userName as string | undefined) ||
          "Unknown";

        const followerCount =
          followerCounts.get(author.toLowerCase()) ?? 0;

        const score =
          (likeCount + repostCount * 2 + answerCount * 1.5) *
          Math.log10(followerCount + 10);

        const engagement = likeCount + repostCount + answerCount;

        logger.debug(
          `[Arena discovery scoring] feed=${feedKey} @${author} score=${score.toFixed(
            2,
          )} followers=${followerCount} likes=${likeCount} reposts=${repostCount} replies=${answerCount} engagement=${engagement}`,
        );

        return {
          id: thread.id,
          author,
          followerCount,
          likeCount,
          repostCount,
          answerCount,
          score,
          engagement,
          preview: content.substring(0, 160),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxEngagementsPerRun || 5);
  }

  private async saveDiscoverySnapshot(
    feedKey: string,
    snapshot: DiscoverySnapshot,
  ) {
    if (!this.runtime) {
      return;
    }

    const summaryLines = snapshot.topThreads
      .map(
        (thread) =>
          `@${thread.author} (followers ${thread.followerCount}) – ${thread.preview} [score ${thread.score.toFixed(
            1,
          )}, 👍${thread.likeCount}, 🔄${thread.repostCount}, 💬${thread.answerCount}]`,
      )
      .join("\n");
    const summaryText = `Arena discovery summary for ${feedKey} – scanned ${snapshot.scanned} threads.\n${summaryLines}`;

    await this.saveDiscoveryMemory(summaryText, ["arena", "discovery", feedKey], {
      feedKey,
      scanned: snapshot.scanned,
      topThreadIds: snapshot.topThreads.map((thread) => thread.id),
      startedAt: snapshot.startedAt,
    });

    for (const thread of snapshot.topThreads) {
      await this.saveDiscoveryMemory(
        `Arena discovery ${feedKey}: @${thread.author} – ${thread.preview} (engagement ${thread.engagement})`,
        ["arena", "discovery", feedKey, "thread"],
        {
          feedKey,
          threadId: thread.id,
          author: thread.author,
          engagement: thread.engagement,
          recordedAt: snapshot.startedAt,
        },
      );
    }
  }

  private async saveDiscoveryMemory(
    text: string,
    tags: string[],
    extraMetadata: Record<string, unknown>,
  ) {
    if (!this.runtime?.createMemory) {
      return;
    }
    try {
      await this.ensureDiscoveryRoom();
      const memory: Memory = {
        id: uuidv4() as UUID,
        agentId: this.runtime.agentId,
        entityId: this.runtime.agentId,
        roomId: ARENA_DISCOVERY_ROOM_ID,
        worldId: ARENA_DISCOVERY_WORLD_ID,
        createdAt: Date.now(),
        content: {
          text,
          source: ARENA_DISCOVERY_SOURCE,
        } as Content,
        metadata: {
          type: "arena_discovery",
          source: ARENA_DISCOVERY_SOURCE,
          scope: "shared",
          timestamp: Date.now(),
          tags,
          ...extraMetadata,
        },
      };

      await this.runtime.createMemory(memory, "memories", false);
    } catch (error) {
      logger.warn("Arena discovery memory store failed", error);
    }
  }

  private async ensureDiscoveryRoom() {
    if (this.discoveryRoomReady || !this.runtime) {
      return;
    }

    await this.runtime.ensureWorldExists({
      id: ARENA_DISCOVERY_WORLD_ID,
      agentId: this.runtime.agentId,
      serverId: ARENA_DISCOVERY_SOURCE,
      name: "ArenaDiscoveryWorld",
    });

    await this.runtime.ensureRoomExists({
      id: ARENA_DISCOVERY_ROOM_ID,
      agentId: this.runtime.agentId,
      source: ARENA_DISCOVERY_SOURCE,
      type: ChannelType.API,
      worldId: ARENA_DISCOVERY_WORLD_ID,
      name: "ArenaDiscoveryRoom",
    });

    await this.runtime.ensureConnection({
      entityId: this.runtime.agentId,
      roomId: ARENA_DISCOVERY_ROOM_ID,
      worldId: ARENA_DISCOVERY_WORLD_ID,
      userName: this.runtime.character.name,
      name: this.runtime.character.name,
      source: ARENA_DISCOVERY_SOURCE,
      type: ChannelType.API,
      serverId: ARENA_DISCOVERY_SOURCE,
      channelId: ARENA_DISCOVERY_SOURCE,
    });

    this.discoveryRoomReady = true;
  }

  private async ensureEngagementRoom() {
    if (this.engagementRoomReady || !this.runtime) {
      return;
    }

    await this.runtime.ensureWorldExists({
      id: ARENA_ENGAGEMENT_WORLD_ID,
      agentId: this.runtime.agentId,
      serverId: ARENA_ENGAGEMENT_SOURCE,
      name: "ArenaEngagementWorld",
    });

    await this.runtime.ensureRoomExists({
      id: ARENA_ENGAGEMENT_ROOM_ID,
      agentId: this.runtime.agentId,
      source: ARENA_ENGAGEMENT_SOURCE,
      type: ChannelType.API,
      worldId: ARENA_ENGAGEMENT_WORLD_ID,
      name: "ArenaEngagementRoom",
    });

    await this.runtime.ensureConnection({
      entityId: this.runtime.agentId,
      roomId: ARENA_ENGAGEMENT_ROOM_ID,
      worldId: ARENA_ENGAGEMENT_WORLD_ID,
      userName: this.runtime.character.name,
      name: this.runtime.character.name,
      source: ARENA_ENGAGEMENT_SOURCE,
      type: ChannelType.API,
      serverId: ARENA_ENGAGEMENT_SOURCE,
      channelId: ARENA_ENGAGEMENT_SOURCE,
    });

    this.engagementRoomReady = true;
  }

  private async resolveFollowerCounts(
    threads: ArenaThread[],
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    const handlesToFetch = new Set<string>();
    const now = Date.now();
    const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

    for (const thread of threads) {
      const raw = thread.raw as Record<string, unknown> | undefined;
      const handle =
        thread.userHandle ||
        (raw?.user_handle as string | undefined) ||
        thread.userName ||
        "";
      if (!handle) continue;
      const key = handle.toLowerCase();

      const followerCount =
        (raw?.followerCount as number | undefined) ||
        (raw?.user_followerCount as number | undefined) ||
        ((raw?.user as Record<string, unknown> | undefined)?.followerCount as number | undefined);

      if (typeof followerCount === "number" && followerCount >= 0) {
        results.set(key, followerCount);
        this.followerCache.set(key, { count: followerCount, updatedAt: now });
        continue;
      }

      const cached = this.followerCache.get(key);
      if (cached && now - cached.updatedAt < CACHE_TTL) {
        results.set(key, cached.count);
      } else {
        handlesToFetch.add(key);
      }
    }

    if (handlesToFetch.size === 0) {
      return results;
    }

    await Promise.allSettled(
      Array.from(handlesToFetch).map(async (handle) => {
        try {
          const user = await this.client.getUserByHandle(handle);
          const count = user?.followerCount ?? 0;
          this.followerCache.set(handle, { count, updatedAt: Date.now() });
          results.set(handle, count);
          logger.debug(
            `[Arena discovery follower] fetched @${handle} followers=${count}`,
          );
        } catch (error) {
          logger.debug(
            `[Arena discovery follower] failed for @${handle}`,
            error,
          );
          this.followerCache.set(handle, { count: 0, updatedAt: Date.now() });
          results.set(handle, 0);
        }
      }),
    );

    return results;
  }

  private getLatestDiscoveryContext(): string | undefined {
    const snapshot = this.lastDiscoverySnapshots.find(
      (s) => s.topThreads.length > 0,
    );
    if (!snapshot) {
      return undefined;
    }

    const lines = snapshot.topThreads
      .slice(0, 3)
      .map(
        (thread) =>
          `@${thread.author} (${snapshot.feedKey} feed) — 👍${thread.likeCount} 🔄${thread.repostCount} 💬${thread.answerCount} (followers ${thread.followerCount})`,
      );

    return lines.join("\n");
  }

  private async runEngagementPass() {
    if (!this.runtime || !this.config.enableEngagement) {
      return;
    }

    const snapshot = this.lastDiscoverySnapshots.find(
      (s) => s.topThreads.length > 0,
    );
    if (!snapshot) {
      logger.info("Arena engagement: no discovery snapshots available yet");
      return;
    }

    await this.ensureEngagementRoom();

    const candidates = snapshot.topThreads.slice(0, 5);
    logger.info(
      `[Arena Engagement] 🎯 Starting engagement pass for ${candidates.length} candidates from ${snapshot.feedKey} feed`,
    );

    for (const candidate of candidates) {
      if (this.exceededEngagementBudget()) {
        logger.info(
          `[Arena Engagement] ⛔ Budgets exhausted (likes: ${this.engagementCounters.likes.count}/${this.config.maxLikesPerHour}, reposts: ${this.engagementCounters.reposts.count}/${this.config.maxRepostsPerHour}, replies: ${this.engagementCounters.replies.count}/${this.config.maxRepliesPerHour}, follows: ${this.engagementCounters.follows.count}/${this.config.maxFollowsPerHour}), stopping pass`,
        );
        break;
      }

      logger.debug(
        `[Arena Engagement] 🤔 Evaluating @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) - score: ${candidate.score.toFixed(2)}, engagement: 👍${candidate.likeCount} 🔄${candidate.repostCount} 💬${candidate.answerCount}`,
      );

      const decision = await this.evaluateEngagementCandidate(candidate);
      if (!decision || decision.action === "none") {
        if (decision?.action === "none") {
          logger.debug(
            `[Arena Engagement] ⏭️  Decision: SKIP @${candidate.author} - ${decision.rationale}`,
          );
        }
        continue;
      }

      await this.executeEngagementDecision(candidate, decision);
    }

    logger.info(
      `[Arena Engagement] ✅ Engagement pass completed. Current counters: likes: ${this.engagementCounters.likes.count}/${this.config.maxLikesPerHour}, reposts: ${this.engagementCounters.reposts.count}/${this.config.maxRepostsPerHour}, replies: ${this.engagementCounters.replies.count}/${this.config.maxRepliesPerHour}, follows: ${this.engagementCounters.follows.count}/${this.config.maxFollowsPerHour}`,
    );
  }

  private exceededEngagementBudget(): boolean {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    const counters = this.engagementCounters;
    const resetIfNeeded = (key: keyof typeof counters) => {
      if (now > counters[key].resetAt) {
        counters[key].count = 0;
        counters[key].resetAt = now + hourMs;
      }
    };

    resetIfNeeded("likes");
    resetIfNeeded("reposts");
    resetIfNeeded("replies");
    resetIfNeeded("follows");

    return (
      counters.likes.count >= this.config.maxLikesPerHour &&
      counters.reposts.count >= this.config.maxRepostsPerHour &&
      counters.replies.count >= this.config.maxRepliesPerHour &&
      counters.follows.count >= this.config.maxFollowsPerHour
    );
  }

  private hasAlreadyEngaged(threadId: string, action: string): boolean {
    const key = `${threadId}:${action}`;
    const engagement = this.engagedThreads.get(key);
    if (!engagement) {
      return false;
    }

    // Clean up old entries (older than 48 hours)
    const now = Date.now();
    const maxAge = 48 * 60 * 60 * 1000; // 48 hours
    if (now - engagement.timestamp > maxAge) {
      this.engagedThreads.delete(key);
      return false;
    }

    return true;
  }

  private recordEngagement(
    threadId: string,
    action: string,
    author: string,
  ): void {
    const key = `${threadId}:${action}`;
    this.engagedThreads.set(key, {
      action,
      timestamp: Date.now(),
      author,
    });

    // Periodic cleanup: remove entries older than 48 hours
    if (this.engagedThreads.size > 1000) {
      const now = Date.now();
      const maxAge = 48 * 60 * 60 * 1000;
      for (const [k, v] of this.engagedThreads.entries()) {
        if (now - v.timestamp > maxAge) {
          this.engagedThreads.delete(k);
        }
      }
    }
  }

  private async evaluateEngagementCandidate(candidate: DiscoverySnapshot["topThreads"][number]) {
    const contextLines = [
      `Post preview: ${candidate.preview}`,
      `Author followers: ${candidate.followerCount}`,
      `Likes: ${candidate.likeCount}, Reposts: ${candidate.repostCount}, Replies: ${candidate.answerCount}`,
      `Score: ${candidate.score.toFixed(2)}`,
    ];

    const prompt = `You are ${this.runtime?.character.name}, an Arena-native analyst.
Decide how to engage with this Arena post.

Context:
${contextLines.join("\n")}

Available actions: like, repost, reply, follow, quote, none.
Rules:
- Only like if the signal is truly helpful to our Arena audience.
- Only repost/quote if we can add value or highlight alpha.
- Only reply if we can cite real data from our recent discovery or knowledge.
- Only follow if this author aligns with our focus (Arena/AVAX narratives).

Return JSON: {"action":"like|repost|reply|follow|quote|none","rationale":"...","replyDraft":"optional reply text if action=reply or quote"}`;

    try {
      let response: string | undefined;
      const modelFallbacks = [
        ModelType.TEXT_SMALL,
        ModelType.TEXT_LARGE,
      ] as const;

      for (const model of modelFallbacks) {
        try {
          response = await this.runtime!.useModel(model, {
            prompt,
            temperature: 0.3,
            max_tokens: 220,
          });
          if (response) {
            break;
          }
        } catch (error) {
          logger.warn(
            `Arena engagement decision model ${model} failed, trying fallback`,
            error,
          );
        }
      }

      if (!response) {
        return null;
      }
      const clean = response
        .trim()
        .replace(/```json/gi, "")
        .replace(/```/g, "");
      const parsed = JSON.parse(clean);

      if (
        !parsed ||
        typeof parsed.action !== "string" ||
        typeof parsed.rationale !== "string"
      ) {
        return null;
      }

      return {
        action: parsed.action.toLowerCase(),
        rationale: parsed.rationale,
        replyDraft: typeof parsed.replyDraft === "string" ? parsed.replyDraft : undefined,
      };
    } catch (error) {
      logger.warn("Arena engagement decision failed", error);
      return null;
    }
  }

  private async executeEngagementDecision(
    candidate: DiscoverySnapshot["topThreads"][number],
    decision: { action: string; rationale: string; replyDraft?: string },
  ) {
    switch (decision.action) {
      case "like":
        if (this.engagementCounters.likes.count >= this.config.maxLikesPerHour) {
          logger.info(
            `[Arena Engagement] ❌ LIKE skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - hourly budget exhausted (${this.engagementCounters.likes.count}/${this.config.maxLikesPerHour})`,
          );
          return;
        }
        if (this.hasAlreadyEngaged(candidate.id, "like")) {
          logger.info(
            `[Arena Engagement] ⏭️  LIKE skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - already liked this thread`,
          );
          return;
        }
        logger.info(
          `[Arena Engagement] 👍 LIKE on @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) | Preview: "${candidate.preview.substring(0, 80)}..." | Rationale: ${decision.rationale}`,
        );
        await this.client.likeThread(candidate.id);
        this.engagementCounters.likes.count += 1;
        this.recordEngagement(candidate.id, "like", candidate.author);
        await this.logEngagement("like", candidate, decision.rationale);
        break;
      case "repost":
        if (
          this.engagementCounters.reposts.count >=
          this.config.maxRepostsPerHour
        ) {
          logger.info(
            `[Arena Engagement] ❌ REPOST skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - hourly budget exhausted (${this.engagementCounters.reposts.count}/${this.config.maxRepostsPerHour})`,
          );
          return;
        }
        if (this.hasAlreadyEngaged(candidate.id, "repost")) {
          logger.info(
            `[Arena Engagement] ⏭️  REPOST skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - already reposted this thread`,
          );
          return;
        }
        logger.info(
          `[Arena Engagement] 🔄 REPOST of @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) | Preview: "${candidate.preview.substring(0, 80)}..." | Rationale: ${decision.rationale}`,
        );
        await this.client.repostThread(candidate.id);
        this.engagementCounters.reposts.count += 1;
        this.recordEngagement(candidate.id, "repost", candidate.author);
        await this.logEngagement("repost", candidate, decision.rationale);
        break;
      case "reply":
        if (
          this.engagementCounters.replies.count >=
          this.config.maxRepliesPerHour
        ) {
          logger.info(
            `[Arena Engagement] ❌ REPLY skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - hourly budget exhausted (${this.engagementCounters.replies.count}/${this.config.maxRepliesPerHour})`,
          );
          return;
        }
        if (this.hasAlreadyEngaged(candidate.id, "reply")) {
          logger.info(
            `[Arena Engagement] ⏭️  REPLY skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - already replied to this thread`,
          );
          return;
        }
        if (!decision.replyDraft) {
          logger.warn(
            `[Arena Engagement] ❌ REPLY skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - no reply draft provided`,
          );
          return;
        }
        logger.info(
          `[Arena Engagement] 💬 REPLY to @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) | Original: "${candidate.preview.substring(0, 60)}..." | Reply: "${decision.replyDraft.substring(0, 120)}..." | Rationale: ${decision.rationale}`,
        );
        await this.client.replyToThread(candidate.id, decision.replyDraft);
        this.engagementCounters.replies.count += 1;
        this.recordEngagement(candidate.id, "reply", candidate.author);
        await this.logEngagement("reply", candidate, decision.rationale, decision.replyDraft);
        break;
      case "follow":
        if (
          this.engagementCounters.follows.count >=
          this.config.maxFollowsPerHour
        ) {
          logger.info(
            `[Arena Engagement] ❌ FOLLOW skipped for @${candidate.author} - hourly budget exhausted (${this.engagementCounters.follows.count}/${this.config.maxFollowsPerHour})`,
          );
          return;
        }
        // For follows, check by user handle (not thread ID)
        const userHandleKey = `user:${candidate.author.toLowerCase()}`;
        if (this.hasAlreadyEngaged(userHandleKey, "follow")) {
          logger.info(
            `[Arena Engagement] ⏭️  FOLLOW skipped for @${candidate.author} - already following this user`,
          );
          return;
        }
        logger.info(
          `[Arena Engagement] ➕ FOLLOW @${candidate.author} (${candidate.followerCount} followers) | Rationale: ${decision.rationale}`,
        );
        await this.client.followUserByHandle?.(candidate.author);
        this.engagementCounters.follows.count += 1;
        this.recordEngagement(userHandleKey, "follow", candidate.author);
        await this.logEngagement("follow", candidate, decision.rationale);
        break;
      case "quote":
        if (
          this.engagementCounters.reposts.count >=
          this.config.maxRepostsPerHour
        ) {
          logger.info(
            `[Arena Engagement] ❌ QUOTE skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - hourly budget exhausted (${this.engagementCounters.reposts.count}/${this.config.maxRepostsPerHour})`,
          );
          return;
        }
        if (this.hasAlreadyEngaged(candidate.id, "quote")) {
          logger.info(
            `[Arena Engagement] ⏭️  QUOTE skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - already quoted this thread`,
          );
          return;
        }
        if (!decision.replyDraft) {
          logger.warn(
            `[Arena Engagement] ❌ QUOTE skipped for @${candidate.author} (thread ${candidate.id.substring(0, 8)}...) - no quote text provided`,
          );
          return;
        }
        logger.info(
          `[Arena Engagement] 💭 QUOTE of @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) | Original: "${candidate.preview.substring(0, 60)}..." | Quote: "${decision.replyDraft.substring(0, 120)}..." | Rationale: ${decision.rationale}`,
        );
        await this.client.quoteThread(candidate.id, decision.replyDraft);
        this.engagementCounters.reposts.count += 1;
        this.recordEngagement(candidate.id, "quote", candidate.author);
        await this.logEngagement("quote", candidate, decision.rationale, decision.replyDraft);
        break;
      case "none":
      default:
        logger.debug(
          `[Arena Engagement] ⏭️  SKIP @${candidate.author}'s thread (${candidate.id.substring(0, 8)}...) | Rationale: ${decision.rationale}`,
        );
        await this.logEngagement("skip", candidate, decision.rationale);
        break;
    }
  }

  private async logEngagement(
    action: string,
    candidate: DiscoverySnapshot["topThreads"][number],
    rationale: string,
    text?: string,
  ) {
    if (!this.runtime?.createMemory) {
      return;
    }
    try {
      const memory: Memory = {
        id: uuidv4() as UUID,
        agentId: this.runtime.agentId,
        entityId: this.runtime.agentId,
        roomId: ARENA_ENGAGEMENT_ROOM_ID,
        worldId: ARENA_ENGAGEMENT_WORLD_ID,
        createdAt: Date.now(),
        content: {
          text:
            text ??
            `Engagement action: ${action} on @${candidate.author} (${candidate.preview})`,
          source: ARENA_ENGAGEMENT_SOURCE,
        } as Content,
        metadata: {
          type: "arena_engagement",
          source: ARENA_ENGAGEMENT_SOURCE,
          scope: "shared",
          timestamp: Date.now(),
          tags: ["arena", "engagement", action, candidate.author],
          rationale,
          candidate,
          action,
        },
      };

      await this.runtime.createMemory(memory, "memories", false);
    } catch (error) {
      logger.warn("Arena engagement memory store failed", error);
    }
  }
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getNumericField(
  source: Record<string, unknown> | undefined,
  fields: string[],
): number | undefined {
  if (!source) {
    return undefined;
  }
  for (const field of fields) {
    if (field in source) {
      const value = coerceNumber(source[field]);
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

function extractPreview(
  thread: ArenaThread,
  raw?: Record<string, unknown>,
): string {
  const candidates = [
    thread.content,
    (raw?.content as string | undefined) ?? (raw?.text as string | undefined),
    (raw?.summary as string | undefined) ?? (raw?.caption as string | undefined),
  ];
  const text = candidates.find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (!text) {
    return "[No content]";
  }
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

