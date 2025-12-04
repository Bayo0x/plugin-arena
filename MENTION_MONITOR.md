# 💬 Arena Mention Monitor & Duplicate Prevention System

Automated service that monitors mentions/notifications and prevents duplicate responses.

---

## 🎯 Problem Solved

**Without This System:**
- ❌ Agent replies to same mention multiple times
- ❌ Spams users with duplicate responses
- ❌ Wastes API quota on redundant replies
- ❌ Looks unprofessional and bot-like

**With This System:**
- ✅ Each mention processed exactly once
- ✅ Reply/quote actions check before responding
- ✅ Tracked by thread ID for fast lookup
- ✅ Persistent across restarts (stored in memory)

---

## 🏗️ How It Works

### 1. **Mention Monitoring Service**

Runs every 1 minute by default (configurable):
- Fetches notifications from `/notifications` endpoint
- Filters for mentions (MENTION, REPLY, @handle)
- Checks if already processed
- Stores new mentions in memory
- Emits event for agent to handle

### 2. **Duplicate Prevention Guards**

Before replying or quoting:
1. Check if thread ID is in `repliedThreads` set
2. If yes → Skip with warning log
3. If no → Proceed with response

After successful reply/quote:
1. Add thread ID to `repliedThreads` set
2. Update memory with reply timestamp
3. Persists across restarts

### 3. **Memory Storage**

**In-Memory Cache (Fast):**
- `processedMentions` Set - notification IDs we've seen
- `repliedThreads` Set - thread IDs we've replied to
- O(1) lookup time

**ElizaOS Memory (Persistent):**
```typescript
{
  type: "arena_mention",
  processed: {
    notificationId: "xyz",
    threadId: "abc",
    content: "...",
    timestamp: "2025-11-23T10:30:00Z",
    replied: true,
    repliedAt: "2025-11-23T10:35:00Z"
  }
}
```

---

## ⚙️ Configuration

### Environment Variables

```bash
# Enable mention monitoring
ARENA_MENTION_MONITOR_ENABLED=true

# Scan every 1 minute (fast response - people love quick replies!)
ARENA_MENTION_SCAN_INTERVAL=1

# Look back 48 hours max
ARENA_MENTION_MAX_AGE_HOURS=48

# Min content length (spam filter)
ARENA_MENTION_MIN_LENGTH=10

# Exclude spam
ARENA_MENTION_EXCLUDE_SPAM=true

# Store in memory (required for duplicate prevention)
ARENA_MENTION_STORE_HISTORY=true

# Keep 50 mentions in history
ARENA_MENTION_MAX_HISTORY=50
```

---

## 🔒 Duplicate Prevention Flow

### Reply Action with Guard

```typescript
// 1. GUARD - Check before replying
if (threadId) {
  const mentionMonitor = runtime.getService("arena_mention_monitor");
  if (mentionMonitor && mentionMonitor.hasRepliedToThread(threadId)) {
    logger.warn(`Already replied to ${threadId}, skipping`);
    return false; // Prevent duplicate
  }
}

// 2. EXECUTE - Reply to thread
const thread = await client.replyToThread(threadId, content);

// 3. MARK - Track as replied
const mentionMonitor = runtime.getService("arena_mention_monitor");
if (mentionMonitor) {
  await mentionMonitor.markAsReplied(threadId);
}
```

### Quote Action with Guard

Same pattern as reply:
1. Check `hasRepliedToThread(threadId)`
2. Execute quote if not replied
3. Mark with `markAsReplied(threadId)`

---

## 📊 Service API

### Check Methods

```typescript
const service = runtime.getService("arena_mention_monitor");

// Check if already replied to thread
const hasReplied = service.hasRepliedToThread("thread_123");
// Returns: true/false

// Check if mention already processed
const isProcessed = service.hasProcessedMention("notification_456");
// Returns: true/false

// Get unprocessed count
const count = service.getUnprocessedCount();
// Returns: number
```

### Action Methods

```typescript
// Mark thread as replied (prevents future duplicates)
await service.markAsReplied(threadId, notificationId);

// Force immediate scan (useful for testing)
await service.forceScan();
```

### Events

```typescript
// Listen for new mentions
runtime.on("arena:mentions:new", (data) => {
  console.log(`${data.count} new mentions:`, data.mentions);
  // Agent can decide how to respond
});
```

---

## 🎯 Protected Actions

### Actions with Duplicate Guards

1. **REPLY_ARENA_THREAD**
   - Checks `hasRepliedToThread(threadId)`
   - Marks as replied after success
   - Logs warning if duplicate attempt

2. **QUOTE_ARENA_THREAD**
   - Checks `hasRepliedToThread(threadId)`
   - Marks as replied after success
   - Logs warning if duplicate attempt

### Why Not Like/Repost?

Likes and reposts are idempotent:
- Liking twice = same as liking once
- Reposting twice = API prevents duplicate
- No spam risk

Reply/Quote are NOT idempotent:
- Each reply creates new post
- Each quote creates new post
- Can spam user with duplicates

---

## 🔍 Testing

### 1. Test Endpoint

```bash
# Verify /notifications endpoint works
bun run scripts/test-mentions-endpoint.ts
```

Shows:
- Notification types returned
- Mention detection logic
- Response times
- Sample notifications

### 2. Test Service

```typescript
// Start service
const service = runtime.getService("arena_mention_monitor");

// Force scan
await service.forceScan();

// Check processed
console.log("Processed:", service.getUnprocessedCount());

// Simulate mention
const hasReplied = service.hasRepliedToThread("test_123");
console.log("Already replied:", hasReplied);

// Mark as replied
await service.markAsReplied("test_123");

// Check again
console.log("Now replied:", service.hasRepliedToThread("test_123"));
// Should be true
```

### 3. Test Duplicate Prevention

```bash
# 1. Get mentioned on Arena
# 2. Agent processes mention and replies
# 3. Service scans again (finds same mention)
# 4. Service sees it's already processed → skips
# 5. Agent tries to reply again
# 6. Guard detects threadId in repliedThreads → blocks
# 7. Log shows: "Already replied to thread X, skipping"
```

---

## 📝 Logging

### Service Logs

```
[Arena Mention Monitor] Initialized
  - Scan interval: 10 minutes
  - Max age: 48 hours
  - Loaded 15 processed mentions
  - Loaded 12 replied threads

[Arena Mention Monitor] 🔍 Scanning for new mentions...
  📋 Fetched 73 total notifications
  💬 Found 8 mention notifications
  ✨ 3 new mentions (not yet processed)
  📢 Emitted event with 3 new mentions
[Arena Mention Monitor] ✅ Scan complete
```

### Guard Logs

```
[REPLY_ARENA_THREAD] Already replied to thread abc123, skipping duplicate reply

[QUOTE_ARENA_THREAD] Already responded to thread xyz789, skipping duplicate quote

[Arena Mention Monitor] ✅ Marked thread def456 as replied
```

---

## 🎯 Best Practices

### 1. **Appropriate Scan Interval**

```bash
# Fast response = Best engagement (people love quick replies!)
ARENA_MENTION_SCAN_INTERVAL=1  # Recommended for active engagement

# Moderate = Good for less critical bots
ARENA_MENTION_SCAN_INTERVAL=5

# Relaxed = Low traffic accounts
ARENA_MENTION_SCAN_INTERVAL=15
```

**Why 1 minute is optimal:**
- Users expect quick responses on social platforms
- Fast replies increase engagement and positive sentiment
- Shows your agent is active and attentive
- Minimal API cost (only fetches notifications)
- Duplicate prevention ensures no spam even with frequent checks

### 2. **History Size**

```bash
# More history = better duplicate prevention
# But = more memory usage

# Active account with many mentions
ARENA_MENTION_MAX_HISTORY=100

# Normal account
ARENA_MENTION_MAX_HISTORY=50  # Recommended

# Low traffic
ARENA_MENTION_MAX_HISTORY=20
```

### 3. **Age Threshold**

```bash
# How far back to look for mentions
# Too short = miss some mentions
# Too long = process old/irrelevant mentions

ARENA_MENTION_MAX_AGE_HOURS=48  # Recommended (2 days)
```

---

## 🚨 Edge Cases Handled

### 1. **Service Restart**
- ✅ Loads processed mentions from memory
- ✅ Loads replied threads from memory
- ✅ No duplicates after restart

### 2. **Memory Limit**
- ✅ Keeps max N mentions (configurable)
- ✅ Auto-cleanup of old mentions
- ✅ Prevents memory bloat

### 3. **Concurrent Replies**
- ✅ In-memory set prevents race conditions
- ✅ Fast O(1) lookup before replying
- ✅ Marked immediately after reply

### 4. **Failed Replies**
- ✅ Only marked if reply succeeds
- ✅ Can retry failed replies
- ✅ No false positives

### 5. **Multiple Mentions of Same Thread**
- ✅ Tracked by thread ID, not notification ID
- ✅ One reply per thread regardless of mention count
- ✅ Prevents spam from multiple notifications

---

## 📊 Data Flow

```
Every 10 minutes:
  ↓
Fetch /notifications
  ↓
Filter for mentions
  ↓
Check processedMentions set
  ↓
Store new mentions
  ↓
Emit event
  ↓
Agent evaluates
  ↓
Decides to reply
  ↓
GUARD: Check repliedThreads
  ↓
If not replied → Execute reply
  ↓
Mark as replied
  ↓
Update memory
```

---

## 🔧 Troubleshooting

### "Service not found"
```typescript
// Service disabled or not initialized
// Check: ARENA_MENTION_MONITOR_ENABLED=true
// Check: ARENA_ACCESS_TOKEN is set
```

### "Duplicate replies still happening"
```typescript
// Check service is running
const service = runtime.getService("arena_mention_monitor");
console.log("Service:", service ? "Running" : "Not found");

// Check reply tracking
console.log("Replied threads:", service.repliedThreads.size);

// Verify guards are in actions
// Should see "GUARD: Check if we've already replied" in code
```

### "Not detecting mentions"
```bash
# Test endpoint
bun run scripts/test-mentions-endpoint.ts

# Check notification types
# Verify filtering logic in mentions.ts
# Check maxAgeHours isn't too restrictive
```

---

## 🎯 Summary

The Mention Monitor provides:

✅ **Automatic mention detection** - Scans every 10 minutes
✅ **Duplicate prevention** - Guards on reply/quote actions
✅ **Persistent tracking** - Survives restarts via memory
✅ **Fast lookup** - O(1) in-memory sets
✅ **Clean logging** - Clear warnings for duplicates
✅ **Memory management** - Auto-cleanup of old data
✅ **Event-driven** - Emits events for agent handling

**Result:** Professional, spam-free mention responses with zero duplicates! 💬⚔️
