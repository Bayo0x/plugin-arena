import type { ArenaThread, ArenaNotification } from "../types";

/**
 * Extract user handles from Arena content (HTML or plain text)
 * Arena uses: <a class="thread-tag" href="/Handle" data-user-handle="Handle">@Handle</a>
 */
export function extractMentionsFromContent(content: string): string[] {
  if (!content || typeof content !== "string") {
    return [];
  }

  const mentions: string[] = [];

  // Extract from HTML data-user-handle attribute
  const htmlRegex =
    /<a\s+class=["']thread-tag["'][^>]*data-user-handle=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = htmlRegex.exec(content)) !== null) {
    const handle = match[1];
    if (handle && !mentions.includes(handle)) {
      mentions.push(handle);
    }
  }

  // Extract from plain text @mentions (fallback)
  const plainTextMentions = content.match(/@(\w+)/g);
  if (plainTextMentions) {
    for (const mention of plainTextMentions) {
      const handle = mention.substring(1); // Remove @
      if (handle && !mentions.includes(handle)) {
        mentions.push(handle);
      }
    }
  }

  return mentions;
}

/**
 * Extract mentions from notification
 */
export function extractMentionsFromNotification(
  notification: ArenaNotification,
): string[] {
  const mentions: string[] = [];

  // Extract from title
  if (notification.title) {
    mentions.push(...extractMentionsFromContent(notification.title));
  }

  // Extract from text
  if (notification.text) {
    mentions.push(...extractMentionsFromContent(notification.text));
  }

  // Extract from link
  if (notification.link) {
    mentions.push(...extractMentionsFromContent(notification.link));
  }

  // Remove duplicates
  return [...new Set(mentions)];
}

/**
 * Check if content mentions a specific user handle
 */
export function mentionsUser(content: string, userHandle: string): boolean {
  if (!content || !userHandle) {
    return false;
  }

  const mentions = extractMentionsFromContent(content);
  const normalizedHandle = userHandle.trim().toLowerCase();
  return mentions.some((m) => m.toLowerCase() === normalizedHandle);
}

/**
 * Check if a thread mentions a specific user handle
 */
export function threadMentionsUser(
  thread: ArenaThread,
  userHandle: string,
): boolean {
  return thread.content ? mentionsUser(thread.content, userHandle) : false;
}

/**
 * Check if notification mentions a specific user
 */
export function notificationMentionsUser(
  notification: ArenaNotification,
  userHandle: string,
): boolean {
  const normalizedHandle = userHandle.trim().toLowerCase();

  // Check title
  if (notification.title && mentionsUser(notification.title, normalizedHandle)) {
    return true;
  }

  // Check text
  if (notification.text && mentionsUser(notification.text, normalizedHandle)) {
    return true;
  }

  // Check link
  if (notification.link && mentionsUser(notification.link, normalizedHandle)) {
    return true;
  }

  return false;
}

/**
 * Basic spam detection (simple heuristics)
 */
export function isLikelySpam(content: string): boolean {
  if (!content) return false;

  const lowerContent = content.toLowerCase();

  // Very short promotional content
  if (lowerContent.length < 20 && /https?:\/\//.test(content)) {
    return true;
  }

  // Common spam patterns
  const spamPatterns = [
    /\b(click here|buy now|limited time|act now)\b/i,
    /\b(earn money|make money|get rich|passive income)\b/i,
    /\b(dm me|check dm|follow back|follow for follow|f4f)\b/i,
    /(🚀|💰|💸|🎁){4,}/, // 4+ repeated promotional emojis
  ];

  return spamPatterns.some((pattern) => pattern.test(content));
}

/**
 * Basic options for mention filtering
 */
export interface MentionFilterOptions {
  maxAgeHours?: number;      // Filter by age
  excludeSpam?: boolean;     // Basic spam filter
  minContentLength?: number; // Minimum content length
}

/**
 * Filter threads that mention a user (with basic pre-filtering)
 */
export function filterMentionThreads(
  threads: ArenaThread[],
  userHandle: string,
  options: MentionFilterOptions = {},
): ArenaThread[] {
  const {
    maxAgeHours = 72,
    excludeSpam = true,
    minContentLength = 10,
  } = options;

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  return threads.filter((thread) => {
    // Must mention the user
    if (!threadMentionsUser(thread, userHandle)) {
      return false;
    }

    // Check age
    if (thread.createdDate && maxAgeHours > 0) {
      const threadAge = now - new Date(thread.createdDate).getTime();
      if (threadAge > maxAgeMs) {
        return false;
      }
    }

    // Check content length
    if (
      thread.content &&
      minContentLength > 0 &&
      thread.content.length < minContentLength
    ) {
      return false;
    }

    // Basic spam filter
    if (excludeSpam && thread.content && isLikelySpam(thread.content)) {
      return false;
    }

    return true;
  });
}

/**
 * Filter notifications that mention a user (with basic pre-filtering)
 */
export function filterMentionNotifications(
  notifications: ArenaNotification[],
  userHandle: string,
  options: MentionFilterOptions = {},
): ArenaNotification[] {
  const {
    maxAgeHours = 72,
    excludeSpam = true,
    minContentLength = 10,
  } = options;

  const now = Date.now();
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;

  return notifications.filter((notification) => {
    // Must mention the user
    if (!notificationMentionsUser(notification, userHandle)) {
      return false;
    }

    // Check age
    if (notification.createdOn && maxAgeHours > 0) {
      const notificationAge =
        now - new Date(notification.createdOn).getTime();
      if (notificationAge > maxAgeMs) {
        return false;
      }
    }

    // Check content length (text field)
    const contentText = notification.text || "";
    if (minContentLength > 0 && contentText.length < minContentLength) {
      return false;
    }

    // Basic spam filter
    if (excludeSpam && contentText && isLikelySpam(contentText)) {
      return false;
    }

    return true;
  });
}
