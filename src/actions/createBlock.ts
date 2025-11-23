import {
  type Action,
  type HandlerOptions,
  logger,
  ModelType,
} from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import type { ContentLike } from "../types";

function extractText(content: ContentLike): string | undefined {
  if (!content) {
    return undefined;
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const merged = content
      .map((item) => extractText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
    return merged || undefined;
  }

  if (typeof content === "object") {
    const text = content.text ?? (content as Record<string, unknown>).summary;
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return undefined;
}

async function maybeGenerateBlockText(
  runtimeText: string,
  runtime: Parameters<Action["handler"]>[0],
): Promise<string> {
  const prompt = `You are ${runtime.character.name}. Craft a single Arena thread in your own voice.

Input:
${runtimeText}

Respond with up to 400 characters, no markdown fences, no explanations.`;

  const response = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt,
    max_tokens: 200,
    temperature: 0.85,
  });

  return response.trim();
}

export const createArenaBlockAction: Action = {
  name: "CREATE_ARENA_BLOCK",
  similes: [
    "POST_ARENA_BLOCK",
    "ARENA_POST",
    "ARENA_SHARE",
    "ARENA_ADD_BLOCK",
  ],
  description: "Create a new Arena thread using the configured feed/privacy defaults.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch (error) {
      logger.warn("Arena action validation failed", error);
      return false;
    }
  },
  handler: async (runtime, message, _state, _options?: HandlerOptions, callback?) => {
    logger.info("Executing CREATE_ARENA_BLOCK action");

    try {
      const config = loadArenaConfig(runtime);
      const client = new ArenaClient(config.accessToken, {
        baseUrl: config.baseUrl,
        userAgent: config.userAgent,
      });

      let text = extractText(message.content);

      if (!text || text.length < 12) {
        if (!text) {
          text = "Share a concise update about your current work or insights.";
        }
        text = await maybeGenerateBlockText(text, runtime);
      }

      const feedKey =
        ((message.content as Record<string, unknown>)?.feed as string | undefined) ??
        ((message.content as Record<string, unknown>)?.channelSlug as string | undefined) ??
        config.defaultFeed;

      if (config.dryRun) {
        const preview = {
          feed: feedKey,
          content: text,
        };
        logger.info(`Arena dry-run enabled. Block not posted to feed "${feedKey}": ${text.substring(0, 100)}...`);
        if (callback) {
          await callback({
            text: `Would have posted to Arena feed "${feedKey}":\n${text}`,
            data: preview,
          });
        }
        return;
      }

      const thread = await client.createThread({
        content: text,
        privacyType: config.privacyType,
        communityId: config.communityId,
      });

      logger.info(
        `Created Arena thread ${thread.id} via feed ${feedKey}`,
      );

      if (callback) {
        await callback({
          text: `Shared a new Arena thread in feed "${feedKey}".`,
          data: { threadId: thread.id, feed: feedKey },
        });
      }
    } catch (error) {
      logger.error("Failed to create Arena block", error);
      if (callback) {
        await callback({
          text: `I couldn't post to Arena. ${error instanceof Error ? error.message : "Unknown error"}`,
          data: { error: error instanceof Error ? error.message : error },
        });
      }
    }
  },
  examples: [
    [
      {
        name: "{{user}}",
        content: {
          text: "Please share a new idea on our Arena channel.",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll publish a concise update to the Arena channel.",
          action: "CREATE_ARENA_BLOCK",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Post that summary to Arena.",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Sharing it on Arena now.",
          action: "CREATE_ARENA_BLOCK",
        },
      },
    ],
  ],
};

