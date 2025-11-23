# 🚀 Arena Plugin - Improvement Ideas & Roadmap

> Brainstorming document for future enhancements and feature additions

---

## 📊 Historical Trending Data Storage

### Problem
Currently, analytics are point-in-time only. We can't track:
- How topics evolve over time
- Which users are consistently trending
- Content that went from trending to viral
- Historical engagement patterns

### Solution: Time-Series Analytics with DB Storage

#### Database Schema

```sql
-- Track trending snapshots
CREATE TABLE arena_trending_snapshots (
  id UUID PRIMARY KEY,
  snapshot_at TIMESTAMP NOT NULL,
  feed_key VARCHAR(50) NOT NULL,
  thread_id VARCHAR(255) NOT NULL,
  author_handle VARCHAR(100),
  content_preview TEXT,
  rank INTEGER,
  score DECIMAL(10,2),
  velocity_score DECIMAL(10,2),
  engagement_total INTEGER,
  likes INTEGER,
  reposts INTEGER,
  replies INTEGER,
  age_hours DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_snapshot_time (snapshot_at),
  INDEX idx_thread_id (thread_id),
  INDEX idx_feed (feed_key, snapshot_at)
);

-- Track user performance over time
CREATE TABLE arena_user_metrics (
  id UUID PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  handle VARCHAR(100),
  measured_at TIMESTAMP NOT NULL,
  follower_count INTEGER,
  following_count INTEGER,
  thread_count INTEGER,
  total_engagement INTEGER,
  avg_engagement_per_post DECIMAL(10,2),
  engagement_rate DECIMAL(10,4),
  influence_tier VARCHAR(20),
  influence_score DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_time (user_id, measured_at),
  INDEX idx_handle (handle)
);

-- Track content performance trajectory
CREATE TABLE arena_content_trajectory (
  id UUID PRIMARY KEY,
  thread_id VARCHAR(255) NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  engagement_total INTEGER,
  engagement_velocity DECIMAL(10,2),
  status VARCHAR(20), -- 'normal', 'trending', 'viral', 'declining'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_thread_time (thread_id, measured_at)
);
```

#### Implementation

```typescript
// New service: ArenaAnalyticsService
export class ArenaAnalyticsService extends Service {
  static serviceType = "arenaAnalytics";

  async captureSnapshot(runtime: IAgentRuntime): Promise<void> {
    const client = new ArenaClient(token);
    
    // Capture trending snapshot
    const trending = await analyzeTrendingThreads(client, "trending");
    
    await runtime.databaseAdapter.db.run(
      `INSERT INTO arena_trending_snapshots 
       (id, snapshot_at, feed_key, thread_id, rank, score, ...) 
       VALUES (?, ?, ?, ?, ?, ?, ...)`,
      [uuid(), new Date(), "trending", ...trending.map(t => t.data)]
    );
    
    // Capture user metrics for active users
    const activeUsers = await this.getActiveUsers();
    for (const user of activeUsers) {
      const analytics = await analyzeUser(user.id, client);
      await this.saveUserMetrics(runtime, user, analytics);
    }
  }

  // Run every hour to build historical data
  async initialize(runtime: IAgentRuntime): Promise<void> {
    setInterval(() => this.captureSnapshot(runtime), 60 * 60 * 1000);
  }
}
```

#### New Actions

```typescript
// ANALYZE_ARENA_TRENDS_OVER_TIME
// Compare trending topics from last week/month
User: "What topics have been trending this week?"
Agent: *queries database for trending snapshots*
Returns: Topic evolution, emerging trends, declining topics

// ANALYZE_USER_GROWTH
// Track user growth trajectory
User: "How is @alice's follower count growing?"
Agent: *queries user_metrics table*
Returns: Growth chart, growth rate, predictions

// DETECT_BREAKOUT_CONTENT
// Find content going viral
User: "Show me content that's breaking out"
Agent: *analyzes content_trajectory*
Returns: Threads with rapidly increasing velocity
```

---

## 🪙 Token Creation Integration

### Use Case
Agent can create meme coins or tokens based on trending topics/memes.

### Arena Token Creation Endpoints

Need to research Arena's token creation API. Likely endpoints:
```
POST /tokens/create
GET /tokens/{tokenId}
POST /tokens/{tokenId}/mint
GET /tokens/trending
```

### Implementation

```typescript
// New action: CREATE_ARENA_TOKEN
export const createArenaTokenAction: Action = {
  name: "CREATE_ARENA_TOKEN",
  description: "Create a new token on Arena",
  
  handler: async (runtime, message, state, options, callback) => {
    const { name, symbol, description, initialSupply } = extractParams(message);
    
    // Create token
    const token = await client.createToken({
      name,
      symbol,
      description,
      supply: initialSupply,
      imageUrl: await generateTokenImage(name), // AI-generated image
    });
    
    // Post announcement thread
    await client.createThread({
      content: `🪙 New token created: $${symbol}!\n\n${description}\n\nCA: ${token.contractAddress}`,
      files: [{ url: token.imageUrl }],
    });
    
    return { success: true, data: token };
  },
};

// Agent usage
User: "Create a meme token for the trending 'space cats' meme"
Agent: 
  1. Analyzes trending "space cats" content
  2. Generates token metadata (name, symbol, description)
  3. Creates AI-generated token image
  4. Executes CREATE_ARENA_TOKEN
  5. Posts announcement
```

---

## 📁 File Upload Support

### Current Status
`createThread` accepts `files` array but we don't have upload functionality.

### Arena Upload Flow

Based on the schema:
```typescript
interface FileDto {
  id: string;
  url: string;
  isLoading: boolean;
  previewUrl: string;
  fileType: string;
  size: number;
}
```

Likely flow:
```
1. POST /upload/presigned-url → Get upload URL
2. PUT {presigned-url} → Upload file to S3/storage
3. POST /upload/complete → Finalize upload, get FileDto
4. POST /threads with FileDto → Create thread with media
```

### Implementation

```typescript
// New client method
async uploadFile(
  filePath: string,
  fileType: "image" | "video" | "gif"
): Promise<FileDto> {
  // 1. Get presigned URL
  const { uploadUrl, fileId } = await this.request<{uploadUrl: string, fileId: string}>(
    "/upload/presigned-url",
    {
      method: "POST",
      body: JSON.stringify({ fileType, fileName: path.basename(filePath) }),
    }
  );

  // 2. Upload file
  const fileBuffer = await fs.readFile(filePath);
  await fetch(uploadUrl, {
    method: "PUT",
    body: fileBuffer,
    headers: { "Content-Type": getMimeType(fileType) },
  });

  // 3. Complete upload
  const fileDto = await this.request<FileDto>("/upload/complete", {
    method: "POST",
    body: JSON.stringify({ fileId }),
  });

  return fileDto;
}

// Enhanced createThread
async createThreadWithMedia(
  content: string,
  mediaUrls: string[], // Local file paths or URLs
  options?: CreateThreadOptions
): Promise<ArenaThread> {
  // Upload all media
  const files = await Promise.all(
    mediaUrls.map(url => 
      url.startsWith("http") 
        ? this.uploadFromUrl(url)
        : this.uploadFile(url, detectFileType(url))
    )
  );

  return this.createThread({
    content,
    files,
    ...options,
  });
}
```

### Meme Generator Integration

```typescript
// New action: POST_MEME
export const postMemeAction: Action = {
  name: "POST_ARENA_MEME",
  description: "Generate and post a meme to Arena",
  
  handler: async (runtime, message, state, options, callback) => {
    const { topic, style } = extractParams(message);
    
    // 1. Generate meme image (using AI image gen or meme API)
    const memeUrl = await generateMeme({
      topic,
      style,
      template: "two-button" // or detected from trending memes
    });
    
    // 2. Download locally
    const localPath = await downloadImage(memeUrl);
    
    // 3. Generate caption
    const caption = await generateMemeCaption(runtime, topic);
    
    // 4. Upload and post
    const thread = await client.createThreadWithMedia(
      caption,
      [localPath],
      { privacyType: 0 }
    );
    
    return { success: true, data: thread };
  },
};

// Agent usage
User: "Post a meme about the latest crypto dump"
Agent:
  1. Analyzes trending crypto topics
  2. Selects meme template
  3. Generates meme image
  4. Creates witty caption
  5. Posts to Arena with image
```

---

## 📈 Advanced Analytics Features

### 1. Competitive Analysis

```typescript
// COMPARE_USERS action
User: "Compare @alice vs @bob's Arena performance"
Agent:
  - Fetches both user analytics
  - Compares engagement rates, growth, influence
  - Identifies who's performing better and why
  - Returns actionable insights
```

### 2. Content Strategy Optimizer

```typescript
// OPTIMIZE_CONTENT_STRATEGY action
User: "What content should I post on Arena?"
Agent:
  - Analyzes user's past performance
  - Identifies best-performing content types
  - Checks trending topics
  - Suggests optimal posting times
  - Generates content recommendations
```

### 3. Engagement Prediction

```typescript
// PREDICT_ENGAGEMENT action
User: "Will this post go viral?"
Agent:
  - Analyzes draft content
  - Compares to historical viral posts
  - Checks current trending topics
  - Returns viral probability score
  - Suggests improvements
```

---

## 🔄 Automated Engagement Workflows

### Smart Auto-Engagement

```typescript
// New service: AutoEngagementService
export class AutoEngagementService extends Service {
  async evaluateAndEngage(runtime: IAgentRuntime): Promise<void> {
    const client = new ArenaClient(token);
    
    // 1. Fetch mentions
    const mentions = await client.getNotifications();
    
    // 2. Analyze each mention
    for (const mention of mentions) {
      const analysis = await this.analyzeEngagementWorthiness(mention);
      
      if (analysis.shouldLike && analysis.confidence > 0.7) {
        await client.likeThread(mention.threadId);
      }
      
      if (analysis.shouldReply && analysis.confidence > 0.8) {
        const reply = await this.generateReply(runtime, mention);
        await client.replyToThread(mention.threadId, reply);
      }
      
      if (analysis.shouldFollow && analysis.confidence > 0.9) {
        await client.followUser(mention.userId);
      }
    }
  }
  
  private async analyzeEngagementWorthiness(mention: Notification): Promise<{
    shouldLike: boolean;
    shouldReply: boolean;
    shouldFollow: boolean;
    confidence: number;
    reason: string;
  }> {
    // AI-powered analysis of mention worthiness
    // Considers: author influence, content quality, relevance, sentiment
  }
}
```

---

## ⏰ Thread Scheduling

### Use Case
Schedule posts for optimal engagement times.

```typescript
// New table
CREATE TABLE arena_scheduled_threads (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  files JSONB,
  scheduled_for TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, posted, failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

// New action: SCHEDULE_ARENA_POST
User: "Schedule a post about AI for tomorrow at 2pm"
Agent:
  - Generates content
  - Stores in scheduled_threads table
  - Background service posts at scheduled time
```

---

## 🎨 AI-Powered Content Generation

### Thread Composer

```typescript
// COMPOSE_VIRAL_THREAD action
User: "Write a thread about AVAX that will go viral"
Agent:
  1. Analyzes current AVAX trending topics
  2. Identifies viral thread patterns
  3. Generates multi-tweet thread
  4. Includes hashtags, mentions
  5. Optimizes for engagement
  6. Schedules for peak time
```

### Image Generation

```typescript
// GENERATE_ARENA_IMAGE action
User: "Create an image for my Arena post about DeFi"
Agent:
  1. Analyzes DeFi trending visuals
  2. Generates AI image (DALL-E, Midjourney, Stable Diffusion)
  3. Uploads to Arena
  4. Returns file URL for thread creation
```

---

## 🔔 Real-Time Webhooks

### Webhook Integration

```typescript
// New service: ArenaWebhookService
export class ArenaWebhookService extends Service {
  async initialize(runtime: IAgentRuntime): Promise<void> {
    // Register webhook endpoints
    await this.registerWebhooks([
      "thread.created",
      "thread.liked",
      "user.mentioned",
      "user.followed",
    ]);
    
    // Start webhook server
    this.startWebhookServer(runtime);
  }
  
  async handleWebhook(event: WebhookEvent): Promise<void> {
    switch (event.type) {
      case "user.mentioned":
        // Instantly analyze and respond to mentions
        await this.handleMention(event.data);
        break;
      case "thread.liked":
        // Track engagement in real-time
        await this.recordEngagement(event.data);
        break;
    }
  }
}
```

---

## 🎯 Implementation Priority

### Phase 1: Foundation (Immediate)
- [x] File upload support
- [x] Basic analytics storage schema
- [ ] Meme posting capability

### Phase 2: Intelligence (Next)
- [ ] Historical trending data collection
- [ ] Content strategy optimizer
- [ ] Engagement prediction

### Phase 3: Automation (Future)
- [ ] Auto-engagement workflows
- [ ] Thread scheduling
- [ ] Webhook integration

### Phase 4: Advanced (Later)
- [ ] Token creation
- [ ] Competitive analysis
- [ ] AI content generation

---

## 💡 Community Feature Requests

Add your ideas in [GitHub Discussions]!

---

**Last Updated**: 2025-11-23
**Status**: Brainstorming & Planning
