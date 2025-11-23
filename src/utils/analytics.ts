import type { ArenaThread, ArenaUser } from "../types";
import type { ArenaClient } from "../client/arenaClient";

// ========================================
// TRENDING DETECTION
// ========================================

export interface TrendingThread {
  thread: ArenaThread;
  score: number;
  velocityScore: number; // Engagement rate over time
  rank: number;
  metrics: {
    totalEngagement: number;
    engagementPerHour: number;
    ageHours: number;
  };
}

export interface TrendingOptions {
  timeWindow?: number; // Hours to look back (default: 24)
  minEngagement?: number; // Minimum total engagement (default: 3)
  weightLikes?: number; // Default: 1
  weightReposts?: number; // Default: 2
  weightReplies?: number; // Default: 1.5
  weightBookmarks?: number; // Default: 1
  includeViews?: boolean; // Include view count in score (default: false)
}

export function detectTrendingThreads(
  threads: ArenaThread[],
  options?: TrendingOptions,
): TrendingThread[] {
  const now = Date.now();
  const timeWindow = (options?.timeWindow || 24) * 60 * 60 * 1000;

  const weightLikes = options?.weightLikes ?? 1;
  const weightReposts = options?.weightReposts ?? 2;
  const weightReplies = options?.weightReplies ?? 1.5;
  const weightBookmarks = options?.weightBookmarks ?? 1;
  const minEngagement = options?.minEngagement ?? 3;

  return threads
    .filter((t) => {
      const age = now - new Date(t.createdDate).getTime();
      return age <= timeWindow;
    })
    .map((thread) => {
      const age = (now - new Date(thread.createdDate).getTime()) / (60 * 60 * 1000); // hours
      const ageHours = Math.max(age, 0.1); // Prevent division by zero

      const totalEngagement =
        thread.likeCount * weightLikes +
        thread.repostCount * weightReposts +
        thread.answerCount * weightReplies +
        (thread.bookmarkCount || 0) * weightBookmarks;

      const engagementPerHour = totalEngagement / ageHours;

      // Velocity score: how fast it's gaining engagement
      const velocityScore = engagementPerHour;

      // Combined score: velocity * sqrt(total engagement)
      // This rewards both speed and absolute numbers
      const score = velocityScore * Math.sqrt(totalEngagement);

      return {
        thread,
        score,
        velocityScore,
        rank: 0, // Will be set after sorting
        metrics: {
          totalEngagement,
          engagementPerHour,
          ageHours,
        },
      };
    })
    .filter((t) => {
      const rawEngagement =
        t.thread.likeCount +
        t.thread.repostCount +
        t.thread.answerCount +
        (t.thread.bookmarkCount || 0);
      return rawEngagement >= minEngagement;
    })
    .sort((a, b) => b.score - a.score)
    .map((t, index) => ({ ...t, rank: index + 1 }));
}

// ========================================
// USER PERFORMANCE ANALYTICS
// ========================================

export interface UserAnalytics {
  user: ArenaUser;
  metrics: {
    totalEngagement: number;
    avgEngagementPerPost: number;
    engagementRate: number; // Engagement / followers
    postFrequency: number; // Posts per day (approximate)
    peakPostingHours: number[]; // Hours of day (0-23)
    topPerformingContent: ArenaThread[];
  };
  growth: {
    followerGrowthRate?: number; // If historical data available
    engagementTrend: "up" | "down" | "stable";
    trendConfidence: number; // 0-1
  };
  influence: {
    score: number; // Combined influence metric
    tier: "nano" | "micro" | "macro" | "mega";
    engagementQuality: number; // Ratio of engaged users to followers
  };
}

export async function analyzeUser(
  userId: string,
  client: ArenaClient,
  options?: {
    threadCount?: number;
    includeGrowth?: boolean;
  },
): Promise<UserAnalytics> {
  const user = await client.getUserById(userId);
  const feedResponse = await client.getFeed(`user:${userId}`, {
    page: 1,
    pageSize: options?.threadCount || 50,
  });

  const threads = feedResponse.threads;

  // Calculate metrics
  const totalEngagement = threads.reduce(
    (sum, t) => sum + t.likeCount + t.repostCount + t.answerCount,
    0,
  );

  const avgEngagementPerPost = threads.length > 0 ? totalEngagement / threads.length : 0;
  const engagementRate = user.followerCount > 0 ? totalEngagement / user.followerCount : 0;

  // Calculate posting frequency (approximate)
  const oldestThread = threads[threads.length - 1];
  const newestThread = threads[0];
  let postFrequency = 0;
  if (oldestThread && newestThread) {
    const timeSpan =
      (new Date(newestThread.createdDate).getTime() -
        new Date(oldestThread.createdDate).getTime()) /
      (24 * 60 * 60 * 1000); // days
    postFrequency = timeSpan > 0 ? threads.length / timeSpan : 0;
  }

  // Extract peak posting hours
  const hourCounts = new Map<number, number>();
  threads.forEach((t) => {
    const hour = new Date(t.createdDate).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
  });
  const peakPostingHours = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map((entry) => entry[0]);

  // Top performing content
  const topPerformingContent = [...threads]
    .sort(
      (a, b) =>
        b.likeCount +
        b.repostCount +
        b.answerCount -
        (a.likeCount + a.repostCount + a.answerCount),
    )
    .slice(0, 5);

  // Engagement trend (simple heuristic: first half vs second half)
  let engagementTrend: "up" | "down" | "stable" = "stable";
  let trendConfidence = 0;
  if (threads.length >= 10) {
    const midpoint = Math.floor(threads.length / 2);
    const recentThreads = threads.slice(0, midpoint);
    const olderThreads = threads.slice(midpoint);

    const recentAvg =
      recentThreads.reduce(
        (sum, t) => sum + t.likeCount + t.repostCount + t.answerCount,
        0,
      ) / recentThreads.length;
    const olderAvg =
      olderThreads.reduce(
        (sum, t) => sum + t.likeCount + t.repostCount + t.answerCount,
        0,
      ) / olderThreads.length;

    const difference = recentAvg - olderAvg;
    const percentChange = olderAvg > 0 ? Math.abs(difference / olderAvg) : 0;

    if (percentChange > 0.2) {
      engagementTrend = difference > 0 ? "up" : "down";
      trendConfidence = Math.min(percentChange, 1);
    } else {
      trendConfidence = 1 - percentChange;
    }
  }

  // Determine influence tier
  let tier: "nano" | "micro" | "macro" | "mega";
  if (user.followerCount < 1000) tier = "nano";
  else if (user.followerCount < 10000) tier = "micro";
  else if (user.followerCount < 100000) tier = "macro";
  else tier = "mega";

  // Influence score: combines followers and engagement
  const influenceScore =
    Math.log10(user.followerCount + 1) * Math.log10(avgEngagementPerPost + 1);

  // Engagement quality: how well they engage their audience
  const engagementQuality = user.followerCount > 0 ? avgEngagementPerPost / user.followerCount : 0;

  return {
    user,
    metrics: {
      totalEngagement,
      avgEngagementPerPost,
      engagementRate,
      postFrequency,
      peakPostingHours,
      topPerformingContent,
    },
    growth: {
      engagementTrend,
      trendConfidence,
    },
    influence: {
      score: influenceScore,
      tier,
      engagementQuality,
    },
  };
}

// ========================================
// CONTENT PERFORMANCE TRACKER
// ========================================

export interface ContentPerformance {
  threadId: string;
  content: string;
  author: {
    userId: string;
    userHandle: string;
    userName: string;
  };
  metrics: {
    likes: number;
    reposts: number;
    replies: number;
    bookmarks: number;
    views: number;
    totalEngagement: number;
  };
  performance: {
    score: number;
    percentile: number; // Compared to other posts
    isViral: boolean; // Above threshold
    isTrending: boolean; // High velocity
    rank?: number;
  };
  insights: {
    ageHours: number;
    velocity: number; // Engagement per hour
    bestTime: string; // Time of day posted
    contentType: "text" | "image" | "video" | "mixed";
    hasMedia: boolean;
    contentLength: number;
  };
}

export interface ContentPerformanceOptions {
  viralThreshold?: number; // Min engagement to be "viral" (default: 100)
  trendingVelocity?: number; // Min engagement per hour (default: 10)
  calculatePercentiles?: boolean; // Whether to calculate percentiles (default: true)
}

export function trackContentPerformance(
  threads: ArenaThread[],
  options?: ContentPerformanceOptions,
): ContentPerformance[] {
  const now = Date.now();
  const viralThreshold = options?.viralThreshold ?? 100;
  const trendingVelocity = options?.trendingVelocity ?? 10;
  const calculatePercentiles = options?.calculatePercentiles ?? true;

  const performances = threads.map((thread) => {
    const totalEngagement =
      thread.likeCount +
      thread.repostCount +
      thread.answerCount +
      (thread.bookmarkCount || 0);

    const ageMs = now - new Date(thread.createdDate).getTime();
    const ageHours = ageMs / (60 * 60 * 1000);
    const velocity = ageHours > 0 ? totalEngagement / ageHours : 0;

    const isViral = totalEngagement >= viralThreshold;
    const isTrending = velocity >= trendingVelocity;

    // Determine content type
    let contentType: "text" | "image" | "video" | "mixed" = "text";
    const hasImages = (thread.images?.length || 0) > 0;
    const hasVideos = (thread.videos?.length || 0) > 0;
    if (hasImages && hasVideos) contentType = "mixed";
    else if (hasVideos) contentType = "video";
    else if (hasImages) contentType = "image";

    const performance: ContentPerformance = {
      threadId: thread.id,
      content: thread.content,
      author: {
        userId: thread.userId,
        userHandle: thread.userHandle,
        userName: thread.userName,
      },
      metrics: {
        likes: thread.likeCount,
        reposts: thread.repostCount,
        replies: thread.answerCount,
        bookmarks: thread.bookmarkCount || 0,
        views: thread.viewCount || 0,
        totalEngagement,
      },
      performance: {
        score: totalEngagement,
        percentile: 0, // Calculate after getting all scores
        isViral,
        isTrending,
      },
      insights: {
        ageHours,
        velocity,
        bestTime: new Date(thread.createdDate).getHours() + ":00",
        contentType,
        hasMedia: hasImages || hasVideos,
        contentLength: thread.content.length,
      },
    };

    return performance;
  });

  // Calculate percentiles if requested
  if (calculatePercentiles && performances.length > 0) {
    const sortedScores = performances.map((p) => p.performance.score).sort((a, b) => a - b);

    performances.forEach((perf) => {
      const position = sortedScores.findIndex((score) => score >= perf.performance.score);
      perf.performance.percentile =
        position >= 0 ? (position / sortedScores.length) * 100 : 100;
    });

    // Add ranks
    const ranked = [...performances].sort((a, b) => b.performance.score - a.performance.score);
    ranked.forEach((perf, index) => {
      perf.performance.rank = index + 1;
    });
  }

  return performances;
}

// ========================================
// FEED COMPARISON
// ========================================

export interface FeedStats {
  name: string;
  threadCount: number;
  avgEngagement: number;
  avgLikes: number;
  avgReposts: number;
  avgReplies: number;
  topAuthors: Array<{ handle: string; count: number; avgEngagement: number }>;
  contentTypes: Record<string, number>;
  peakActivity: {
    hour: number;
    count: number;
  };
  engagementDistribution: {
    viral: number; // threads with >100 engagement
    trending: number; // threads with >10 engagement/hour
    normal: number; // everything else
  };
}

export interface FeedComparison {
  feeds: FeedStats[];
  insights: {
    mostEngaging: string; // Feed name
    mostActive: string; // Feed with most posts
    bestForDiscovery: string; // Feed with most diverse authors
    recommendation: string; // Which feed to focus on
  };
}

export async function compareFeedPerformance(
  client: ArenaClient,
  feedKeys: string[],
  options?: {
    pageSize?: number;
  },
): Promise<FeedComparison> {
  const pageSize = options?.pageSize || 50;

  const feedData = await Promise.all(
    feedKeys.map(async (feedKey) => {
      const feed = await client.getFeed(feedKey, {
        page: 1,
        pageSize,
      });

      const threads = feed.threads;
      const threadCount = threads.length;

      if (threadCount === 0) {
        return {
          name: feedKey,
          threadCount: 0,
          avgEngagement: 0,
          avgLikes: 0,
          avgReposts: 0,
          avgReplies: 0,
          topAuthors: [],
          contentTypes: {},
          peakActivity: { hour: 0, count: 0 },
          engagementDistribution: { viral: 0, trending: 0, normal: 0 },
        };
      }

      const totalEngagement = threads.reduce(
        (sum, t) => sum + t.likeCount + t.repostCount + t.answerCount,
        0,
      );
      const avgEngagement = totalEngagement / threadCount;
      const avgLikes = threads.reduce((sum, t) => sum + t.likeCount, 0) / threadCount;
      const avgReposts = threads.reduce((sum, t) => sum + t.repostCount, 0) / threadCount;
      const avgReplies = threads.reduce((sum, t) => sum + t.answerCount, 0) / threadCount;

      // Top authors
      const authorStats = new Map<
        string,
        { count: number; totalEngagement: number }
      >();
      threads.forEach((t) => {
        const handle = t.userHandle;
        const engagement = t.likeCount + t.repostCount + t.answerCount;
        const stats = authorStats.get(handle) || { count: 0, totalEngagement: 0 };
        stats.count += 1;
        stats.totalEngagement += engagement;
        authorStats.set(handle, stats);
      });

      const topAuthors = Array.from(authorStats.entries())
        .map(([handle, stats]) => ({
          handle,
          count: stats.count,
          avgEngagement: stats.totalEngagement / stats.count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Content types
      const contentTypes: Record<string, number> = {
        text: 0,
        image: 0,
        video: 0,
        mixed: 0,
      };
      threads.forEach((t) => {
        const hasImages = (t.images?.length || 0) > 0;
        const hasVideos = (t.videos?.length || 0) > 0;
        if (hasImages && hasVideos) contentTypes.mixed++;
        else if (hasVideos) contentTypes.video++;
        else if (hasImages) contentTypes.image++;
        else contentTypes.text++;
      });

      // Peak activity hour
      const hourCounts = new Map<number, number>();
      threads.forEach((t) => {
        const hour = new Date(t.createdDate).getHours();
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      });
      const peakHour = Array.from(hourCounts.entries()).sort((a, b) => b[1] - a[1])[0] || [
        0, 0,
      ];

      // Engagement distribution
      const now = Date.now();
      const distribution = { viral: 0, trending: 0, normal: 0 };
      threads.forEach((t) => {
        const engagement = t.likeCount + t.repostCount + t.answerCount;
        const ageHours = (now - new Date(t.createdDate).getTime()) / (60 * 60 * 1000);
        const velocity = ageHours > 0 ? engagement / ageHours : 0;

        if (engagement > 100) distribution.viral++;
        else if (velocity > 10) distribution.trending++;
        else distribution.normal++;
      });

      return {
        name: feedKey,
        threadCount,
        avgEngagement,
        avgLikes,
        avgReposts,
        avgReplies,
        topAuthors,
        contentTypes,
        peakActivity: {
          hour: peakHour[0],
          count: peakHour[1],
        },
        engagementDistribution: distribution,
      };
    }),
  );

  // Generate insights
  const mostEngaging = feedData.reduce((best, current) =>
    current.avgEngagement > best.avgEngagement ? current : best,
  );

  const mostActive = feedData.reduce((best, current) =>
    current.threadCount > best.threadCount ? current : best,
  );

  // Best for discovery: most diverse authors (calculated as unique authors per post)
  const bestForDiscovery = feedData.reduce((best, current) => {
    const currentDiversity =
      current.threadCount > 0 ? current.topAuthors.length / current.threadCount : 0;
    const bestDiversity =
      best.threadCount > 0 ? best.topAuthors.length / best.threadCount : 0;
    return currentDiversity > bestDiversity ? current : best;
  });

  // Recommendation: highest combination of engagement and activity
  const recommendation = feedData.reduce((best, current) => {
    const currentScore = current.avgEngagement * Math.log10(current.threadCount + 1);
    const bestScore = best.avgEngagement * Math.log10(best.threadCount + 1);
    return currentScore > bestScore ? current : best;
  });

  return {
    feeds: feedData,
    insights: {
      mostEngaging: mostEngaging.name,
      mostActive: mostActive.name,
      bestForDiscovery: bestForDiscovery.name,
      recommendation: recommendation.name,
    },
  };
}

// ========================================
// ENGAGEMENT TIMELINE TRACKER
// ========================================

export interface EngagementSnapshot {
  timestamp: number;
  likes: number;
  reposts: number;
  replies: number;
  bookmarks: number;
  totalEngagement: number;
  growthRate: number; // Engagement added since last snapshot
  velocity: number; // Engagement per hour
}

export interface EngagementTimeline {
  threadId: string;
  snapshots: EngagementSnapshot[];
  predictions: {
    estimatedFinalEngagement: number;
    estimatedViralPotential: number; // 0-1 score
    peakTime?: number; // Timestamp when it will peak
    isAccelerating: boolean;
  };
  analysis: {
    avgGrowthRate: number;
    peakGrowthRate: number;
    currentPhase: "growth" | "peak" | "decline" | "stable";
  };
}

export class EngagementTracker {
  private snapshots = new Map<string, EngagementTimeline>();

  async trackThread(client: ArenaClient, threadId: string): Promise<EngagementTimeline> {
    const thread = await client.getThread(threadId);
    const now = Date.now();

    let timeline = this.snapshots.get(threadId);
    if (!timeline) {
      timeline = {
        threadId,
        snapshots: [],
        predictions: {
          estimatedFinalEngagement: 0,
          estimatedViralPotential: 0,
          isAccelerating: false,
        },
        analysis: {
          avgGrowthRate: 0,
          peakGrowthRate: 0,
          currentPhase: "stable",
        },
      };
      this.snapshots.set(threadId, timeline);
    }

    const previousSnapshot = timeline.snapshots[timeline.snapshots.length - 1];
    const currentEngagement =
      thread.likeCount +
      thread.repostCount +
      thread.answerCount +
      (thread.bookmarkCount || 0);
    const previousEngagement = previousSnapshot ? previousSnapshot.totalEngagement : 0;

    const growthRate = currentEngagement - previousEngagement;

    // Calculate velocity
    const threadAge = (now - new Date(thread.createdDate).getTime()) / (60 * 60 * 1000); // hours
    const velocity = threadAge > 0 ? currentEngagement / threadAge : 0;

    const snapshot: EngagementSnapshot = {
      timestamp: now,
      likes: thread.likeCount,
      reposts: thread.repostCount,
      replies: thread.answerCount,
      bookmarks: thread.bookmarkCount || 0,
      totalEngagement: currentEngagement,
      growthRate,
      velocity,
    };

    timeline.snapshots.push(snapshot);

    // Update analysis
    if (timeline.snapshots.length > 1) {
      const growthRates = timeline.snapshots.map((s) => s.growthRate);
      timeline.analysis.avgGrowthRate =
        growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length;
      timeline.analysis.peakGrowthRate = Math.max(...growthRates);

      // Determine current phase
      const recentSnapshots = timeline.snapshots.slice(-3);
      const isGrowing = recentSnapshots.every((s) => s.growthRate > 0);
      const isDeclining = recentSnapshots.every((s) => s.growthRate < 0);
      const isStable = recentSnapshots.every(
        (s) => Math.abs(s.growthRate) < timeline.analysis.avgGrowthRate * 0.2,
      );

      if (isGrowing) timeline.analysis.currentPhase = "growth";
      else if (isDeclining) timeline.analysis.currentPhase = "decline";
      else if (isStable) timeline.analysis.currentPhase = "stable";
      else timeline.analysis.currentPhase = "peak";

      // Check if accelerating
      const lastThreeGrowth = recentSnapshots.map((s) => s.growthRate);
      timeline.predictions.isAccelerating =
        lastThreeGrowth.length === 3 &&
        lastThreeGrowth[2] > lastThreeGrowth[1] &&
        lastThreeGrowth[1] > lastThreeGrowth[0];
    }

    // Update predictions
    if (timeline.snapshots.length >= 3) {
      // Estimate final engagement using exponential decay model
      const avgGrowthRate = timeline.analysis.avgGrowthRate;
      const hoursRemaining = 48 - threadAge; // Assume 48h lifetime
      timeline.predictions.estimatedFinalEngagement =
        currentEngagement + avgGrowthRate * hoursRemaining * 0.5; // 0.5 decay factor

      // Viral potential based on current velocity and growth trend
      const viralVelocityThreshold = 20; // Engagements per hour
      const velocityScore = Math.min(velocity / viralVelocityThreshold, 1);
      const accelerationScore = timeline.predictions.isAccelerating ? 0.3 : 0;
      timeline.predictions.estimatedViralPotential = Math.min(
        velocityScore + accelerationScore,
        1,
      );

      // Estimate peak time (when growth rate becomes negative)
      if (
        timeline.analysis.currentPhase === "growth" &&
        timeline.predictions.isAccelerating
      ) {
        timeline.predictions.peakTime = now + 6 * 60 * 60 * 1000; // Estimate 6 hours from now
      }
    }

    return timeline;
  }

  getTimeline(threadId: string): EngagementTimeline | undefined {
    return this.snapshots.get(threadId);
  }

  getAllTimelines(): Map<string, EngagementTimeline> {
    return new Map(this.snapshots);
  }

  clearTimeline(threadId: string): void {
    this.snapshots.delete(threadId);
  }

  clearAllTimelines(): void {
    this.snapshots.clear();
  }
}

// ========================================
// OPTIMAL POSTING TIME ANALYZER
// ========================================

export interface PostingTimeAnalysis {
  optimalHours: Array<{
    hour: number;
    score: number;
    avgEngagement: number;
    sampleSize: number;
  }>;
  optimalDays: Array<{
    day: number; // 0=Sunday, 6=Saturday
    score: number;
    avgEngagement: number;
    sampleSize: number;
  }>;
  recommendations: {
    bestHour: number;
    bestDay: number;
    bestTimeString: string;
    confidence: number;
  };
}

export function analyzeOptimalPostingTimes(
  threads: ArenaThread[],
  options?: {
    minSampleSize?: number; // Minimum threads per hour/day for reliable data
  },
): PostingTimeAnalysis {
  const minSampleSize = options?.minSampleSize || 3;

  // Analyze by hour
  const hourStats = new Map<
    number,
    { totalEngagement: number; count: number }
  >();
  const dayStats = new Map<
    number,
    { totalEngagement: number; count: number }
  >();

  threads.forEach((thread) => {
    const date = new Date(thread.createdDate);
    const hour = date.getHours();
    const day = date.getDay();
    const engagement = thread.likeCount + thread.repostCount + thread.answerCount;

    // Hour stats
    const hourStat = hourStats.get(hour) || { totalEngagement: 0, count: 0 };
    hourStat.totalEngagement += engagement;
    hourStat.count += 1;
    hourStats.set(hour, hourStat);

    // Day stats
    const dayStat = dayStats.get(day) || { totalEngagement: 0, count: 0 };
    dayStat.totalEngagement += engagement;
    dayStat.count += 1;
    dayStats.set(day, dayStat);
  });

  // Calculate optimal hours
  const optimalHours = Array.from(hourStats.entries())
    .filter(([_, stats]) => stats.count >= minSampleSize)
    .map(([hour, stats]) => {
      const avgEngagement = stats.totalEngagement / stats.count;
      return {
        hour,
        score: avgEngagement * Math.log10(stats.count + 1),
        avgEngagement,
        sampleSize: stats.count,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Calculate optimal days
  const optimalDays = Array.from(dayStats.entries())
    .filter(([_, stats]) => stats.count >= minSampleSize)
    .map(([day, stats]) => {
      const avgEngagement = stats.totalEngagement / stats.count;
      return {
        day,
        score: avgEngagement * Math.log10(stats.count + 1),
        avgEngagement,
        sampleSize: stats.count,
      };
    })
    .sort((a, b) => b.score - a.score);

  const bestHour = optimalHours[0]?.hour || 12;
  const bestDay = optimalDays[0]?.day || 1;

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const bestTimeString = `${dayNames[bestDay]} at ${bestHour}:00`;

  const confidence =
    optimalHours[0] && optimalDays[0]
      ? Math.min(
          (optimalHours[0].sampleSize / threads.length) * 2,
          (optimalDays[0].sampleSize / threads.length) * 2,
          1,
        )
      : 0;

  return {
    optimalHours,
    optimalDays,
    recommendations: {
      bestHour,
      bestDay,
      bestTimeString,
      confidence,
    },
  };
}
