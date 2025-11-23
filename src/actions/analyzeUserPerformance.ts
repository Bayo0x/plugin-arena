import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import { analyzeUser } from "../utils/analytics";

export const analyzeUserPerformanceAction: Action = {
  name: "ANALYZE_ARENA_USER_PERFORMANCE",
  similes: [
    "ARENA_USER_ANALYTICS",
    "ARENA_USER_STATS",
    "ARENA_ANALYZE_USER",
    "ARENA_USER_PERFORMANCE",
    "ARENA_USER_INSIGHTS",
  ],
  description:
    "Analyze a user's performance on Arena including engagement metrics, influence score, growth trends, and content insights.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback) => {
    logger.info("Analyzing Arena user performance");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    try {
      // Parse parameters
      const content = (message.content as Record<string, unknown>) || {};
      const userHandle =
        (content.userHandle as string) ||
        (content.handle as string) ||
        (content.user as string);
      const threadCount = (content.threadCount as number) || 50;

      if (!userHandle) {
        throw new Error("User handle is required (e.g., @username)");
      }

      // Remove @ if present
      const cleanHandle = userHandle.startsWith("@")
        ? userHandle.substring(1)
        : userHandle;

      logger.info(`Analyzing performance for @${cleanHandle}`);

      // Get user by handle
      const user = await client.getUserByHandle(cleanHandle);

      // Analyze user
      const analytics = await analyzeUser(user.id, client, {
        threadCount,
        includeGrowth: true,
      });

      // Format influence tier description
      const tierDescriptions = {
        nano: "Nano influencer (<1K followers)",
        micro: "Micro influencer (1K-10K followers)",
        macro: "Macro influencer (10K-100K followers)",
        mega: "Mega influencer (100K+ followers)",
      };

      // Format peak hours
      const peakHoursText =
        analytics.metrics.peakPostingHours.length > 0
          ? analytics.metrics.peakPostingHours.map((h) => `${h}:00`).join(", ")
          : "Not enough data";

      // Format top performing threads
      const topThreadsText = analytics.metrics.topPerformingContent
        .slice(0, 3)
        .map((t, i) => {
          const engagement = t.likeCount + t.repostCount + t.answerCount;
          const preview = t.content.substring(0, 80) + (t.content.length > 80 ? "..." : "");
          return `   ${i + 1}. "${preview}"\n      Engagement: 👍${t.likeCount} 🔄${t.repostCount} 💬${t.answerCount} (Total: ${engagement})`;
        })
        .join("\n");

      // Engagement trend indicator
      const trendEmoji = {
        up: "📈 Rising",
        down: "📉 Declining",
        stable: "➡️ Stable",
      };

      const summaryText = `📊 Performance Analysis: @${cleanHandle}

👤 Profile:
- Followers: ${analytics.user.followerCount.toLocaleString()}
- Following: ${analytics.user.followingCount || 0}
- Total Threads: ${analytics.user.threadCount || "N/A"}
- Influence: ${tierDescriptions[analytics.influence.tier]}

📈 Engagement Metrics:
- Total Engagement: ${analytics.metrics.totalEngagement.toLocaleString()}
- Avg per Post: ${analytics.metrics.avgEngagementPerPost.toFixed(2)}
- Engagement Rate: ${(analytics.metrics.engagementRate * 100).toFixed(2)}%
- Posting Frequency: ${analytics.metrics.postFrequency.toFixed(1)} posts/day

💡 Insights:
- Influence Score: ${analytics.influence.score.toFixed(2)}
- Engagement Quality: ${(analytics.influence.engagementQuality * 100).toFixed(2)}%
- Trend: ${trendEmoji[analytics.growth.engagementTrend]} (${(analytics.growth.trendConfidence * 100).toFixed(0)}% confidence)
- Peak Posting Hours: ${peakHoursText}

🔥 Top Performing Content:
${topThreadsText}

Recommendations:
${analytics.influence.tier === "nano" || analytics.influence.tier === "micro" ? "- Focus on consistent posting to grow audience\n- Engage with larger accounts to increase visibility" : "- Leverage your influence to amplify important messages\n- Consider partnerships and collaborations"}
${analytics.growth.engagementTrend === "down" ? "- Review recent content strategy\n- Experiment with different content types" : "- Continue current content strategy"}
${analytics.metrics.engagementRate < 0.01 ? "- Improve engagement tactics (CTAs, questions, polls)" : "- Strong engagement rate - keep it up!"}`;

      if (callback) {
        await callback({
          text: summaryText,
          data: {
            user: {
              handle: analytics.user.handle || analytics.user.userName,
              followerCount: analytics.user.followerCount,
              followingCount: analytics.user.followingCount,
              threadCount: analytics.user.threadCount,
            },
            metrics: analytics.metrics,
            influence: analytics.influence,
            growth: analytics.growth,
            topPerforming: analytics.metrics.topPerformingContent.slice(0, 5).map((t) => ({
              id: t.id,
              content: t.content.substring(0, 200),
              likes: t.likeCount,
              reposts: t.repostCount,
              replies: t.answerCount,
            })),
          },
        });
      }

      return {
        success: true,
        data: { analytics },
      };
    } catch (error) {
      logger.error("Failed to analyze user performance", error);
      if (callback) {
        await callback({
          text: `Failed to analyze user performance: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          text: "Analyze @alice's Arena performance",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll analyze @alice's Arena performance and engagement metrics.",
          action: "ANALYZE_ARENA_USER_PERFORMANCE",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "How is @bob doing on Arena? Show me their stats",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me pull up @bob's Arena analytics for you.",
          action: "ANALYZE_ARENA_USER_PERFORMANCE",
        },
      },
    ],
  ],
};
