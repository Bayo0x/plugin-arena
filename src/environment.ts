import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import {
  ARENA_API_BASE_URL,
  DEFAULT_DISCOVERY_INTERVAL,
  DEFAULT_DISCOVERY_INTERVAL_MAX,
  DEFAULT_DISCOVERY_INTERVAL_MIN,
  DEFAULT_ENGAGEMENT_DECISION_INTERVAL,
  DEFAULT_ENGAGEMENT_INTERVAL,
  DEFAULT_ENGAGEMENT_INTERVAL_MAX,
  DEFAULT_ENGAGEMENT_INTERVAL_MIN,
  DEFAULT_FEED_KEY,
  DEFAULT_MAX_BLOCKS_PER_RUN,
  DEFAULT_MAX_ENGAGEMENTS_PER_RUN,
  DEFAULT_MAX_FOLLOWS_PER_CYCLE,
  DEFAULT_MAX_FOLLOWS_PER_HOUR,
  DEFAULT_MAX_LIKES_PER_HOUR,
  DEFAULT_MAX_REPLIES_PER_HOUR,
  DEFAULT_MAX_REPOSTS_PER_HOUR,
  DEFAULT_MAX_THREAD_LENGTH,
  DEFAULT_MIN_FOLLOWER_COUNT,
  DEFAULT_POST_INTERVAL_MAX,
  DEFAULT_POST_INTERVAL_MIN,
  DEFAULT_POST_INTERVAL_MINUTES,
  DEFAULT_PRIVACY_TYPE,
  DEFAULT_RETRY_LIMIT,
} from "./constants";
import type { ArenaConfig } from "./types";

const BOOLEAN_TRUE_VALUES = new Set([
  "true",
  "1",
  "yes",
  "y",
  "on",
  "enabled",
]);

function readSetting(runtime: IAgentRuntime | undefined, key: string) {
  try {
    const value = runtime?.getSetting?.(key);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  } catch (error) {
    logger.debug(`Arena config: failed to read runtime setting ${key}`, error);
  }

  return process.env[key];
}

function requireSetting(
  runtime: IAgentRuntime | undefined,
  key: string,
): string {
  const value = readSetting(runtime, key);

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`Missing required Arena setting: ${key}`);
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return BOOLEAN_TRUE_VALUES.has(value.toLowerCase());
  }

  return fallback;
}

function toNumber(value: unknown, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));

  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return fallback;
}

export function loadArenaConfig(runtime?: IAgentRuntime): ArenaConfig {
  const accessToken = requireSetting(runtime, "ARENA_ACCESS_TOKEN");

  const feedSetting =
    (readSetting(runtime, "ARENA_DEFAULT_FEED") ??
      readSetting(runtime, "ARENA_DEFAULT_CHANNEL_SLUG")) ?? DEFAULT_FEED_KEY;
  const defaultFeed =
    typeof feedSetting === "string" && feedSetting.trim().length > 0
      ? feedSetting.trim().toLowerCase()
      : DEFAULT_FEED_KEY;

  const privacyType =
    toNumber(readSetting(runtime, "ARENA_PRIVACY_TYPE"), DEFAULT_PRIVACY_TYPE) ??
    DEFAULT_PRIVACY_TYPE;
  const communityId = (() => {
    const value = readSetting(runtime, "ARENA_DEFAULT_COMMUNITY_ID");
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  })();
  const defaultUserId = (() => {
    const value = readSetting(runtime, "ARENA_DEFAULT_USER_ID");
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  })();

  const enablePost = toBoolean(readSetting(runtime, "ARENA_ENABLE_POST"));
  const postImmediately = toBoolean(
    readSetting(runtime, "ARENA_POST_IMMEDIATELY"),
  );
  const dryRun = toBoolean(readSetting(runtime, "ARENA_DRY_RUN"));

  const postIntervalMinutes =
    toNumber(readSetting(runtime, "ARENA_POST_INTERVAL")) ??
    DEFAULT_POST_INTERVAL_MINUTES;
  const postIntervalMin = toNumber(
    readSetting(runtime, "ARENA_POST_INTERVAL_MIN"),
    DEFAULT_POST_INTERVAL_MIN,
  );
  const postIntervalMax = toNumber(
    readSetting(runtime, "ARENA_POST_INTERVAL_MAX"),
    DEFAULT_POST_INTERVAL_MAX,
  );

  const maxBlocksPerRun =
    toNumber(readSetting(runtime, "ARENA_MAX_BLOCKS_PER_RUN")) ??
    DEFAULT_MAX_BLOCKS_PER_RUN;

  const targetFeedsRaw =
    readSetting(runtime, "ARENA_TARGET_FEEDS") ??
    readSetting(runtime, "ARENA_TARGET_CHANNELS");
  const targetFeeds = typeof targetFeedsRaw === "string"
    ? targetFeedsRaw
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean)
    : [];

  // Engagement/Interaction settings
  const enableReplies = toBoolean(readSetting(runtime, "ARENA_ENABLE_REPLIES"), true);
  const enableActions = toBoolean(readSetting(runtime, "ARENA_ENABLE_ACTIONS"), false);
  
  const engagementInterval =
    toNumber(readSetting(runtime, "ARENA_ENGAGEMENT_INTERVAL"), DEFAULT_ENGAGEMENT_INTERVAL) ??
    DEFAULT_ENGAGEMENT_INTERVAL;
  const engagementIntervalMin = toNumber(
    readSetting(runtime, "ARENA_ENGAGEMENT_INTERVAL_MIN"),
    DEFAULT_ENGAGEMENT_INTERVAL_MIN,
  );
  const engagementIntervalMax = toNumber(
    readSetting(runtime, "ARENA_ENGAGEMENT_INTERVAL_MAX"),
    DEFAULT_ENGAGEMENT_INTERVAL_MAX,
  );
  
  const maxEngagementsPerRun =
    toNumber(readSetting(runtime, "ARENA_MAX_ENGAGEMENTS_PER_RUN"), DEFAULT_MAX_ENGAGEMENTS_PER_RUN) ??
    DEFAULT_MAX_ENGAGEMENTS_PER_RUN;

  // Discovery service settings
  // Defaults to true if ACTIONS enabled, otherwise false
  const enableDiscoveryRaw = readSetting(runtime, "ARENA_ENABLE_DISCOVERY");
  const enableDiscovery = enableDiscoveryRaw !== undefined
    ? toBoolean(enableDiscoveryRaw)
    : enableActions; // Default to enableActions value if not set

  const discoveryInterval =
    toNumber(readSetting(runtime, "ARENA_DISCOVERY_INTERVAL"), DEFAULT_DISCOVERY_INTERVAL) ??
    DEFAULT_DISCOVERY_INTERVAL;
  const discoveryIntervalMin = toNumber(
    readSetting(runtime, "ARENA_DISCOVERY_INTERVAL_MIN"),
    DEFAULT_DISCOVERY_INTERVAL_MIN,
  );
  const discoveryIntervalMax = toNumber(
    readSetting(runtime, "ARENA_DISCOVERY_INTERVAL_MAX"),
    DEFAULT_DISCOVERY_INTERVAL_MAX,
  );
  
  const minFollowerCount =
    toNumber(readSetting(runtime, "ARENA_MIN_FOLLOWER_COUNT"), DEFAULT_MIN_FOLLOWER_COUNT) ??
    DEFAULT_MIN_FOLLOWER_COUNT;
  const maxFollowsPerCycle =
    toNumber(readSetting(runtime, "ARENA_MAX_FOLLOWS_PER_CYCLE"), DEFAULT_MAX_FOLLOWS_PER_CYCLE) ??
    DEFAULT_MAX_FOLLOWS_PER_CYCLE;

  // Other settings
  const targetUsersRaw = readSetting(runtime, "ARENA_TARGET_USERS");
  const targetUsers = typeof targetUsersRaw === "string"
    ? targetUsersRaw
        .split(",")
        .map((user) => user.trim())
        .filter(Boolean)
    : [];

  const retryLimit =
    toNumber(readSetting(runtime, "ARENA_RETRY_LIMIT"), DEFAULT_RETRY_LIMIT) ??
    DEFAULT_RETRY_LIMIT;
  const maxThreadLength =
    toNumber(readSetting(runtime, "ARENA_MAX_THREAD_LENGTH"), DEFAULT_MAX_THREAD_LENGTH) ??
    DEFAULT_MAX_THREAD_LENGTH;

  const enableEngagement = toBoolean(
    readSetting(runtime, "ARENA_ENABLE_ENGAGEMENT"),
  );
  const engagementDecisionInterval =
    toNumber(
      readSetting(runtime, "ARENA_ENGAGEMENT_DECISION_INTERVAL"),
      DEFAULT_ENGAGEMENT_DECISION_INTERVAL,
    ) ?? DEFAULT_ENGAGEMENT_DECISION_INTERVAL;
  const engagementDecisionIntervalMin = toNumber(
    readSetting(runtime, "ARENA_ENGAGEMENT_DECISION_INTERVAL_MIN"),
    DEFAULT_ENGAGEMENT_DECISION_INTERVAL,
  );
  const engagementDecisionIntervalMax = toNumber(
    readSetting(runtime, "ARENA_ENGAGEMENT_DECISION_INTERVAL_MAX"),
    DEFAULT_ENGAGEMENT_DECISION_INTERVAL,
  );
  const maxLikesPerHour =
    toNumber(
      readSetting(runtime, "ARENA_MAX_LIKES_PER_HOUR"),
      DEFAULT_MAX_LIKES_PER_HOUR,
    ) ?? DEFAULT_MAX_LIKES_PER_HOUR;
  const maxRepostsPerHour =
    toNumber(
      readSetting(runtime, "ARENA_MAX_REPOSTS_PER_HOUR"),
      DEFAULT_MAX_REPOSTS_PER_HOUR,
    ) ?? DEFAULT_MAX_REPOSTS_PER_HOUR;
  const maxRepliesPerHour =
    toNumber(
      readSetting(runtime, "ARENA_MAX_REPLIES_PER_HOUR"),
      DEFAULT_MAX_REPLIES_PER_HOUR,
    ) ?? DEFAULT_MAX_REPLIES_PER_HOUR;
  const maxFollowsPerHour =
    toNumber(
      readSetting(runtime, "ARENA_MAX_FOLLOWS_PER_HOUR"),
      DEFAULT_MAX_FOLLOWS_PER_HOUR,
    ) ?? DEFAULT_MAX_FOLLOWS_PER_HOUR;

  return {
    accessToken,
    baseUrl:
      readSetting(runtime, "ARENA_BASE_URL") ?? ARENA_API_BASE_URL,
    userAgent: readSetting(runtime, "ARENA_USER_AGENT") ?? undefined,
    defaultFeed,
    privacyType,
    communityId,
    defaultUserId,
    enablePost,
    postImmediately,
    postIntervalMinutes,
    postIntervalMin,
    postIntervalMax,
    dryRun,
    maxBlocksPerRun,
    targetFeeds,
    enableReplies,
    enableActions,
    engagementInterval,
    engagementIntervalMin,
    engagementIntervalMax,
    maxEngagementsPerRun,
    enableDiscovery,
    discoveryInterval,
    discoveryIntervalMin,
    discoveryIntervalMax,
    minFollowerCount,
    maxFollowsPerCycle,
    targetUsers,
    retryLimit,
    maxThreadLength,
    enableEngagement,
    engagementDecisionInterval,
    engagementDecisionIntervalMin,
    engagementDecisionIntervalMax,
    maxLikesPerHour,
    maxRepostsPerHour,
    maxRepliesPerHour,
    maxFollowsPerHour,
  };
}

