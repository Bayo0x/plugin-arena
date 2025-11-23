import { logger } from "@elizaos/core";
import {
  ARENA_API_BASE_URL,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_FEED_PAGE,
  DEFAULT_FEED_PAGE_SIZE,
} from "../constants";
import type {
  ArenaClientOptions,
  ArenaCommunitiesResponse,
  ArenaCreateThreadRequest,
  ArenaFeedOptions,
  ArenaFeedResponse,
  ArenaNotificationsResponse,
  ArenaThread,
  ArenaUser,
} from "../types";

export class ArenaApiError extends Error {
  status: number;
  endpoint: string;
  details?: unknown;

  constructor(message: string, status: number, endpoint: string, details?: unknown) {
    super(message);
    this.name = "ArenaApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.details = details;
  }
}

function ensureFetch(): typeof fetch {
  if (typeof fetch === "function") {
    return fetch;
  }

  throw new Error(
    "Global fetch is not available. Please run on Node.js >= 18 or polyfill fetch.",
  );
}

export class ArenaClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl = ensureFetch();

  constructor(accessToken: string, options: ArenaClientOptions = {}) {
    if (!accessToken) {
      throw new Error("ArenaClient requires an access token");
    }

    this.token = accessToken;
    this.baseUrl = options.baseUrl ?? ARENA_API_BASE_URL;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    // Ensure token is valid (not NaN, null, undefined, or empty)
    if (!this.token || this.token === "NaN" || this.token === "null" || this.token === "undefined" || this.token.trim().length === 0) {
      throw new ArenaApiError(
        "Invalid or missing Arena access token",
        401,
        path,
        { token: this.token ? "present but invalid" : "missing" },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // Clean up any potential NaN values in headers
    const cleanHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.token.trim()}`,
    };
    if (this.userAgent && this.userAgent !== "NaN") {
      cleanHeaders["User-Agent"] = this.userAgent;
    }
    if (init.headers) {
      for (const [key, value] of Object.entries(init.headers)) {
        if (value && typeof value === "string" && value !== "NaN") {
          cleanHeaders[key] = value;
        }
      }
    }

    const fullUrl = `${this.baseUrl}${path}`;
    logger.debug(`Arena API Request: ${init.method || "GET"} ${fullUrl}`);

    try {
      const response = await this.fetchImpl(fullUrl, {
        ...init,
        headers: cleanHeaders,
        signal: controller.signal,
      });

      const text = await response.text();
      let data: unknown;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          if (!response.ok) {
            throw new ArenaApiError(
              text || `Arena request failed with ${response.status}`,
              response.status,
              path,
              text,
            );
          }

          logger.debug(
            `Arena request ${path} returned non-JSON response; passing raw text.`,
            parseError,
          );
          return text as unknown as T;
        }
      }

      if (!response.ok) {
        const message =
          (typeof data === "object" &&
            data !== null &&
            "message" in data &&
            typeof (data as { message?: string }).message === "string" &&
            (data as { message?: string }).message) ||
          text ||
          `Arena request failed with ${response.status}`;

        throw new ArenaApiError(message, response.status, path, data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof ArenaApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new ArenaApiError(
          `Arena request timed out after ${this.timeoutMs}ms`,
          408,
          path,
          error,
        );
      }

      throw new ArenaApiError(
        error instanceof Error ? error.message : "Arena request failed",
        500,
        path,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async me(): Promise<ArenaUser> {
    const response = await this.request<{ user?: ArenaUser } | ArenaUser>(
      "/user/me",
    );
    if (response && typeof response === "object" && "user" in response) {
      return (response as { user: ArenaUser }).user;
    }
    return response as ArenaUser;
  }

  async getFeed(
    feedKey: string,
    options: ArenaFeedOptions = {},
  ): Promise<ArenaFeedResponse> {
    // Validate token before making request
    if (!this.token || this.token.trim().length === 0) {
      throw new ArenaApiError(
        "Arena access token is required",
        401,
        "/threads/feed/*",
      );
    }

    // For "my" feed, verify token works first by calling /user/me
    const normalizedKey = (feedKey ?? "home").trim().toLowerCase();
    if (normalizedKey === "home" || normalizedKey === "my") {
      try {
        await this.me();
        logger.debug("Arena: Token validated via /user/me");
      } catch (error) {
        logger.warn("Arena: Token validation failed, feed request may fail", error);
        // Continue anyway - the feed endpoint might still work
      }
    }
    // Sanitize options to remove any NaN or invalid values
    const sanitizedOptions: ArenaFeedOptions = {};
    if (options.userId && typeof options.userId === "string" && options.userId.trim().length > 0) {
      sanitizedOptions.userId = options.userId.trim();
    }
    if (options.communityId && typeof options.communityId === "string" && options.communityId.trim().length > 0) {
      sanitizedOptions.communityId = options.communityId.trim();
    }
    if (options.page !== undefined && typeof options.page === "number" && !Number.isNaN(options.page) && options.page > 0) {
      sanitizedOptions.page = options.page;
    }
    if (options.limit !== undefined && typeof options.limit === "number" && !Number.isNaN(options.limit) && options.limit > 0) {
      sanitizedOptions.limit = options.limit;
    }
    if (options.pageSize !== undefined && typeof options.pageSize === "number" && !Number.isNaN(options.pageSize) && options.pageSize > 0) {
      sanitizedOptions.pageSize = options.pageSize;
    }
    if (options.cursor && typeof options.cursor === "string" && options.cursor.trim().length > 0) {
      sanitizedOptions.cursor = options.cursor.trim();
    }
    
    // Provide defaults according to API docs: page=1, pageSize=50 (recommended)
    if (!sanitizedOptions.page) {
      sanitizedOptions.page = DEFAULT_FEED_PAGE;
    }
    if (!sanitizedOptions.pageSize && !sanitizedOptions.limit) {
      sanitizedOptions.pageSize = DEFAULT_FEED_PAGE_SIZE;
    }

    const { path, query } = resolveFeedEndpoint(feedKey, sanitizedOptions);
    
    // Ensure query string doesn't contain NaN or invalid values
    let suffix = "";
    if (query) {
      // Double-check the query string doesn't contain NaN
      const queryParams = new URLSearchParams(query);
      const cleanParams = new URLSearchParams();
      for (const [key, value] of queryParams.entries()) {
        if (value !== "NaN" && value !== "null" && value !== "undefined" && value !== "") {
          cleanParams.set(key, value);
        }
      }
      const cleanQuery = cleanParams.toString();
      suffix = cleanQuery ? `?${cleanQuery}` : "";
    }
    
    const fullUrl = `${this.baseUrl}${path}${suffix}`;
    logger.debug(`Arena: Fetching feed ${feedKey} from ${fullUrl}`);
    
    try {
      const raw = await this.request<unknown>(`${path}${suffix}`);
      const normalized = normalizeFeedResponse(raw);
      normalized.raw = raw;
      logger.debug(`Arena: Successfully fetched ${normalized.threads.length} threads from ${feedKey}`);
      return normalized;
    } catch (error) {
      // If "my" feed fails with a 500 error, try "suggested" as fallback
      if (
        (normalizedKey === "home" || normalizedKey === "my") &&
        error instanceof ArenaApiError &&
        error.status === 500 &&
        error.message.includes("NaN")
      ) {
        logger.warn(
          `Arena: /threads/feed/my failed, trying /threads/feed/suggested as fallback`,
        );
        try {
          const fallbackRaw = await this.request<unknown>("/threads/feed/suggested");
          const fallbackNormalized = normalizeFeedResponse(fallbackRaw);
          fallbackNormalized.raw = fallbackRaw;
          logger.info(
            `Arena: Fallback to suggested feed successful, fetched ${fallbackNormalized.threads.length} threads`,
          );
          return fallbackNormalized;
        } catch (fallbackError) {
          logger.error(
            `Arena: Fallback to suggested feed also failed`,
            fallbackError,
          );
        }
      }
      logger.error(`Arena: Failed to fetch feed ${feedKey} from ${fullUrl}`, error);
      throw error;
    }
  }

  async createThread(
    request: ArenaCreateThreadRequest,
  ): Promise<ArenaThread> {
    const payload = {
      content: request.content,
      files: request.files ?? [],
      privacyType: request.privacyType ?? 0,
      ...(request.communityId ? { communityId: request.communityId } : {}),
      ...(request.xPostData ? { xPostData: request.xPostData } : {}),
    };

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async getUserByHandle(handle: string): Promise<ArenaUser> {
    if (!handle || typeof handle !== "string" || handle.trim().length === 0) {
      throw new Error("getUserByHandle requires a non-empty handle");
    }

    const response = await this.request<{ user?: ArenaUser } | ArenaUser>(
      `/user/handle?handle=${encodeURIComponent(handle.trim())}`,
    );

    if (response && typeof response === "object" && "user" in response) {
      return (response as { user: ArenaUser }).user;
    }

    return response as ArenaUser;
  }

  async getNotifications(options: {
    page?: number;
    pageSize?: number;
  } = {}): Promise<ArenaNotificationsResponse> {
    const query = buildQuery({
      page: options.page,
      pageSize: options.pageSize,
    });

    const suffix = query ? `?${query}` : "";
    return this.request<ArenaNotificationsResponse>(`/notifications${suffix}`);
  }

  async getTrendingCommunities(): Promise<ArenaCommunitiesResponse> {
    return this.request<ArenaCommunitiesResponse>("/communities/trending");
  }

  async likeThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("likeThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/like",
      {
        method: "POST",
        body: JSON.stringify({ threadId: threadId.trim() }),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async unlikeThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("unlikeThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/unlike",
      {
        method: "POST",
        body: JSON.stringify({ threadId: threadId.trim() }),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async repostThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("repostThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/repost",
      {
        method: "POST",
        body: JSON.stringify({ threadId: threadId.trim() }),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async undoRepost(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("undoRepost requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      `/threads/repost?threadId=${encodeURIComponent(threadId.trim())}`,
      {
        method: "DELETE",
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async quoteThread(
    threadId: string,
    content: string,
    options?: {
      privacyType?: number;
      communityId?: string;
    },
  ): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("quoteThread requires a non-empty threadId");
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("quoteThread requires non-empty content");
    }

    const payload: Record<string, unknown> = {
      threadId: threadId.trim(),
      content: content.trim(),
    };

    if (options?.privacyType !== undefined) {
      payload.privacyType = options.privacyType;
    }
    if (options?.communityId) {
      payload.communityId = options.communityId;
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/quote",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async replyToThread(
    threadId: string,
    content: string,
    options?: {
      privacyType?: number;
      userId?: string;
      files?: string[];
    },
  ): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("replyToThread requires a non-empty threadId");
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("replyToThread requires non-empty content");
    }

    // Get current user to get userId if not provided
    let userId = options?.userId;
    if (!userId) {
      const me = await this.me();
      userId = me.id;
    }

    const payload: Record<string, unknown> = {
      threadId: threadId.trim(),
      content: content.trim(),
      files: options?.files || [],
      privacyType: options?.privacyType ?? 0,
      userId: userId,
    };

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/answer",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  // ========== THREAD MANAGEMENT ==========

  async getThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("getThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      `/threads?threadId=${encodeURIComponent(threadId.trim())}`,
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("deleteThread requires a non-empty threadId");
    }

    await this.request<void>(
      `/threads?threadId=${encodeURIComponent(threadId.trim())}`,
      {
        method: "DELETE",
      },
    );
  }

  async updateThread(threadId: string, content: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("updateThread requires a non-empty threadId");
    }
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      throw new Error("updateThread requires non-empty content");
    }

    return this.request<ArenaThread>(`/threads/${threadId.trim()}`, {
      method: "PATCH",
      body: JSON.stringify({ content: content.trim() }),
    });
  }

  async getThreadAnswers(
    threadId: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<{ answers: ArenaThread[] }> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("getThreadAnswers requires a non-empty threadId");
    }

    const query = buildQuery({
      threadId: threadId.trim(),
      page: options?.page,
      pageSize: options?.pageSize,
    });

    return this.request<{ answers: ArenaThread[] }>(`/threads/answers?${query}`);
  }

  // ========== BOOKMARKS ==========

  async bookmarkThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("bookmarkThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/bookmark",
      {
        method: "POST",
        body: JSON.stringify({ threadId: threadId.trim() }),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async unbookmarkThread(threadId: string): Promise<ArenaThread> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("unbookmarkThread requires a non-empty threadId");
    }

    const response = await this.request<{ thread?: ArenaThread } | ArenaThread>(
      "/threads/unbookmark",
      {
        method: "POST",
        body: JSON.stringify({ threadId: threadId.trim() }),
      },
    );

    if (response && typeof response === "object" && "thread" in response) {
      return (response as { thread: ArenaThread }).thread;
    }

    return response as ArenaThread;
  }

  async getBookmarks(options?: {
    page?: number;
    pageSize?: number;
  }): Promise<{ threads: ArenaThread[] }> {
    const query = buildQuery({
      page: options?.page,
      pageSize: options?.pageSize,
    });

    const suffix = query ? `?${query}` : "";
    return this.request<{ threads: ArenaThread[] }>(`/threads/bookmarks${suffix}`);
  }

  // ========== PIN THREAD ==========

  async pinThread(threadId: string, pin: boolean): Promise<void> {
    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      throw new Error("pinThread requires a non-empty threadId");
    }

    await this.request<void>("/threads/pin", {
      method: "POST",
      body: JSON.stringify({
        threadId: threadId.trim(),
        pin,
      }),
    });
  }

  // ========== USER MANAGEMENT ==========

  async getUserById(userId: string): Promise<ArenaUser> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("getUserById requires a non-empty userId");
    }

    const response = await this.request<{ user?: ArenaUser } | ArenaUser>(
      `/user?userId=${encodeURIComponent(userId.trim())}`,
    );

    if (response && typeof response === "object" && "user" in response) {
      return (response as { user: ArenaUser }).user;
    }

    return response as ArenaUser;
  }

  // ========== FOLLOW/UNFOLLOW ==========

  async followUser(userId: string): Promise<void> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("followUser requires a non-empty userId");
    }

    await this.request<void>("/follow/follow", {
      method: "POST",
      body: JSON.stringify({ userId: userId.trim() }),
    });
  }

  async followUserByHandle(handle: string): Promise<void> {
    if (!handle || typeof handle !== "string" || handle.trim().length === 0) {
      throw new Error("followUserByHandle requires a non-empty handle");
    }

    // First, get user ID from handle
    const user = await this.getUserByHandle(handle);

    // Then follow by user ID
    await this.followUser(user.id);
  }

  async unfollowUser(userId: string): Promise<void> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("unfollowUser requires a non-empty userId");
    }

    await this.request<void>("/follow/unfollow", {
      method: "POST",
      body: JSON.stringify({ userId: userId.trim() }),
    });
  }

  async getFollowers(
    userId: string,
    options?: { page?: number; pageSize?: number; searchString?: string },
  ): Promise<{ followers: ArenaUser[] }> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("getFollowers requires a non-empty userId");
    }

    const query = buildQuery({
      followersOfUserId: userId.trim(),
      pageNumber: options?.page,
      pageSize: options?.pageSize,
      searchString: options?.searchString,
    });

    return this.request<{ followers: ArenaUser[] }>(`/follow/followers/list?${query}`);
  }

  async getFollowing(
    userId: string,
    options?: { page?: number; pageSize?: number; searchString?: string },
  ): Promise<{ following: ArenaUser[] }> {
    if (!userId || typeof userId !== "string" || userId.trim().length === 0) {
      throw new Error("getFollowing requires a non-empty userId");
    }

    const query = buildQuery({
      followersOfUserId: userId.trim(),
      pageNumber: options?.page,
      pageSize: options?.pageSize,
      searchString: options?.searchString,
    });

    return this.request<{ following: ArenaUser[] }>(`/follow/following/list?${query}`);
  }
}

const FEED_ENDPOINTS: Record<string, string> = {
  home: "/threads/feed/my",
  my: "/threads/feed/my",
  suggested: "/threads/feed/suggested",
  trending: "/threads/feed/trendingPosts",
  trendingposts: "/threads/feed/trendingPosts",
  public: "/threads/public",
  trenches: "/threads/feed/trenchesFeedPosts",
};

function resolveFeedEndpoint(
  feedKey?: string,
  options: ArenaFeedOptions = {},
): { path: string; query?: string } {
  const normalized = (feedKey ?? "home").trim().toLowerCase();

  if (normalized.startsWith("user:")) {
    const userId = normalized.slice(5).trim() || options.userId;
    if (userId && typeof userId === "string" && userId.length > 0) {
      return {
        path: "/threads/feed/user",
        query: buildQuery({
          userId,
          page: options.page,
          pageSize: options.pageSize ?? options.limit,
        }),
      };
    }
  }

  if (normalized.startsWith("community:")) {
    const communityId = normalized.slice(10).trim() || options.communityId;
    if (
      communityId &&
      typeof communityId === "string" &&
      communityId.length > 0
    ) {
      return {
        path: "/threads/feed/community",
        query: buildQuery({
          communityId,
          page: options.page,
          pageSize: options.pageSize ?? options.limit,
        }),
      };
    }
  }

  const path = FEED_ENDPOINTS[normalized] ?? "/threads/feed/my";
  
  // All feed endpoints accept page and pageSize according to the API docs
  // trendingPosts and trenchesFeedPosts use pageSize
  // my, suggested, and user feeds also use pageSize (not limit)
  const isTrendingPosts = normalized === "trending" || normalized === "trendingposts";
  const isTrenchesFeed = normalized === "trenches" || normalized === "trenchesfeed";
  
  // All feeds use pageSize, not limit
  const query = buildQuery({
    page: options.page,
    pageSize: options.pageSize ?? options.limit,
    cursor: options.cursor,
  });

  return { path, query };
}

function buildQuery(
  params: Record<string, string | number | undefined>,
): string | undefined {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    // Check for NaN (works for both number and string "NaN")
    if (typeof value === "number" && Number.isNaN(value)) {
      return;
    }

    const stringValue = String(value);
    if (stringValue === "NaN" || stringValue === "null" || stringValue === "undefined") {
      return;
    }

    query.set(key, stringValue);
  });
  return query.toString() || undefined;
}

function normalizeFeedResponse(data: unknown): ArenaFeedResponse {
  if (Array.isArray(data)) {
    return { threads: data as ArenaThread[] };
  }

  if (data && typeof data === "object") {
    const maybeThreads = (data as Record<string, unknown>).threads;
    if (Array.isArray(maybeThreads)) {
      return {
        threads: maybeThreads as ArenaThread[],
        nextCursor: (data as Record<string, unknown>).nextCursor as
          | string
          | undefined,
        count: (data as Record<string, unknown>).count as number | undefined,
      };
    }

    const maybeData = (data as Record<string, unknown>).data;
    if (Array.isArray(maybeData)) {
      return {
        threads: maybeData as ArenaThread[],
        nextCursor: (data as Record<string, unknown>).nextCursor as
          | string
          | undefined,
        count: (data as Record<string, unknown>).count as number | undefined,
      };
    }
  }

  return { threads: [] };
}

