import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import { detectTrendingThreads } from "../utils/analytics";

export const analyzeTrendingAction: Action = {
  name: "ANALYZE_ARENA_TRENDING",
  similes: [
    "ARENA_TRENDING",
    "ARENA_WHAT_IS_TRENDING",
    "ARENA_VIRAL_POSTS",
    "ARENA_HOT_TOPICS",
    "ARENA_TRENDING_NOW",
  ],
  description:
    "Analyze trending content on Arena, identify viral posts, and detect emerging topics with high engagement velocity.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback) => {
    logger.info("Analyzing Arena trending content");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    try {
      // Parse parameters from message
      const content = (message.content as Record<string, unknown>) || {};
      const feedKey =
        (content.feed as string) || (content.feedKey as string) || "trending";
      const timeWindow = ((content.timeWindow as number) || 24) as number;
      const minEngagement = ((content.minEngagement as number) || 5) as number;
      const topN = ((content.topN as number) || content.limit || 10) as number;

      // Fetch feed
      const feed = await client.getFeed(feedKey, {
        page: 1,
        pageSize: 100, // Analyze more threads for better trending detection
      });

      logger.info(
        `Analyzing ${feed.threads.length} threads from ${feedKey} feed for trending content`,
      );

      // Detect trending threads
      const trending = detectTrendingThreads(feed.threads, {
        timeWindow,
        minEngagement,
        weightLikes: 1,
        weightReposts: 2,
        weightReplies: 1.5,
      });

      const topTrending = trending.slice(0, topN);

      if (topTrending.length === 0) {
        if (callback) {
          await callback({
            text: `No trending content found in ${feedKey} feed with minimum ${minEngagement} engagement in the last ${timeWindow} hours.`,
            data: { trending: [] },
          });
        }
        return {
          success: true,
          data: { trending: [] },
        };
      }

      // Format results
      const trendingText = topTrending
        .map((item, index) => {
          const t = item.thread;
          const preview = t.content.substring(0, 100) + (t.content.length > 100 ? "..." : "");
          return [
            `${index + 1}. @${t.userHandle} (Rank #${item.rank})`,
            `   Content: "${preview}"`,
            `   Score: ${item.score.toFixed(2)} | Velocity: ${item.velocityScore.toFixed(2)}/hr`,
            `   Engagement: 👍${t.likeCount} 🔄${t.repostCount} 💬${t.answerCount}`,
            `   Age: ${item.metrics.ageHours.toFixed(1)}h | Total: ${item.metrics.totalEngagement}`,
            ``,
          ].join("\n");
        })
        .join("\n");

      const summaryText = `🔥 Top ${topTrending.length} Trending Posts on Arena (${feedKey} feed)

Analyzed ${feed.threads.length} threads from the last ${timeWindow} hours
Minimum engagement threshold: ${minEngagement}

${trendingText}

Trending Insights:
- Highest velocity: ${topTrending[0]?.velocityScore.toFixed(2)} engagements/hour by @${topTrending[0]?.thread.userHandle}
- Most engaging: ${topTrending[0]?.metrics.totalEngagement} total engagements
- Average age: ${(topTrending.reduce((sum, t) => sum + t.metrics.ageHours, 0) / topTrending.length).toFixed(1)} hours

Use these insights to:
- Identify hot topics and join conversations
- Understand what content resonates
- Time your posts for maximum engagement`;

      if (callback) {
        await callback({
          text: summaryText,
          data: {
            trending: topTrending.map((item) => ({
              rank: item.rank,
              threadId: item.thread.id,
              author: item.thread.userHandle,
              content: item.thread.content.substring(0, 200),
              score: item.score,
              velocity: item.velocityScore,
              metrics: item.metrics,
            })),
            feed: feedKey,
            timeWindow,
            totalAnalyzed: feed.threads.length,
          },
        });
      }

      return {
        success: true,
        data: {
          trending: topTrending,
          feed: feedKey,
          totalAnalyzed: feed.threads.length,
        },
      };
    } catch (error) {
      logger.error("Failed to analyze Arena trending content", error);
      if (callback) {
        await callback({
          text: "Failed to analyze trending content. Please check your Arena credentials and try again.",
          error: true,
        });
      }
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "What's trending on Arena right now?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me analyze the trending content on Arena for you.",
          action: "ANALYZE_ARENA_TRENDING",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Show me the top viral posts from the last 12 hours",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll analyze viral posts from the last 12 hours.",
          action: "ANALYZE_ARENA_TRENDING",
        },
      },
    ],
  ],
};
