/**
 * Debug script to inspect mention notification structure
 * Shows full JSON of mentions to understand what data is available
 */

import { ArenaClient } from "../src/client/arenaClient";
import { filterMentionNotifications } from "../src/utils/mentions";

async function debugMentionStructure() {
  const token = process.env.ARENA_ACCESS_TOKEN;

  if (!token) {
    console.error("❌ ARENA_ACCESS_TOKEN not set");
    process.exit(1);
  }

  console.log("🔍 Fetching notifications to inspect mention structure...\n");

  const client = new ArenaClient(token);

  try {
    // Get current user
    const me = await client.me();
    const userHandle = me.handle || me.userName || me.id;
    console.log(`📱 Current user: @${userHandle} (ID: ${me.id})\n`);

    // Fetch notifications
    const response = await client.getNotifications({ page: 1, pageSize: 50 });

    console.log(`📋 Fetched ${response.notifications.length} notifications\n`);

    // Show ALL notifications first to understand types
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 ALL NOTIFICATIONS (First 10):\n");
    response.notifications.slice(0, 10).forEach((notif, i) => {
      console.log(`\n--- Notification ${i + 1} ---`);
      console.log(`Type: ${notif.type}`);
      console.log(`Title: ${notif.title || 'N/A'}`);
      console.log(`Text: ${notif.text || 'N/A'}`);
      console.log(`Link: ${notif.link || 'N/A'}`);
      console.log(`User ID: ${notif.userId || 'N/A'}`);
      console.log(`Created: ${notif.createdOn || 'N/A'}`);
    });

    console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("💬 FILTERING FOR MENTIONS ONLY:\n");

    // Filter for mentions
    const mentions = filterMentionNotifications(
      response.notifications,
      userHandle,
      { maxAgeHours: 48, excludeSpam: false, minContentLength: 0 }
    );

    console.log(`Found ${mentions.length} mention notifications (those with @${userHandle})\n`);

    if (mentions.length === 0) {
      console.log("⚠️  No @mentions found. But check the notifications above - there might be REPLY type notifications.\n");
      return;
    }

    // Show detailed structure of each mention
    mentions.forEach((mention, i) => {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`\n📬 MENTION ${i + 1}/${mentions.length}\n`);
      console.log(`Full JSON structure:`);
      console.log(JSON.stringify(mention, null, 2));
      console.log(`\n`);

      // Highlight key fields
      console.log(`Key Fields:`);
      console.log(`  - Notification ID: ${mention.id}`);
      console.log(`  - Type: ${mention.type}`);
      console.log(`  - Text: ${mention.text || 'N/A'}`);
      console.log(`  - Link: ${mention.link || 'N/A'}`);
      console.log(`  - User: @${mention.user?.handle || 'unknown'} (${mention.user?.id || 'N/A'})`);
      console.log(`  - Created: ${mention.createdAt || 'N/A'}`);

      // Try to extract thread ID from different possible locations
      console.log(`\nThread ID extraction attempts:`);

      // From link
      const linkMatch = mention.link?.match(/\/thread\/([^\/]+)/);
      console.log(`  - From link regex: ${linkMatch?.[1] || 'NOT FOUND'}`);

      // Maybe it's in a different field
      console.log(`  - notification.id: ${mention.id}`);
      console.log(`  - notification.threadId: ${(mention as any).threadId || 'NOT FOUND'}`);
      console.log(`  - notification.thread?.id: ${(mention as any).thread?.id || 'NOT FOUND'}`);
      console.log(`  - notification.postId: ${(mention as any).postId || 'NOT FOUND'}`);
      console.log(`  - notification.post?.id: ${(mention as any).post?.id || 'NOT FOUND'}`);
      console.log(`  - notification.relatedId: ${(mention as any).relatedId || 'NOT FOUND'}`);

      console.log(`\n`);
    });

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`✅ Debug complete! Check the output above to see:`);
    console.log(`   1. Full JSON structure of mentions`);
    console.log(`   2. Which field contains the thread ID`);
    console.log(`   3. What data is available for processing`);

  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  }
}

debugMentionStructure().catch(console.error);
