import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import { compareFeedPerformance } from "../utils/analytics";

export const compareFeedAction: Action = {
  name: "COMPARE_ARENA_FEEDS",
  similes: [
    "ARENA_FEED_COMPARISON",
    "ARENA_COMPARE_FEEDS",
    "ARENA_WHICH_FEED",
    "ARENA_BEST_FEED",
    "ARENA_FEED_ANALYSIS",
  ],
  description:
    "Compare multiple Arena feeds to identify which has the best engagement, most activity, and optimal content distribution.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback) => {
    logger.info("Comparing Arena feeds");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    try {
      // Parse parameters
      const content = (message.content as Record<string, unknown>) || {};
      let feedKeys: string[] = [];

      if (content.feeds && Array.isArray(content.feeds)) {
        feedKeys = content.feeds;
      } else if (content.feedKeys && Array.isArray(content.feedKeys)) {
        feedKeys = content.feedKeys;
      } else {
        // Default feeds to compare
        feedKeys = ["trending", "suggested", "my"];
      }

      const pageSize = (content.pageSize as number) || 50;

      logger.info(`Comparing ${feedKeys.length} Arena feeds: ${feedKeys.join(", ")}`);

      // Compare feeds
      const comparison = await compareFeedPerformance(client, feedKeys, {
        pageSize,
      });

      // Format results
      const feedSummaries = comparison.feeds
        .map((feed) => {
          const contentTypeText = Object.entries(feed.contentTypes)
            .filter(([_, count]) => count > 0)
            .map(([type, count]) => `${type}: ${count}`)
            .join(", ");

          const topAuthorsText = feed.topAuthors
            .slice(0, 3)
            .map((a) => `@${a.handle} (${a.count} posts, avg ${a.avgEngagement.toFixed(1)})`)
            .join(", ");

          return `📊 ${feed.name.toUpperCase()} Feed:
   Threads: ${feed.threadCount}
   Avg Engagement: ${feed.avgEngagement.toFixed(2)}
   - Likes: ${feed.avgLikes.toFixed(1)}
   - Reposts: ${feed.avgReposts.toFixed(1)}
   - Replies: ${feed.avgReplies.toFixed(1)}

   Distribution:
   - Viral (>100 eng): ${feed.engagementDistribution.viral}
   - Trending (>10/hr): ${feed.engagementDistribution.trending}
   - Normal: ${feed.engagementDistribution.normal}

   Content Types: ${contentTypeText || "No data"}
   Peak Activity: ${feed.peakActivity.hour}:00 (${feed.peakActivity.count} posts)
   Top Authors: ${topAuthorsText || "No data"}`;
        })
        .join("\n\n");

      const summaryText = `📈 Arena Feed Comparison Report

Analyzed ${feedKeys.length} feeds with ${pageSize} threads each

${feedSummaries}

🎯 Key Insights:
- Most Engaging: ${comparison.insights.mostEngaging} (best avg engagement)
- Most Active: ${comparison.insights.mostActive} (most threads)
- Best for Discovery: ${comparison.insights.bestForDiscovery} (most diverse authors)

💡 Recommendation: ${comparison.insights.recommendation}
Focus on the ${comparison.insights.recommendation} feed for optimal reach and engagement.

Strategy Tips:
${comparison.insights.mostEngaging === comparison.insights.recommendation ? "- This feed has the highest engagement - prioritize posting here" : "- Consider cross-posting to multiple feeds for maximum reach"}
${comparison.insights.bestForDiscovery !== comparison.insights.mostEngaging ? `- Use ${comparison.insights.bestForDiscovery} for discovering new connections` : "- Great balance of engagement and discovery"}`;

      if (callback) {
        await callback({
          text: summaryText,
          data: {
            feeds: comparison.feeds,
            insights: comparison.insights,
            feedKeys,
          },
        });
      }

      return {
        success: true,
        data: {
          comparison,
          feedKeys,
        },
      };
    } catch (error) {
      logger.error("Failed to compare feeds", error);
      if (callback) {
        await callback({
          text: `Failed to compare feeds: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          text: "Compare trending and suggested feeds on Arena",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll compare the trending and suggested feeds to see which has better engagement.",
          action: "COMPARE_ARENA_FEEDS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Which Arena feed should I focus on for maximum reach?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me analyze the different Arena feeds to recommend the best one for you.",
          action: "COMPARE_ARENA_FEEDS",
        },
      },
    ],
  ],
};
