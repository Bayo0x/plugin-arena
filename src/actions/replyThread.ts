import {
  type Action,
  type HandlerCallback,
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

async function maybeGenerateReplyText(
  runtimeText: string,
  runtime: Parameters<Action["handler"]>[0],
): Promise<string> {
  const prompt = `You are ${runtime.character.name}. Write a reply to an Arena thread in your own voice.

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

export const replyArenaThreadAction: Action = {
  name: "REPLY_ARENA_THREAD",
  similes: [
    "ARENA_REPLY",
    "REPLY_ARENA_POST",
    "ARENA_THREAD_REPLY",
    "ARENA_ANSWER",
    "ANSWER_ARENA_THREAD",
  ],
  description: "Reply to an Arena thread.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback?: HandlerCallback) => {
    logger.info("Executing REPLY_ARENA_THREAD action");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    const content = (message.content as Record<string, unknown>) ?? {};
    const threadId = content.threadId as string | undefined;
    const rawContent = extractText(content.content as ContentLike);

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

    if (!rawContent || rawContent.trim().length === 0) {
      const error = "content is required for replying";
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
      const replyText = await maybeGenerateReplyText(rawContent, runtime);
      const thread = await client.replyToThread(threadId.trim(), replyText, {
        privacyType: config.privacyType,
        files: content.files as string[] | undefined,
      });

      if (callback) {
        await callback({
          text: `Replied to Arena thread ${threadId}`,
          data: { thread },
        });
      }

      return {
        success: true,
        data: { thread },
      };
    } catch (error) {
      logger.error(`Failed to reply to Arena thread ${threadId}`, error);
      if (callback) {
        await callback({
          text: `Failed to reply to Arena thread ${threadId}`,
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

