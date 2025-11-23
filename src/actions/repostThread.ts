import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";

export const repostArenaThreadAction: Action = {
  name: "REPOST_ARENA_THREAD",
  similes: [
    "ARENA_REPOST",
    "REPOST_ARENA_POST",
    "ARENA_THREAD_REPOST",
    "ARENA_RETWEET",
  ],
  description: "Repost an Arena thread by threadId.",
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
    const undo = content.undo as boolean | undefined;

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
      const thread = undo
        ? await client.undoRepost(threadId.trim())
        : await client.repostThread(threadId.trim());

      if (callback) {
        await callback({
          text: undo
            ? `Undid repost of Arena thread ${threadId}`
            : `Reposted Arena thread ${threadId}`,
          data: { thread },
        });
      }

      return {
        success: true,
        data: { thread },
      };
    } catch (error) {
      logger.error(
        `Failed to ${undo ? "undo repost" : "repost"} Arena thread ${threadId}`,
        error,
      );
      if (callback) {
        await callback({
          text: `Failed to ${undo ? "undo repost" : "repost"} Arena thread ${threadId}`,
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

