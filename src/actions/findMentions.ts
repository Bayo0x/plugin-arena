import { type Action, logger } from "@elizaos/core";
import { loadArenaConfig } from "../environment";
import { ArenaClient } from "../client/arenaClient";
import {
  filterMentionNotifications,
  extractMentionsFromNotification,
  type MentionFilterOptions,
} from "../utils/mentions";

export const findArenaMentionsAction: Action = {
  name: "FIND_ARENA_MENTIONS",
  similes: [
    "ARENA_MENTIONS",
    "GET_ARENA_MENTIONS",
    "ARENA_CHECK_MENTIONS",
    "ARENA_NOTIFICATIONS",
  ],
  description:
    "Fetch Arena notifications and extract mentions of the agent. Returns raw notification data for the agent to evaluate.",
  validate: async (runtime) => {
    try {
      const config = loadArenaConfig(runtime);
      return Boolean(config.accessToken);
    } catch {
      return false;
    }
  },
  handler: async (runtime, message, _state, _options, callback) => {
    logger.info("Fetching Arena mentions from notifications");

    const config = loadArenaConfig(runtime);
    const client = new ArenaClient(config.accessToken, {
      baseUrl: config.baseUrl,
      userAgent: config.userAgent,
    });

    try {
      // Parse parameters
      const content = (message.content as Record<string, unknown>) ?? {};
      const pageSize = (content.pageSize as number) || 50;
      const maxPages = (content.maxPages as number) || 2;

      const filterOptions: MentionFilterOptions = {
        maxAgeHours: (content.maxAgeHours as number) || 48,
        excludeSpam: (content.excludeSpam as boolean) ?? true,
        minContentLength: (content.minContentLength as number) || 10,
      };

      // Get current user to determine handle
      const me = await client.me();
      const userHandle = me.handle || me.userName || me.id;

      if (!userHandle) {
        throw new Error("Could not determine user handle");
      }

      logger.info(`Fetching notifications for @${userHandle}`);

      // Fetch notifications
      const allNotifications = [];
      for (let page = 1; page <= maxPages; page++) {
        try {
          const response = await client.getNotifications({ page, pageSize });
          allNotifications.push(...response.notifications);

          // Stop if we got fewer results than page size
          if (response.notifications.length < pageSize) {
            break;
          }
        } catch (error) {
          logger.warn(`Failed to fetch notifications page ${page}`, error);
          break;
        }
      }

      logger.info(`Fetched ${allNotifications.length} total notifications`);

      // Filter for mentions with basic pre-filtering
      const mentionNotifications = filterMentionNotifications(
        allNotifications,
        userHandle,
        filterOptions,
      );

      logger.info(
        `Found ${mentionNotifications.length} mention notifications after filtering`,
      );

      // Extract details for agent evaluation
      const mentions = mentionNotifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        createdOn: notification.createdOn,
        title: notification.title,
        text: notification.text,
        link: notification.link,
        isSeen: notification.isSeen,
        userId: notification.userId,
        mentionedHandles: extractMentionsFromNotification(notification),
      }));

      // Simple summary
      const summaryText = `🔔 Arena Notifications Summary

Found ${allNotifications.length} notifications (${mentionNotifications.length} mentions you)
Filtered: ${filterOptions.maxAgeHours}h age limit, spam excluded

${mentions.length > 0 ? `Recent Mentions:\n${mentions
  .slice(0, 5)
  .map((m, i) => {
    const preview =
      (m.text || m.title || "").substring(0, 100) +
      ((m.text || m.title || "").length > 100 ? "..." : "");
    return `${i + 1}. ${m.isSeen ? "📬" : "📭"} ${preview}${m.link ? `\n   Link: ${m.link}` : ""}`;
  })
  .join("\n\n")}` : "No recent mentions found."}`;

      if (callback) {
        await callback({
          text: summaryText,
          data: {
            mentions,
            userHandle,
            totalNotifications: allNotifications.length,
            mentionCount: mentionNotifications.length,
          },
        });
      }

      return {
        success: true,
        data: {
          mentions,
          userHandle,
          totalNotifications: allNotifications.length,
        },
      };
    } catch (error) {
      logger.error("Failed to fetch Arena mentions", error);
      if (callback) {
        await callback({
          text: `Failed to fetch Arena mentions: ${error instanceof Error ? error.message : "Unknown error"}`,
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
          text: "Check my Arena notifications",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "I'll fetch your Arena notifications and extract any mentions.",
          action: "FIND_ARENA_MENTIONS",
        },
      },
    ],
    [
      {
        name: "{{user}}",
        content: {
          text: "Did anyone mention me on Arena?",
        },
      },
      {
        name: "{{agent}}",
        content: {
          text: "Let me check your Arena mentions.",
          action: "FIND_ARENA_MENTIONS",
        },
      },
    ],
  ],
};
