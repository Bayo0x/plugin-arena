import type { Plugin } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { ArenaService } from "./services/arena.service";
import { loadArenaConfig } from "./environment";
import { createArenaBlockAction } from "./actions/createBlock";
import { fetchArenaChannelAction } from "./actions/fetchChannel";
import { likeArenaThreadAction } from "./actions/likeThread";
import { repostArenaThreadAction } from "./actions/repostThread";
import { quoteArenaThreadAction } from "./actions/quoteThread";
import { replyArenaThreadAction } from "./actions/replyThread";
import { summarizeArenaUserAction } from "./actions/summarizeUser";
import { findArenaMentionsAction } from "./actions/findMentions";
import { analyzeTrendingAction } from "./actions/analyzeTrending";
import { analyzeUserPerformanceAction } from "./actions/analyzeUserPerformance";
import { compareFeedAction } from "./actions/compareFeed";

export const ArenaPlugin: Plugin = {
  name: "arena",
  description:
    "Arena client for posting threads, reading feeds, engaging with content, scheduling automated updates, and analyzing performance with advanced analytics.",
  actions: [
    createArenaBlockAction,
    fetchArenaChannelAction,
    likeArenaThreadAction,
    repostArenaThreadAction,
    quoteArenaThreadAction,
    replyArenaThreadAction,
    summarizeArenaUserAction,
    findArenaMentionsAction,
    analyzeTrendingAction,
    analyzeUserPerformanceAction,
    compareFeedAction,
  ],
  services: [ArenaService],
  init: async (_config, runtime) => {
    logger.info("Initializing Arena plugin");
    try {
      const arenaConfig = loadArenaConfig(runtime);
      logger.info(
        `Arena plugin configured for feed "${arenaConfig.defaultFeed}"`,
      );
    } catch (error) {
      logger.warn(
        "Arena plugin could not validate configuration. Actions may be limited.",
        error,
      );
    }
  },
};

export default ArenaPlugin;

