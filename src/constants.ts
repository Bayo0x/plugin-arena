export const ARENA_API_BASE_URL = "https://api.arena.social";

export const DEFAULT_FEED_KEY = "home";
export const DEFAULT_PRIVACY_TYPE = 0;

// Feed pagination defaults (per API docs recommendations)
export const DEFAULT_FEED_PAGE = 1;
export const DEFAULT_FEED_PAGE_SIZE = 50; // Recommended default from API docs
export const DEFAULT_FEED_MAX_PAGES = 3; // Safety limit for agent scans

export const DEFAULT_POST_INTERVAL_MINUTES = 120;
export const DEFAULT_POST_INTERVAL_MIN = 90;
export const DEFAULT_POST_INTERVAL_MAX = 150;
export const DEFAULT_MAX_BLOCKS_PER_RUN = 1;
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

// Engagement/Interaction defaults
export const DEFAULT_ENGAGEMENT_INTERVAL = 30;
export const DEFAULT_ENGAGEMENT_INTERVAL_MIN = 20;
export const DEFAULT_ENGAGEMENT_INTERVAL_MAX = 40;
export const DEFAULT_MAX_ENGAGEMENTS_PER_RUN = 5;

// Discovery service defaults
export const DEFAULT_DISCOVERY_INTERVAL = 30;
export const DEFAULT_DISCOVERY_INTERVAL_MIN = 15;
export const DEFAULT_DISCOVERY_INTERVAL_MAX = 30;
export const DEFAULT_MIN_FOLLOWER_COUNT = 0;
export const DEFAULT_MAX_FOLLOWS_PER_CYCLE = 5;

// Other defaults
export const DEFAULT_RETRY_LIMIT = 5;
export const DEFAULT_MAX_THREAD_LENGTH = 400; // Arena allows longer than Twitter

// Engagement defaults
export const DEFAULT_ENGAGEMENT_DECISION_INTERVAL = 20; // minutes
export const DEFAULT_MAX_LIKES_PER_HOUR = 10;
export const DEFAULT_MAX_REPOSTS_PER_HOUR = 4;
export const DEFAULT_MAX_REPLIES_PER_HOUR = 3;
export const DEFAULT_MAX_FOLLOWS_PER_HOUR = 2;

