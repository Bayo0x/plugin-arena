import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";

/**
 * Extract feed key from message text or structured content
 * Handles: "trending", "latest trending", "home feed", "suggested", etc.
 */
function resolveFeedKey(
  messageText: string | undefined,
  messageContent: Record<string, unknown>,
  fallback: string,
): string {
  // First check structured content
  const fromContent =
    (messageContent.feed as string | undefined) ??
    (messageContent.feedKey as string | undefined) ??
    (messageContent.channelSlug as string | undefined) ??
    (messageContent.slug as string | undefined) ??
    (messageContent.channel as string | undefined);

  if (fromContent && typeof fromContent === "string" && fromContent.trim().length > 0) {
    return fromContent.trim().toLowerCase();
  }

  // Extract from message text
  if (messageText) {
    const lowerText = messageText.toLowerCase();
    
    // Match "trending" patterns
    if (lowerText.includes("trending")) {
      return "trending";
    }
    
    // Match "suggested" patterns
    if (lowerText.includes("suggested")) {
      return "suggested";
    }
    
    // Match "home" or "my feed" patterns
    if (lowerText.includes("home") || lowerText.includes("my feed")) {
      return "home";
    }
    
    // Match "trenches" patterns
    if (lowerText.includes("trench")) {
      return "trenches";
    }
    
    // Match user feed patterns: "user:handle" or "@handle feed"
    const userMatch = messageText.match(/(?:user:|\@)(\w+)/i);
    if (userMatch) {
      return `user:${userMatch[1]}`;
    }
    
    // Match community patterns: "community:id"
    const communityMatch = messageText.match(/community:([a-f0-9-]+)/i);
    if (communityMatch) {
      return `community:${communityMatch[1]}`;
    }
  }

  return fallback;
}

export const fetchArenaChannelAction: Action = {
  name: "FETCH_ARENA_CHANNEL",
  description: "Fetch and return the latest threads from an Arena feed. Automatically detects feed type from request (trending, home, suggested, etc.). Returns actual thread content, authors, and engagement metrics. Execute immediately when user requests Arena content - do not ask for confirmation.",
  similes: ["ARENA_CHANNEL", "GET_ARENA_CHANNEL", "ARENA_FEED", "FETCH_ARENA_FEED", "GET_ARENA_THREADS", "ARENA_TRENDING"],
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback) => {
    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    const content = (message.content as Record<string, unknown>) ?? {};
    const messageText = typeof message.content === "string"
      ? message.content
      : (content.text as string | undefined) ||
        (content.summary as string | undefined) ||
        "";
    
    const feedKey = resolveFeedKey(messageText, content, config.defaultFeed);
    const userId =
      (content.userId as string | undefined) ?? config.defaultUserId;
    const communityId =
      (content.communityId as string | undefined) ?? config.communityId;

    const feedOptions: { userId?: string; communityId?: string } = {};
    if (userId && typeof userId === "string" && userId.trim().length > 0) {
      feedOptions.userId = userId.trim();
    }
    if (
      communityId &&
      typeof communityId === "string" &&
      communityId.trim().length > 0
    ) {
      feedOptions.communityId = communityId.trim();
    }

    try {
      const feed = await client.getFeed(feedKey, feedOptions);

      // Format top 5 threads as concise, actionable summary
      const top5 = feed.threads.slice(0, 5);
      const top5Text = top5
        .map((thread, index) => {
          const raw = thread.raw as Record<string, unknown> | undefined;
          const content = thread.content
            ? thread.content.replace(/<[^>]*>/g, "").trim()
            : "[No content]";
          const author = 
            thread.userHandle || 
            (raw?.user_handle as string | undefined) ||
            thread.userName || 
            (raw?.user_userName as string | undefined) ||
            "Unknown";
          const likeCount = 
            thread.stats?.likeCount || 
            (raw?.likeCount as number | undefined) ||
            0;
          const repostCount = 
            thread.stats?.repostCount || 
            (raw?.repostCount as number | undefined) ||
            0;
          const answerCount = 
            thread.stats?.answerCount || 
            (raw?.answerCount as number | undefined) ||
            0;
          const threadId = thread.id || (raw?.id as string | undefined) || "unknown";
          
          return `${index + 1}. @${author}: ${content.substring(0, 120)}${content.length > 120 ? "..." : ""} [${likeCount}👍 ${repostCount}🔄 ${answerCount}💬] (ID: ${threadId})`;
        })
        .join("\n");

      const summaryText = `Top 5 threads from Arena ${feedKey} feed:

${top5Text}

${feed.threads.length > 5 ? `\nTotal: ${feed.threads.length} threads fetched` : ""}`;

      if (callback) {
        await callback({
          text: summaryText,
          data: { 
            feed,
            threads: feed.threads,
            count: feed.threads.length,
            feedKey,
          },
        });
      }

      return {
        success: true,
        data: {
          feed,
          threads: feed.threads,
          count: feed.threads.length,
          feedKey,
          summary: summaryText,
        },
      };
    } catch (error) {
      logger.error(`Failed to fetch Arena feed ${feedKey}`, error);
      if (callback) {
        await callback({
          text: `Failed to fetch Arena feed ${feedKey}: ${error instanceof Error ? error.message : String(error)}`,
          data: { error: error instanceof Error ? error.message : error },
        });
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

