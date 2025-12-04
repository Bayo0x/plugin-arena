# Arena Plugin for ElizaOS

ElizaOS plugin for Arena.social integration. Post threads, engage with content, monitor trends, and analyze performance.

## Requirements

- Node.js >= 18.0.0
- Bun >= 1.0.0
- ElizaOS >= 1.6.0
- Arena.social account with access token

## Installation

```bash
bun add @bayo0x/plugin-arena
```

Or from source:

```bash
git clone https://github.com/Bayo0x/plugin-arena.git
cd plugin-arena
bun install
bun run build
```

## Configuration

### Required Environment Variable

```bash
ARENA_ACCESS_TOKEN=your_arena_access_token
```

Get your access token from Arena.social account settings.

### Optional Environment Variables

#### API Settings

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_BASE_URL | https://api.arena.social | Arena API base URL |
| ARENA_USER_AGENT | - | Custom user agent for API requests |
| ARENA_DEFAULT_FEED | trending | Default feed: trending, suggested, my, home, public |
| ARENA_HTTP_TIMEOUT_MS | 30000 | HTTP timeout in milliseconds |
| ARENA_FEED_PAGE_SIZE | 50 | Threads per page |

#### Posting Settings

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_PRIVACY_TYPE | 0 | 0=public, 1=private, 2=followers, 3=mentions, 5=community |
| ARENA_COMMUNITY_ID | - | Default community ID for posts |
| ARENA_DRY_RUN | false | Log actions without executing |
| ARENA_MAX_THREAD_LENGTH | 280 | Maximum thread length |
| ARENA_RETRY_LIMIT | 3 | Retry limit for failed API calls |

#### Automated Posting Service

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_ENABLE_POST | false | Enable scheduled posting |
| ARENA_POST_IMMEDIATELY | false | Post on startup |
| ARENA_POST_INTERVAL | 120 | Posting interval in minutes |
| ARENA_POST_INTERVAL_MIN | 90 | Minimum interval for jitter |
| ARENA_POST_INTERVAL_MAX | 150 | Maximum interval for jitter |
| ARENA_MAX_BLOCKS_PER_RUN | 1 | Max threads per posting cycle |

#### Discovery Service

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_ENABLE_DISCOVERY | false | Enable automated discovery |
| ARENA_TARGET_FEEDS | trending,suggested | Feeds to monitor (comma-separated) |
| ARENA_TARGET_USERS | - | Users to monitor (comma-separated) |
| ARENA_DISCOVERY_INTERVAL | 15 | Discovery scan interval in minutes |
| ARENA_DISCOVERY_INTERVAL_MIN | 10 | Minimum interval for jitter |
| ARENA_DISCOVERY_INTERVAL_MAX | 20 | Maximum interval for jitter |
| ARENA_MIN_FOLLOWER_COUNT | 10 | Minimum followers to engage |
| ARENA_MAX_FOLLOWS_PER_CYCLE | 5 | Max follows per discovery cycle |

#### Engagement System

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_ENABLE_ENGAGEMENT | false | Enable automated engagement |
| ARENA_ENABLE_REPLIES | true | Enable automated replies |
| ARENA_ENABLE_ACTIONS | false | Enable likes, reposts, quotes |
| ARENA_ENGAGEMENT_INTERVAL | 30 | Engagement scan interval in minutes |
| ARENA_MAX_ENGAGEMENTS_PER_RUN | 5 | Max engagements per cycle |

#### Rate Limits

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_MAX_LIKES_PER_HOUR | 20 | Maximum likes per hour |
| ARENA_MAX_REPOSTS_PER_HOUR | 10 | Maximum reposts per hour |
| ARENA_MAX_REPLIES_PER_HOUR | 10 | Maximum replies per hour |
| ARENA_MAX_FOLLOWS_PER_HOUR | 10 | Maximum follows per hour |

#### Trending Monitor Service

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_TRENDING_MONITOR_ENABLED | true | Enable trending monitoring |
| ARENA_TRENDING_SCAN_INTERVAL | 15 | Scan interval in minutes |
| ARENA_TRENDING_FEEDS | trending,suggested | Feeds to scan |
| ARENA_TRENDING_STORE_MEMORY | true | Store trending data in memory |
| ARENA_TRENDING_MAX_SNAPSHOTS | 20 | Max snapshots to keep |

#### Mention Monitor Service

| Variable | Default | Description |
|----------|---------|-------------|
| ARENA_MENTION_MONITOR_ENABLED | true | Enable mention monitoring |
| ARENA_MENTION_SCAN_INTERVAL | 1 | Scan interval in minutes |
| ARENA_MENTION_MAX_AGE_HOURS | 48 | Max mention age to process |
| ARENA_MENTION_MIN_LENGTH | 10 | Minimum content length |
| ARENA_MENTION_EXCLUDE_SPAM | true | Filter spam mentions |
| ARENA_MENTION_STORE_HISTORY | true | Store mention history |
| ARENA_MENTION_MAX_HISTORY | 50 | Max mentions in history |

## Character Configuration

Add the plugin to your character JSON:

```json
{
  "name": "YourAgent",
  "plugins": [
    "@elizaos/plugin-bootstrap",
    "@elizaos/plugin-sql",
    "@elizaos/plugin-openai",
    "@bayo0x/plugin-arena"
  ],
  "settings": {
    "secrets": {
      "ARENA_ACCESS_TOKEN": "your-token"
    }
  }
}
```

## Actions

The plugin provides 12 actions:

### Thread Management

| Action | Description |
|--------|-------------|
| CREATE_ARENA_BLOCK | Create a new thread |
| FETCH_ARENA_CHANNEL | Fetch threads from a feed |

### Engagement

| Action | Description |
|--------|-------------|
| LIKE_ARENA_THREAD | Like a thread |
| REPOST_ARENA_THREAD | Repost a thread |
| QUOTE_ARENA_THREAD | Quote a thread with commentary |
| REPLY_ARENA_THREAD | Reply to a thread |

### Analytics

| Action | Description |
|--------|-------------|
| ANALYZE_ARENA_TRENDING | Analyze trending content with velocity scores |
| ANALYZE_ARENA_USER_PERFORMANCE | Analyze user engagement and influence |
| COMPARE_ARENA_FEEDS | Compare feeds for strategy optimization |
| GET_TRENDING_ARENA | Get cached trending data from memory |

### Discovery

| Action | Description |
|--------|-------------|
| SUMMARIZE_ARENA_USER | Get user profile summary |
| FIND_ARENA_MENTIONS | Find mentions and notifications |

## Services

The plugin includes 3 background services:

| Service | Description |
|---------|-------------|
| ArenaService | Main service for posting and discovery |
| ArenaTrendingMonitorService | Monitors trending posts and topics |
| ArenaMentionMonitorService | Monitors mentions and prevents duplicate responses |

## Quick Start Examples

### Read-Only Bot

```bash
ARENA_ACCESS_TOKEN=your_token
```

### Content Creator Bot

```bash
ARENA_ACCESS_TOKEN=your_token
ARENA_ENABLE_POST=true
ARENA_POST_INTERVAL=120
ARENA_TRENDING_MONITOR_ENABLED=true
```

### Social Engagement Bot

```bash
ARENA_ACCESS_TOKEN=your_token
ARENA_ENABLE_ACTIONS=true
ARENA_ENABLE_REPLIES=true
ARENA_ENABLE_ENGAGEMENT=true
ARENA_MENTION_MONITOR_ENABLED=true
ARENA_MENTION_SCAN_INTERVAL=1
```

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Development mode with watch
bun run dev

# Type check
bunx tsc --noEmit

# Format code
bun run format
```

## Project Structure

```
plugin-arena/
├── src/
│   ├── actions/           # 12 action implementations
│   ├── client/            # Arena API client
│   ├── services/          # Background services
│   ├── utils/             # Analytics and mention utilities
│   ├── types.ts           # TypeScript types
│   ├── constants.ts       # Default values
│   ├── environment.ts     # Configuration loading
│   └── index.ts           # Plugin export
├── dist/                  # Build output
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

## License

MIT License - see LICENSE file for details.
