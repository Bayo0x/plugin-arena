import type { Content } from "@elizaos/core";

export interface ArenaUser {
  id: string;
  createdOn?: string;

  // Twitter/X integration
  twitterId?: string;
  twitterHandle?: string;
  twitterName?: string;
  twitterPicture?: string;
  lastLoginTwitterPicture?: string;

  // Profile
  userName?: string;
  handle?: string;
  profilePicture?: string;
  bannerUrl?: string;
  bio?: string;

  // Stats - CRITICAL: Added from real API
  followerCount: number;        // Required, default 0
  followingCount?: number;
  threadCount?: number;

  // Verification & badges
  isVerified?: boolean;
  badges?: unknown[];

  // Privacy & settings
  isPrivate?: boolean;
  isFollowing?: boolean;
  isFollowedBy?: boolean;

  // Wallet integrations
  solanaAddress?: string;
  dynamicUserId?: string;
}

export interface ArenaThreadFile {
  id: string;
  url: string;
  previewUrl?: string;
  fileType?: string;              // 'image', 'video', 'gif', etc.
  size?: number;
  width?: number;
  height?: number;
  duration?: number;              // For videos
  isLoading?: boolean;
}

export interface ArenaThreadStats {
  likeCount: number;              // Required with default 0
  answerCount: number;            // Required with default 0 (this is reply count)
  repostCount: number;            // Required with default 0
  bookmarkCount?: number;
  tipCount?: number;
  viewCount?: number;
}

export interface ArenaThread {
  [key: string]: unknown;  // Index signature for dynamic field access

  // Core fields
  id: string;
  content: string;
  contentUrl?: string;
  threadType?: string;

  // Author info
  userId: string;
  userName: string;
  userHandle: string;
  userPicture?: string;

  // Timestamps
  createdDate: string;
  updatedAt?: string;

  // Media
  files?: ArenaThreadFile[];
  images?: string[];
  videos?: string[];

  // Engagement stats - CRITICAL: Flattened to top level for easy access
  likeCount: number;              // Required with default 0
  repostCount: number;            // Required with default 0
  answerCount: number;            // Required with default 0 (reply count in API)
  bookmarkCount?: number;
  tipCount?: number;
  viewCount?: number;

  // User interaction state
  isLiked?: boolean;
  isReposted?: boolean;
  isBookmarked?: boolean;
  isTipped?: boolean;

  // Thread metadata
  isPinned?: boolean;
  privacyType?: number;
  communityId?: string;
  parentThreadId?: string;        // If this is a reply
  quotedThreadId?: string;        // If this is a quote

  // Additional metadata
  mentions?: string[];
  hashtags?: string[];
  urls?: string[];

  // Deprecated: kept for backward compat, but use top-level stats
  stats?: ArenaThreadStats;

  // Raw API response for fallback/debugging
  raw?: Record<string, unknown>;
}

export interface ArenaFeedResponse {
  threads: ArenaThread[];
  nextCursor?: string | null;
  count?: number;
  raw?: unknown;
}

export interface ArenaCreateThreadRequest {
  content: string;
  files?: ArenaThreadFile[];
  privacyType?: number;
  communityId?: string;
  xPostData?: Record<string, unknown>;
}

export interface ArenaConfig {
  [key: string]: unknown;  // Index signature for Metadata compatibility
  accessToken: string;
  baseUrl: string;
  userAgent?: string;
  defaultFeed: string;
  privacyType: number;
  communityId?: string;
  defaultUserId?: string;
  enablePost: boolean;
  postImmediately: boolean;
  postIntervalMinutes: number;
  postIntervalMin?: number;
  postIntervalMax?: number;
  dryRun: boolean;
  maxBlocksPerRun: number;
  targetFeeds: string[];
  // Engagement/Interaction settings
  enableReplies: boolean;
  enableActions: boolean; // Likes, reposts, quotes
  engagementInterval: number;
  engagementIntervalMin?: number;
  engagementIntervalMax?: number;
  maxEngagementsPerRun: number;
  // Discovery service settings
  enableDiscovery: boolean;
  discoveryInterval: number;
  discoveryIntervalMin?: number;
  discoveryIntervalMax?: number;
  minFollowerCount: number;
  maxFollowsPerCycle: number;
  // Other settings
  targetUsers: string[]; // Comma-separated user handles, "*" for all
  retryLimit: number;
  maxThreadLength: number;
  // LLM-driven engagement budgets
  enableEngagement: boolean;
  engagementDecisionInterval: number;
  engagementDecisionIntervalMin?: number;
  engagementDecisionIntervalMax?: number;
  maxLikesPerHour: number;
  maxRepostsPerHour: number;
  maxRepliesPerHour: number;
  maxFollowsPerHour: number;
}

export interface ArenaClientOptions {
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
}

export interface ArenaFeedOptions {
  feedKey?: string;
  userId?: string;
  communityId?: string;
  page?: number;
  limit?: number;
  pageSize?: number; // Some endpoints use pageSize instead of limit
  cursor?: string;
}

export interface ArenaCommunity {
  id: string;
  name?: string;
  description?: string;
  photoURL?: string;
  bannerURL?: string;
  followerCount?: number;
  tokenName?: string;
  ticker?: string;
  owner?: ArenaUser;
  stats?: {
    price?: string;
    marketCap?: string;
    marketCapUsd?: string;
    liquidity?: string;
  };
}

export interface ArenaNotification {
  id: string;
  createdOn?: string;
  userId?: string;
  title?: string;
  text?: string;
  link?: string;
  type?: number;
  isSeen?: boolean;
}

export interface ArenaNotificationsResponse {
  notifications: ArenaNotification[];
  pageSize?: number;
  numberOfPages?: number;
  numberOfResults?: number;
}

export interface ArenaCommunitiesResponse {
  communities: ArenaCommunity[];
}

export type ContentLike = string | Content | undefined | null;

