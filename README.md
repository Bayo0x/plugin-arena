# 🏟️ Arena Plugin for ElizaOS

> **Complete Arena.social integration for ElizaOS agents** - Post, engage, analyze, and automate your Arena presence with AI-powered intelligence.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![ElizaOS](https://img.shields.io/badge/ElizaOS-Plugin-green)](https://github.com/elizaos)
[![Arena API](https://img.shields.io/badge/Arena-API%20v1-orange)](https://api.arena.social)

---

## ✨ Features

### 🎯 Core Functionality
- ✅ **Thread Management** - Create, read, update, delete threads
- ✅ **Engagement** - Like, repost, quote, reply to threads
- ✅ **Social Graph** - Follow/unfollow users, get followers/following
- ✅ **Notifications** - Fetch and parse Arena notifications
- ✅ **Mentions** - Detect mentions with intelligent pre-filtering
- ✅ **Bookmarks** - Save and retrieve bookmarked threads
- ✅ **Multi-Feed Support** - Access trending, suggested, my, public feeds

### 📊 Advanced Analytics
- 📈 **Trending Detection** - Identify viral posts with velocity scoring
- 🎯 **User Performance** - Analyze engagement, influence, growth trends
- 🔍 **Feed Comparison** - Compare feeds to optimize posting strategy
- ⏰ **Optimal Timing** - Determine best times to post (future)
- 🎨 **Content Tracking** - Track content performance over time

### 🤖 Intelligence Features
- 🧠 **Agent-Driven Decisions** - ElizaOS agent evaluates all actions
- 🔄 **Auto-Discovery** - Automated feed monitoring and discovery
- 🎭 **Personality-Based** - Agent responds based on character config
- 🛡️ **Spam Filtering** - Basic pre-filtering of low-value content

---

## 📦 Installation

```bash
# Install the plugin
bun add @elizaos/plugin-arena

# Or from source
cd plugins
git clone https://github.com/your-org/plugin-arena.git
cd plugin-arena
bun install
bun run build
```

### Requirements
- **Node.js**: >= 18.0.0
- **Bun**: >= 1.0.0 (recommended)
- **ElizaOS**: >= 0.1.0
- **Arena Account**: Valid access token

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
# ==========================================
# ARENA API CONFIGURATION (REQUIRED)
# ==========================================

# Your Arena personal access token (REQUIRED)
ARENA_ACCESS_TOKEN=your_arena_access_token_here

# ==========================================
# ARENA API SETTINGS (Optional)
# ==========================================

# Arena API base URL
ARENA_BASE_URL=https://api.arena.social

# Custom user agent
ARENA_USER_AGENT=YourBotName/1.0

# Default feed to monitor
ARENA_DEFAULT_FEED=trending

# ==========================================
# PRIVACY & POSTING (Optional)
# ==========================================

# Privacy type for posts
# 0=public, 1=private, 2=followers only
ARENA_PRIVACY_TYPE=0

# Default community ID for posts
ARENA_COMMUNITY_ID=

# Dry run mode (logs only, doesn't post)
ARENA_DRY_RUN=false

# ==========================================
# AUTOMATED POSTING (Optional)
# ==========================================

# Enable scheduled posting service
ARENA_ENABLE_POST=false

# Post immediately on startup
ARENA_POST_IMMEDIATELY=false

# Posting interval (minutes)
ARENA_POST_INTERVAL=120
ARENA_POST_INTERVAL_MIN=90
ARENA_POST_INTERVAL_MAX=150

# Max blocks per posting cycle
ARENA_MAX_BLOCKS_PER_RUN=1

# ==========================================
# DISCOVERY & MONITORING (Optional)
# ==========================================

# Feeds to monitor for mentions/discovery
ARENA_TARGET_FEEDS=trending,suggested

# Discovery interval (minutes)
ARENA_DISCOVERY_INTERVAL_MINUTES=15
```

### Character Configuration

Add to your character JSON:

```json
{
  "name": "ArenaBot",
  "bio": "An AI agent active on Arena, sharing insights and engaging with the community.",

  "plugins": [
    "@elizaos/plugin-bootstrap",
    "@elizaos/plugin-sql",
    "@elizaos/plugin-openai",
    "@elizaos/plugin-arena"
  ],

  "settings": {
    "secrets": {
      "ARENA_ACCESS_TOKEN": "your-token-here"
    }
  }
}
```

---

## 🎯 Actions

The plugin provides **11 actions** for your agent:

### Thread Management

#### `CREATE_ARENA_BLOCK`
Create a new Arena thread.
```typescript
User: "Post about AI developments on Arena"
Agent: *executes CREATE_ARENA_BLOCK*
```

#### `FETCH_ARENA_CHANNEL`
Fetch threads from a feed.
```typescript
User: "Show me trending posts"
Agent: *executes FETCH_ARENA_CHANNEL with feed="trending"*
```

### Engagement

#### `LIKE_ARENA_THREAD`
Like a thread.

#### `REPOST_ARENA_THREAD`
Repost (share) a thread.

#### `QUOTE_ARENA_THREAD`
Quote a thread with commentary.

#### `REPLY_ARENA_THREAD`
Reply to a thread.

### Analytics

#### `ANALYZE_ARENA_TRENDING`
Analyze trending content with velocity scores.
```typescript
User: "What's trending on Arena?"
Agent: *executes ANALYZE_ARENA_TRENDING*
```

Returns:
- Top viral posts ranked by engagement velocity
- Engagement metrics (likes, reposts, replies)
- Age and velocity scores
- Hot topics

#### `ANALYZE_ARENA_USER_PERFORMANCE`
Analyze a user's performance.
```typescript
User: "Analyze @alice's performance"
Agent: *executes ANALYZE_ARENA_USER_PERFORMANCE*
```

Returns:
- Follower count and growth
- Engagement rate
- Influence tier (nano/micro/macro/mega)
- Top performing content
- Peak posting hours
- Trend analysis

#### `COMPARE_ARENA_FEEDS`
Compare feeds to optimize strategy.
```typescript
User: "Which feed should I focus on?"
Agent: *executes COMPARE_ARENA_FEEDS*
```

Returns:
- Engagement comparison
- Most active feed
- Best for discovery
- Content distribution
- Strategic recommendations

### Discovery

#### `SUMMARIZE_ARENA_USER`
Get user profile summary.

#### `FIND_ARENA_MENTIONS`
Find mentions and notifications.
```typescript
User: "Check if anyone mentioned me"
Agent: *executes FIND_ARENA_MENTIONS*
// Returns raw data, agent evaluates responses
```

**Note**: Returns raw notification data. The ElizaOS agent decides whether to respond based on character and context.

---

## 📊 Analytics System

### Trending Detection Algorithm

```typescript
Score = (engagement_velocity × √total_engagement) / age_factor
```

**Velocity Calculation**:
- Engagement per hour = (likes + reposts×2 + replies×1.5) / age_hours
- Higher weight for reposts (viral indicator)
- Medium weight for replies (engagement quality)

### Influence Tiers

| Tier | Followers | Description |
|------|-----------|-------------|
| Nano | < 1K | Emerging voices |
| Micro | 1K - 10K | Growing influencers |
| Macro | 10K - 100K | Established influencers |
| Mega | 100K+ | Top-tier influencers |

### Metrics Tracked

- **Engagement Rate**: engagement / followers
- **Posting Frequency**: posts per day
- **Engagement Quality**: meaningful interactions %
- **Growth Trend**: rising/stable/declining
- **Peak Hours**: optimal posting times
- **Content Performance**: viral/trending/normal distribution

---

## 🏗️ Architecture

### Plugin Design

```
ElizaOS Agent (Intelligence)
    ↓
Arena Plugin (Data Collection)
    ├── Actions (11 actions)
    ├── Services (Background tasks)
    ├── Client (26 API endpoints)
    └── Utils (Analytics, Mentions)
    ↓
Arena API (api.arena.social)
```

### Design Principles

✅ **Separation of Concerns**: Plugin = data, Agent = intelligence
✅ **Stateless Actions**: Independent and composable
✅ **Agent-Driven**: No hardcoded decisions
✅ **Pre-filtering Only**: Basic spam filter, agent evaluates importance

---

## 🛠️ Development

### Project Structure

```
plugin-arena/
├── src/
│   ├── actions/              # 11 action implementations
│   ├── client/               # Arena API client
│   ├── services/             # Background service
│   ├── utils/                # Analytics & mentions
│   ├── types.ts              # TypeScript types
│   └── index.ts              # Plugin export
├── ENDPOINTS_AUDIT.md        # API endpoint reference
├── ARENA_API_REFERENCE.md    # Detailed API docs
└── README.md
```

### Build

```bash
# Install
bun install

# Build
bun run build

# Type check
bunx tsc --noEmit

# Run
elizaos start --character your-character.json
```

---

## 📚 API Reference

See `ENDPOINTS_AUDIT.md` for complete endpoint documentation (26 endpoints).

**Key Methods**:
- `me()` - Get current user
- `getFeed(feedKey, options)` - Get feed
- `createThread(request)` - Create thread
- `likeThread(threadId)` - Like thread
- `followUser(userId)` - Follow user
- `getNotifications(options)` - Get notifications

---

## 🔐 Security

### Best Practices

✅ Never commit tokens - use `.env` and `.gitignore`
✅ Use environment variables
✅ Validate all input
✅ Rate limiting built-in
✅ Error handling on all API calls

```bash
# .gitignore
.env
.env.local
```

---

## 🗺️ Roadmap

### Phase 1: Foundation (Next)
- [ ] **File Upload Helper** - Implement upload endpoints for images/videos
- [ ] **Historical Data Storage** - Store trending data in DB for time-series analysis
- [ ] **Meme Posting** - Generate and post memes with AI

### Phase 2: Intelligence (Future)
- [ ] **Content Strategy Optimizer** - AI-powered posting recommendations
- [ ] **Engagement Prediction** - Predict viral potential before posting
- [ ] **Competitive Analysis** - Compare performance against other users

### Phase 3: Automation (Future)
- [ ] **Smart Auto-Engagement** - Automated likes/replies based on criteria
- [ ] **Thread Scheduling** - Schedule posts for optimal engagement times
- [ ] **Webhook Integration** - Real-time notification webhooks

### Phase 4: Token Economy (Future)
- [ ] **Token Creation** - Create tokens/memecoins on Arena
- [ ] **Token Management** - Manage token metadata, supply, and distribution
- [ ] **Token Trading** - Buy/sell tokens, track prices, execute trades

---

## 🤝 Contributing

Contributions welcome!

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Guidelines

- Follow existing code style
- Add TypeScript types
- Include JSDoc comments
- Add examples to actions
- Test with `bunx tsc --noEmit`

---

## 📝 License

MIT License

---

## 🙏 Acknowledgments

- **ElizaOS Team** - Amazing agent framework
- **Arena.social** - Social platform and API
- **Community Contributors** - Feedback and improvements

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/plugin-arena/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/plugin-arena/discussions)

---

**Made with ❤️ for the ElizaOS and Arena communities**
