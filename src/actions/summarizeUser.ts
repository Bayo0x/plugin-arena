import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import { DEFAULT_FEED_PAGE_SIZE } from "../constants";

/**
 * Extract user handle from various formats:
 * - @username
 * - userhandle username
 * - userId: username
 * - Structured content.userHandle
 */
function extractUserHandle(
  messageText: string | undefined,
  content: Record<string, unknown>,
): string | undefined {
  // First check structured content
  const fromContent = 
    (content.userHandle as string | undefined) ||
    (content.handle as string | undefined) ||
    (content.username as string | undefined);
  
  if (fromContent && typeof fromContent === "string" && fromContent.trim().length > 0) {
    return fromContent.trim().replace(/^@/, ""); // Remove @ if present
  }

  // Extract from message text
  if (messageText) {
    // Match @username patterns
    const mentionMatch = messageText.match(/@(\w+)/i);
    if (mentionMatch) {
      return mentionMatch[1];
    }

    // Match "userhandle username" or "handle username"
    const handleMatch = messageText.match(/(?:user)?handle\s+(\w+)/i);
    if (handleMatch) {
      return handleMatch[1];
    }

    // Match "username: X" or "user: X"
    const colonMatch = messageText.match(/(?:user)?(?:name|handle):\s*(\w+)/i);
    if (colonMatch) {
      return colonMatch[1];
    }

    // Try to find standalone username-like words (alphanumeric, no spaces)
    const words = messageText.split(/\s+/);
    for (const word of words) {
      const clean = word.trim().replace(/^@/, "").replace(/[^a-zA-Z0-9_]/g, "");
      if (clean.length >= 3 && clean.length <= 30 && /^[a-zA-Z]/.test(clean)) {
        // Likely a username
        return clean;
      }
    }
  }

  return undefined;
}

export const summarizeArenaUserAction: Action = {
  name: "SUMMARIZE_ARENA_USER",
  similes: [
    "ARENA_USER_SUMMARY",
    "GET_ARENA_USER_SUMMARY",
    "ARENA_USER_PROFILE",
    "ARENA_USER_STATS",
  ],
  description: "Get a summary of an Arena user's activity, including profile info and recent posts. Automatically extracts user handle from mentions (@username) or text. Execute immediately when user requests a user summary - do not ask for confirmation or preferences.",
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

    // Extract user handle from various sources
    const extractedHandle = extractUserHandle(messageText, content);
    const userHandle = extractedHandle || (content.userHandle as string | undefined);
    const userId = content.userId as string | undefined;
    const maxPages = (content.maxPages as number | undefined) ?? 3;

    if (!userHandle && !userId) {
      const error = "userHandle or userId is required. Please provide a username like @username or 'userhandle username'";
      logger.error(error);
      if (callback) {
        await callback({
          text: error,
          data: { error },
        });
      }
      return {
        success: false,
        error,
      };
    }

    try {
      // Get user profile
      let user;
      if (userHandle) {
        user = await client.getUserByHandle(userHandle.trim());
      } else if (userId) {
        // Fetch user by ID using the new client method
        user = await client.getUserById(userId.trim());
      }

      if (!user) {
        throw new Error("User not found - please provide a valid user handle or ID");
      }

      // Fetch user's posts
      const allThreads: Array<unknown> = [];
      for (let page = 1; page <= maxPages; page++) {
        const feed = await client.getFeed(`user:${user.id}`, {
          page,
          pageSize: DEFAULT_FEED_PAGE_SIZE,
        });
        allThreads.push(...feed.threads);
        if (feed.threads.length < DEFAULT_FEED_PAGE_SIZE) {
          break; // No more pages
        }
      }

      // Calculate stats
      const totalPosts = allThreads.length;
      let totalLikes = 0;
      let totalReposts = 0;
      let totalReplies = 0;
      let totalTips = 0;
      let totalTipAmount = 0;

      for (const thread of allThreads) {
        const t = thread as {
          likeCount?: number;
          repostCount?: number;
          answerCount?: number;
          tipCount?: number;
          tipAmount?: number;
          stats?: {
            likeCount?: number;
            repostCount?: number;
            answerCount?: number;
            tipCount?: number;
          };
          raw?: Record<string, unknown>;
        };
        
        // Check stats object first, then direct fields, then raw data
        const likeCount = t.stats?.likeCount ?? t.likeCount ?? (t.raw?.likeCount as number | undefined) ?? 0;
        const repostCount = t.stats?.repostCount ?? t.repostCount ?? (t.raw?.repostCount as number | undefined) ?? 0;
        const answerCount = t.stats?.answerCount ?? t.answerCount ?? (t.raw?.answerCount as number | undefined) ?? 0;
        const tipCount = t.tipCount ?? (t.raw?.tipCount as number | undefined) ?? 0;
        const tipAmount = t.tipAmount ?? (t.raw?.tipAmount as number | undefined) ?? 0;
        
        totalLikes += likeCount;
        totalReposts += repostCount;
        totalReplies += answerCount;
        totalTips += tipCount;
        totalTipAmount += tipAmount;
      }

      const avgLikes = totalPosts > 0 ? totalLikes / totalPosts : 0;
      const avgReposts = totalPosts > 0 ? totalReposts / totalPosts : 0;
      const avgReplies = totalPosts > 0 ? totalReplies / totalPosts : 0;

      // Find top posts by engagement
      const topPosts = (allThreads as Array<{
        id: string;
        content?: string;
        likeCount?: number;
        repostCount?: number;
        answerCount?: number;
        createdDate?: string;
        stats?: {
          likeCount?: number;
          repostCount?: number;
          answerCount?: number;
        };
        raw?: Record<string, unknown>;
      }>)
        .map((t) => {
          const likeCount = t.stats?.likeCount ?? t.likeCount ?? (t.raw?.likeCount as number | undefined) ?? 0;
          const repostCount = t.stats?.repostCount ?? t.repostCount ?? (t.raw?.repostCount as number | undefined) ?? 0;
          const answerCount = t.stats?.answerCount ?? t.answerCount ?? (t.raw?.answerCount as number | undefined) ?? 0;
          return {
            ...t,
            engagement: likeCount + repostCount + answerCount,
          };
        })
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, 5);

      // Format summary text for agent context
      const userInfo = `@${user.handle || user.id} (${user.userName || "Unknown"})`;
      const profileInfo = user.bio ? `\nBio: ${user.bio.replace(/<[^>]*>/g, "").trim()}` : "";
      const statsText = `
Stats:
- Total posts analyzed: ${totalPosts}
- Total likes: ${totalLikes} (avg: ${Math.round(avgLikes * 100) / 100} per post)
- Total reposts: ${totalReposts} (avg: ${Math.round(avgReposts * 100) / 100} per post)
- Total replies: ${totalReplies} (avg: ${Math.round(avgReplies * 100) / 100} per post)
- Followers: ${user.followerCount || 0}
- Following: ${user.followingCount || 0}
- Total threads: ${user.threadCount || 0}`;

      const topPostsText = topPosts.length > 0
        ? `\n\nTop ${topPosts.length} posts by engagement:\n${topPosts
            .map((p, idx) => {
              const content = p.content
                ? p.content.replace(/<[^>]*>/g, "").trim()
                : "[No content]";
              return `${idx + 1}. [${p.engagement} engagement] ${content.substring(0, 150)}${content.length > 150 ? "..." : ""}${p.createdDate ? ` (${new Date(p.createdDate).toLocaleDateString()})` : ""}`;
            })
            .join("\n")}`
        : "";

      // Format as concise, actionable summary
      const summaryText = `Arena User Summary: ${userInfo}${profileInfo}${statsText}${topPostsText}

Use this data to provide a direct summary to the user. Do not ask for preferences - just deliver the summary.`;

      const summary = {
        user: {
          id: user.id,
          handle: user.handle,
          userName: user.userName,
          profilePicture: user.profilePicture,
          bio: user.bio,
          followerCount: user.followerCount,
          followingCount: user.followingCount,
          threadCount: user.threadCount,
        },
        stats: {
          totalPosts,
          totalLikes,
          totalReposts,
          totalReplies,
          totalTips,
          totalTipAmount,
          avgLikes: Math.round(avgLikes * 100) / 100,
          avgReposts: Math.round(avgReposts * 100) / 100,
          avgReplies: Math.round(avgReplies * 100) / 100,
        },
        topPosts: topPosts.map((p) => ({
          id: p.id,
          content: p.content
            ? p.content.substring(0, 200) + (p.content.length > 200 ? "..." : "")
            : "",
          engagement: p.engagement,
          createdDate: p.createdDate,
        })),
      };

      if (callback) {
        await callback({
          text: summaryText,
          data: { summary },
        });
      }

      return {
        success: true,
        data: { summary },
      };
    } catch (error) {
      logger.error(
        `Failed to summarize Arena user ${userHandle || userId}`,
        error,
      );
      if (callback) {
        await callback({
          text: `Failed to summarize Arena user ${userHandle || userId}`,
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

