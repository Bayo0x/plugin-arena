import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";

export const likeArenaThreadAction: Action = {
  name: "LIKE_ARENA_THREAD",
  similes: [
    "ARENA_LIKE",
    "LIKE_ARENA_POST",
    "ARENA_THREAD_LIKE",
  ],
  description: "Like an Arena thread by threadId.",
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
    const threadId = content.threadId as string | undefined;

    if (!threadId || typeof threadId !== "string" || threadId.trim().length === 0) {
      const error = "threadId is required";
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
      const thread = await client.likeThread(threadId.trim());

      if (callback) {
        await callback({
          text: `Liked Arena thread ${threadId}`,
          data: { thread },
        });
      }

      return {
        success: true,
        data: { thread },
      };
    } catch (error) {
      logger.error(`Failed to like Arena thread ${threadId}`, error);
      if (callback) {
        await callback({
          text: `Failed to like Arena thread ${threadId}`,
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

