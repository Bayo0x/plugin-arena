/**
 * Get Current Trending Data Action
 *
 * Queries the trending monitor service for latest trending posts, topics, and tokens
 * Used by agent to access real-time trending information for decisions
 */

import type {
  Action,
  ActionExample,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { logger } from "@elizaos/core";
import type { ArenaTrendingMonitorService } from "../services/trendingMonitor";

export const getTrendingAction: Action = {
  name: "GET_ARENA_TRENDING",
  description:
    "Get current trending posts, topics, and tokens from Arena. Use this to understand what's hot right now for trading decisions and content creation.",
  similes: [
    "ARENA_TRENDING",
    "WHATS_TRENDING",
    "TRENDING_NOW",
    "HOT_TOPICS",
    "EMERGING_TOKENS",
  ],
  validate: async (runtime: IAgentRuntime, _message: Memory) => {
    // Check if trending monitor service is available
    const service = runtime.getService<ArenaTrendingMonitorService>(
      "arena_trending_monitor"
    );
    return service !== undefined;
  },
  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State,
    _options: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    logger.info("[GET_ARENA_TRENDING] Fetching trending data");

    try {
      const service = runtime.getService<ArenaTrendingMonitorService>(
        "arena_trending_monitor"
      );

      if (!service) {
        const errorMsg = "Trending monitor service not available. Enable ARENA_TRENDING_MONITOR_ENABLED=true";
        logger.error(`[GET_ARENA_TRENDING] ${errorMsg}`);

        if (callback) {
          await callback({
            text: errorMsg,
            error: true,
          });
        }

        return { success: false, error: errorMsg };
      }

      // Get latest trending data
      const trending = await service.getLatestTrending();

      if (!trending) {
        const msg = "No trending data available yet. Service may still be initializing.";
        logger.warn(`[GET_ARENA_TRENDING] ${msg}`);

        if (callback) {
          await callback({
            text: msg,
          });
        }

        return { success: false, error: msg };
      }

      // Format response for agent
      const trendingTopics = trending.topTopics.slice(0, 5).join(", ");
      const emergingTokens = trending.emergingTokens.slice(0, 5).join(", ");
      const topPosts = trending.trendingThreads.slice(0, 3);

      const responseText = [
        `ARENA TRENDING DATA (${trending.feed} feed)`,
        `Updated: ${new Date(trending.timestamp).toLocaleString()}`,
        ``,
        `Hot Topics: ${trendingTopics || "None detected"}`,
        `Emerging Tokens: ${emergingTokens || "None detected"}`,
        ``,
        `Top 3 Trending Posts:`,
        ...topPosts.map((post, i) => {
          const preview = post.thread.content.substring(0, 100).replace(/\n/g, " ");
          return `${i + 1}. [Score: ${post.velocityScore.toFixed(1)}] "${preview}..."`;
        }),
      ].join("\n");

      logger.info(`[GET_ARENA_TRENDING] Found ${trending.trendingThreads.length} trending posts`);

      if (callback) {
        await callback({
          text: responseText,
          action: "GET_ARENA_TRENDING",
          metadata: {
            topics: trending.topTopics,
            tokens: trending.emergingTokens,
            postCount: trending.trendingThreads.length,
            timestamp: trending.timestamp,
          },
        });
      }

      return { success: true, data: trending };
    } catch (error) {
      const errorMsg = `Failed to get trending data: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[GET_ARENA_TRENDING] ${errorMsg}`, error);

      if (callback) {
        await callback({
          text: errorMsg,
          error: true,
        });
      }

      return { success: false, error: errorMsg };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What's trending on Arena right now?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check the latest trending data from Arena...",
          action: "GET_ARENA_TRENDING",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "What tokens are getting attention on Arena?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll pull the latest emerging tokens from trending posts...",
          action: "GET_ARENA_TRENDING",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: "What should I post about? What's hot?" },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Great question! Let me check current trending topics on Arena...",
          action: "GET_ARENA_TRENDING",
        },
      },
    ],
  ] as ActionExample[][],
};
