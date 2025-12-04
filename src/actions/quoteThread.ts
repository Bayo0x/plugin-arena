import {
  type Action,
  type ActionResult,
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

async function maybeGenerateQuoteText(
  runtimeText: string,
  runtime: Parameters<Action["handler"]>[0],
): Promise<string> {
  const prompt = `You are ${runtime.character.name}. Write a quote/commentary for an Arena thread in your own voice.

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

export const quoteArenaThreadAction: Action = {
  name: "QUOTE_ARENA_THREAD",
  similes: [
    "ARENA_QUOTE",
    "QUOTE_ARENA_POST",
    "ARENA_THREAD_QUOTE",
  ],
  description: "Quote an Arena thread with commentary.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback?: HandlerCallback): Promise<ActionResult> => {
    logger.info("Executing QUOTE_ARENA_THREAD action");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    const content = (message.content as Record<string, unknown>) ?? {};
    const threadId = content.threadId as string | undefined;

    // GUARD: Check if we've already responded to this thread
    if (threadId) {
      const mentionMonitor = runtime.getService<any>("arena_mention_monitor");
      if (mentionMonitor && mentionMonitor.hasRepliedToThread(threadId)) {
        const msg = `Already responded to thread ${threadId}, skipping duplicate quote`;
        logger.warn(`[QUOTE_ARENA_THREAD] ${msg}`);

        if (callback) {
          await callback({
            text: msg,
            action: "QUOTE_ARENA_THREAD",
          });
        }

        return { success: false, error: msg };
      }
    }

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
      const error = "content is required for quoting";
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
      const quoteText = await maybeGenerateQuoteText(rawContent, runtime);
      const thread = await client.quoteThread(threadId.trim(), quoteText, {
        privacyType: config.privacyType,
        communityId: config.communityId,
      });

      // Mark thread as replied to prevent duplicates
      const mentionMonitor = runtime.getService<any>("arena_mention_monitor");
      if (mentionMonitor) {
        await mentionMonitor.markAsReplied(threadId.trim());
      }

      if (callback) {
        await callback({
          text: `Quoted Arena thread ${threadId}`,
          data: { thread },
        });
      }

      return {
        success: true,
        data: { thread },
      };
    } catch (error) {
      logger.error(`Failed to quote Arena thread ${threadId}`, error);
      if (callback) {
        await callback({
          text: `Failed to quote Arena thread ${threadId}`,
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

