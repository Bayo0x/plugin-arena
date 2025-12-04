# 🔥 Arena Trending Monitor System

Automated service that continuously scans Arena for trending posts, topics, and tokens. Stores data in ElizaOS memory for intelligent trading decisions and quality content generation.

---

## 🎯 Purpose

The Trending Monitor solves a critical problem: **How does the agent know what's hot RIGHT NOW?**

Without this:
- ❌ Agent posts about outdated topics
- ❌ Misses emerging token opportunities
- ❌ Can't make data-driven trading decisions
- ❌ Content feels generic and detached

With this:
- ✅ Agent knows trending topics in real-time
- ✅ Detects emerging tokens early
- ✅ Makes informed trading decisions
- ✅ Creates timely, relevant content

---

## 🏗️ How It Works

### 1. **Periodic Scanning**
Every 15 minutes (configurable):
- Scans `trending` and `suggested` feeds
- Fetches 100 posts per feed
- Analyzes with velocity scoring algorithm

### 2. **Data Extraction**
For each scan, extracts:
- **Trending Posts**: Top 20 by engagement velocity
- **Hot Topics**: AVAX, DeFi, NFT, Arena, etc.
- **Mentions**: Most-mentioned users
- **Emerging Tokens**: $TOKEN symbols gaining traction

### 3. **Memory Storage**
Saves snapshots to ElizaOS memory:
```typescript
{
  timestamp: "2025-11-23T10:30:00Z",
  feed: "trending",
  trendingThreads: [...], // Top 20 posts
  topTopics: ["AVAX", "DeFi", "Arena"],
  topMentions: ["@trader", "@analyst"],
  emergingTokens: ["$AVAX", "$JOE", "$BENQI"]
}
```

### 4. **Automatic Cleanup**
- Keeps last 20 snapshots (configurable)
- Automatically deletes older data
- Prevents memory bloat

---

## ⚙️ Configuration

### Environment Variables

```bash
# Enable the service
ARENA_TRENDING_MONITOR_ENABLED=true

# Scan every 15 minutes
ARENA_TRENDING_SCAN_INTERVAL=15

# Monitor these feeds
ARENA_TRENDING_FEEDS=trending,suggested

# Store in memory (required for agent access)
ARENA_TRENDING_STORE_MEMORY=true

# Keep 20 most recent snapshots
ARENA_TRENDING_MAX_SNAPSHOTS=20
```

### Recommended Settings

**For Active Trading Bot:**
```bash
ARENA_TRENDING_MONITOR_ENABLED=true
ARENA_TRENDING_SCAN_INTERVAL=10  # Scan every 10 min
ARENA_TRENDING_FEEDS=trending,suggested,public
ARENA_TRENDING_MAX_SNAPSHOTS=30  # Keep more history
```

**For Content Bot:**
```bash
ARENA_TRENDING_MONITOR_ENABLED=true
ARENA_TRENDING_SCAN_INTERVAL=30  # Scan every 30 min
ARENA_TRENDING_FEEDS=trending
ARENA_TRENDING_MAX_SNAPSHOTS=10  # Less history needed
```

**For Testing/Development:**
```bash
ARENA_TRENDING_MONITOR_ENABLED=false  # Disable to save API calls
```

---

## 🤖 Agent Usage

### 1. **Query Trending Data**

Agent can use the `GET_ARENA_TRENDING` action:

```typescript
User: "What's trending on Arena right now?"

Agent: [executes GET_ARENA_TRENDING]
// Returns:
// 📊 ARENA TRENDING DATA (trending feed)
// 🔥 Hot Topics: AVAX, DeFi, trading, Arena, alpha
// 💰 Emerging Tokens: $AVAX, $JOE, $BENQI
// 🏆 Top 3 Trending Posts: ...
```

### 2. **Programmatic Access**

In custom actions/evaluators:

```typescript
const service = runtime.getService<ArenaTrendingMonitorService>(
  "arena_trending_monitor"
);

// Get latest trending data
const trending = await service.getLatestTrending();

// Get trending topics
const topics = await service.getTrendingTopics();
// Returns: ["AVAX", "DeFi", "trading", ...]

// Get emerging tokens
const tokens = await service.getEmergingTokens();
// Returns: ["$AVAX", "$JOE", "$BENQI", ...]

// Check if specific topic is trending
const isHot = await service.isTopicTrending("AVAX");
// Returns: true/false
```

### 3. **Real-Time Events**

Listen for trending updates:

```typescript
runtime.on("arena:trending:update", (snapshot) => {
  console.log("New trending data:", snapshot);
  // React to trending changes
});
```

---

## 💡 Use Cases

### 1. **Trading Decisions**

```typescript
// Before trading, check if token is trending
const tokens = await service.getEmergingTokens();

if (tokens.includes("$AVAX")) {
  // AVAX is trending - good time to trade
  // High social momentum = potential price action
}
```

### 2. **Content Generation**

```typescript
// When posting, use trending topics
const topics = await service.getTrendingTopics();

// Generate post about hot topic
await createPost({
  content: `🔥 ${topics[0]} is heating up on Arena! Here's what you need to know...`
});
```

### 3. **Smart Engagement**

```typescript
// Reply to trending posts for visibility
const trending = await service.getLatestTrending();
const topPost = trending.trendingThreads[0];

// Engage with high-velocity posts
if (topPost.velocityScore > 50) {
  await replyToThread(topPost.id, "Great insights! Here's my take...");
}
```

### 4. **Opportunity Detection**

```typescript
// Detect new trending topics not seen before
const previousTopics = await getPreviousSnapshot();
const currentTopics = await service.getTrendingTopics();

const newTopics = currentTopics.filter(
  t => !previousTopics.includes(t)
);

// New topic emerging!
if (newTopics.length > 0) {
  console.log("New trending topic:", newTopics[0]);
  // Early opportunity to create content
}
```

---

## 📊 Data Schema

### TrendingSnapshot

```typescript
interface TrendingSnapshot {
  timestamp: string;           // ISO timestamp
  feed: string;                // "trending", "suggested", etc.
  trendingThreads: TrendingThread[];  // Top 20 posts
  topTopics: string[];         // Top 10 topics
  topMentions: string[];       // Top 10 @mentions
  emergingTokens: string[];    // Top 10 $TOKENS
}
```

### TrendingThread

```typescript
interface TrendingThread {
  id: string;
  content: string;
  author: string;
  engagement: {
    likes: number;
    reposts: number;
    replies: number;
  };
  velocityScore: number;  // Trending strength
  ageHours: number;       // Post age
}
```

---

## 🔍 Trending Detection Algorithm

### Velocity Score Formula

```
score = (engagement_velocity × √total_engagement) / age_factor

where:
  engagement_velocity = (likes + reposts×2 + replies×1.5) / hours_since_post
  total_engagement = likes + reposts×2 + replies×1.5
  age_factor = log(hours + 1)
```

### Why This Works

- **Velocity**: Recent engagement matters more than old engagement
- **Square root**: Prevents mega posts from dominating
- **Age factor**: Newer posts get boost, older posts need momentum
- **Weighted engagement**: Reposts > replies > likes (viral indicator)

### Thresholds

- **Score > 50**: Viral trajectory, massive momentum
- **Score 20-50**: Strong trending, still early
- **Score 5-20**: Heating up, best entry point
- **Score < 5**: Cold or declining

---

## 🎯 Best Practices

### 1. **Monitor Multiple Feeds**
```bash
# Don't rely on just one feed
ARENA_TRENDING_FEEDS=trending,suggested,public
```

### 2. **Balance Scan Frequency**
```bash
# Too frequent = API quota issues
# Too slow = miss opportunities
# Sweet spot: 10-30 minutes
ARENA_TRENDING_SCAN_INTERVAL=15
```

### 3. **Keep Sufficient History**
```bash
# Trend analysis requires historical comparison
ARENA_TRENDING_MAX_SNAPSHOTS=20  # Covers ~5 hours at 15min interval
```

### 4. **Cross-Reference Data**
```typescript
// Don't trust single data point
const snapshot1 = await getSnapshot(feedKey1);
const snapshot2 = await getSnapshot(feedKey2);

// If topic appears in multiple feeds = strong signal
const crossTrending = snapshot1.topTopics.filter(
  t => snapshot2.topTopics.includes(t)
);
```

---

## 🚀 Next Steps

After enabling trending monitor:

1. **Test the service**
   ```bash
   # Check logs for scanning activity
   tail -f logs/eliza.log | grep "Trending Monitor"
   ```

2. **Query from agent**
   ```
   User: "What's trending on Arena?"
   # Agent should use GET_ARENA_TRENDING action
   ```

3. **Build custom logic**
   - Create evaluators that check trending data
   - Use in trading decisions
   - Incorporate into content strategy

4. **Monitor performance**
   - Track which trending topics drive engagement
   - Measure success rate of trending-based decisions
   - Optimize scan frequency and feeds

---

## ⚠️ Important Notes

### API Rate Limits
- Scanning uses API quota
- Recommended: 15-30 minute intervals
- Monitor your API usage

### Memory Usage
- Each snapshot stores ~20 posts + metadata
- 20 snapshots ≈ 400 posts in memory
- Automatic cleanup prevents bloat

### Data Freshness
- Data is as fresh as last scan
- 15min interval = up to 15min old data
- For real-time needs, decrease interval

### Service Dependencies
- Requires `ARENA_ACCESS_TOKEN`
- Needs ElizaOS memory system
- Depends on Arena API availability

---

## 🎓 Example Workflow

```typescript
// 1. Service starts, scans every 15 minutes
[Trending Monitor] Starting...
[Trending Monitor] Scanning trending content...
  📊 Scanning trending feed...
    Found 23 trending posts
    Topics: AVAX, DeFi, Arena, trading, alpha
    Tokens: $AVAX, $JOE, $BENQI

// 2. Agent gets asked about trending
User: "What should I trade today?"

// 3. Agent queries trending data
const tokens = await service.getEmergingTokens();
// ["$AVAX", "$JOE", "$BENQI"]

// 4. Agent makes informed response
Agent: "Based on current Arena trending data, $AVAX and $JOE
are getting significant attention. $AVAX mentioned in 15 trending
posts in the last hour. Consider analyzing these tokens for
trading opportunities."

// 5. Agent creates relevant content
const topics = await service.getTrendingTopics();
Agent posts: "🔥 AVAX is dominating Arena conversations right
now. Here's why traders are paying attention... [analysis]"
```

---

**The Trending Monitor is now the agent's window into the Arena pulse.** It transforms reactive posting into proactive, data-driven engagement. 📊⚔️
