/**
 * @file postMetricsService.js
 * @description
 * This file is the powerhouse for calculating and updating a post's various
 * relevance and popularity metrics within the database. It's designed to be
 * triggered whenever a significant engagement event occurs on a post (e.g.,
 * a view, like, comment, or share).
 *
 * The `updatePostMetricsDB` function takes raw engagement signals and
 * transforms them into sophisticated scores that drive the recommendation
 * and trending algorithms. It handles:
 *
 * 1.  **Engagement Weighting:** Applying predefined weights to different event types
 * (like, comment, share, view, completion) to get a total engagement `weight`
 * for the current interaction.
 *
 * 2.  **Sliding Window Events:** Maintaining a short-term history of recent
 * engagement events in the `windowEvents` array, which is crucial for
 * detecting "rising" content. Older events outside the `RISING_WINDOW_MS`
 * are pruned.
 *
 * 3.  **Exponential Moving Averages (EMAs):** Calculating both `shortTermVelocityEMA`
 * and `historicalVelocityEMA`. These EMAs track the "speed" of engagement
 * over different timeframes, using half-life decay to give more weight to
 * recent activity.
 *
 * 4.  **Trending Score Calculation:** Deriving a `trendingScore` by combining
 * the velocity ratio of short-term vs. long-term EMAs (identifying bursts
 * of popularity) with a "burst score" that rewards posts with high recent activity.
 *
 * 5.  **"Is Rising" Status:** Determining if a post should be flagged as `isRising`
 * by comparing its recent activity rate (from `windowEvents`) against its
 * long-term baseline.
 *
 * 6.  **Bayesian Score Calculation:** This is a sophisticated step that "smooths"
 * a post's average engagement using global category statistics and creator-specific
 * averages as a "prior." This helps in two main ways:
 * * **Cold Start Problem:** New posts with few interactions get a more
 * reasonable initial score instead of wildly fluctuating.
 * * **Stability:** It makes scores more robust by incorporating broader
 * context, preventing a single viral moment from disproportionately
 * inflating a score. The prior decays over time, allowing the post's
 * actual performance to eventually dominate.
 *
 * 7.  **Time Decay on Bayesian Score:** The Bayesian score is further decayed
 * based on the post's age, ensuring older content (even if historically
 * good) doesn't endlessly outrank fresh content.
 *
 * 8.  **Database Persistence:** Finally, all calculated metrics are saved back
 * to the `Post` document in MongoDB.
 *
 * This function is designed to be idempotent and can be called repeatedly
 * with new events, ensuring post metrics are always up-to-date and reflect
 * the latest user interactions, contributing to a dynamic and relevant content feed.
 *
 * @param {string} postId - The ID of the post to update.
 * @param {string[]} eventTypes - An array of event types (e.g., ['view', 'like'])
 * that just occurred on the post.
 * @param {number} nowMs - The current timestamp in milliseconds, used for consistent
 * time calculations (defaults to Date.now()).
 * @returns {object} An object containing the updated trendingScore, isRising status,
 * and bayesianScore.
 */

import Post from "../../models/postModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";

import {
  WEIGHTS,
  TRENDING_THRESHOLD,
  TRENDING_EXPONENT,
  TRENDING_WEIGHT,
  TRENDING_ACTIVITY_NORMALIZER,
  TRENDING_BURST_FACTOR,
  PRIOR_INITIAL_COUNT,
  PRIOR_DECAY_LAMBDA,
  PRIOR_CREATOR_WEIGHT,
  PRIOR_MIN_COUNT,
  HALF_LIFE_DAYS,
  MS_PER_DAY,
  RISING_WINDOW_MS,
  RISING_RATE_MULTIPLIER,
  SHORT_HALF_LIFE_MS,
  LONG_HALF_LIFE_MS,
} from "../../constants/scoringConfig.js";

import { choosePriorCount } from "../../utils/smoothingUtils.js";

// Pre-calculate decay constants (lambda) for Exponential Moving Averages (EMAs).
// Lambda is derived from the half-life: λ = ln(2) / half_life_in_ms.
// This constant determines how quickly old data "fades out" in the EMA calculation.
const LAMBDA_SHORT = Math.log(2) / SHORT_HALF_LIFE_MS;
const LAMBDA_LONG = Math.log(2) / LONG_HALF_LIFE_MS;

export async function updatePostMetricsDB(
  postId,
  eventTypes = [],
  nowMs = Date.now()
) {
  const post = await Post.findById(postId);
  if (!post) throw new Error("Post not found");

  // Calculate the total 'weight' of the current engagement event(s)
  // by summing up the predefined weights for each event type (e.g., view, like).
  const weight = eventTypes.reduce((sum, e) => sum + (WEIGHTS[e] || 0), 0);

  // --- Manage Sliding Window of Recent Events ---
  const windowStart = nowMs - RISING_WINDOW_MS;

  // Filter out events that fall outside the defined 'rising window' (e.g., older than 1 hour).
  post.windowEvents = (post.windowEvents || []).filter(
    ({ ts }) => ts.getTime() >= windowStart
  );

  // Add the current event to the window.
  post.windowEvents.push({ ts: new Date(nowMs), weight });

  // To prevent the windowEvents array from growing indefinitely, cap its size.
  // If it exceeds 200 events, remove the oldest one.
  if (post.windowEvents.length > 200) post.windowEvents.shift();

  // --- Prepare for EMA and Decay Calculations ---

  // Get the last update timestamp, defaulting to post creation time if not set.
  const createdAtMs = post.createdAt.getTime();

  // Calculate the time elapsed since the last trending update.
  const lastUpdMs = post.lastTrendingUpdate?.getTime() ?? createdAtMs;

  // Calculate the total age of the post.
  const delta = nowMs - lastUpdMs;
  const ageMs = nowMs - createdAtMs;
  const ageDays = ageMs / MS_PER_DAY; // Convert age to days for decay formulas.

  // Retrieve existing EMA values, defaulting to 0 if not present (for new posts).
  const oldShort = post.shortTermVelocityEMA || 0;
  const oldLong = post.historicalVelocityEMA || 0;

  // --- Calculate New Exponential Moving Averages (EMAs) ---
  // EMAs are used to track the 'velocity' of engagement. The alpha value
  // determines how much weight the new observation gets vs. the old EMA.
  // Here, alpha is derived from lambda (decay constant) and delta (time elapsed),
  // making the EMA's responsiveness dynamic based on update frequency.
  const alphaShort = 1 - Math.exp(-LAMBDA_SHORT * delta);
  const alphaLong = 1 - Math.exp(-LAMBDA_LONG * delta);

  // The core EMA formula: new_EMA = old_EMA * (1 - alpha) + new_observation * alpha
  const newShortEMA = oldShort * (1 - alphaShort) + weight * alphaShort;
  const newLongEMA = oldLong * (1 - alphaLong) + weight * alphaLong;

  // --- Trending Score Calculation ---
  const epsilon = 1e-6; // A small constant to prevent division by zero.

  // velocityRatio: Compares short-term responsiveness to long-term baseline.
  // A ratio > 1 means recent engagement is higher than historical average.
  const velocityRatio = newShortEMA / (newLongEMA + epsilon);

  // ratioScore: Applies a weight and exponent to the velocity ratio.
  // This heavily influences the trending score based on how "fast" a post is gaining traction.
  const ratioScore =
    TRENDING_WEIGHT * Math.pow(velocityRatio, TRENDING_EXPONENT);

  // normalizedActivity: Scales the short-term activity to a range of 0-1,
  // preventing excessively high numbers from completely skewing the score.
  // It gives a sense of how much recent activity contributes relative to a normalizer.
  const normalizedActivity = Math.min(
    1,
    newShortEMA / TRENDING_ACTIVITY_NORMALIZER
  );

  // burstScore: Rewards posts that have a sudden, significant increase in activity.
  // This helps identify viral content that might be "bursting" onto the scene.
  const burstScore =
    TRENDING_WEIGHT * TRENDING_BURST_FACTOR * normalizedActivity;

  // The final trending score is a combination of the velocity ratio's impact
  // and the specific "burst" recognition.
  const trendingScore = ratioScore + burstScore;

  // --- "Is Rising" Status Calculation ---
  // Calculate the total engagement weight within the `RISING_WINDOW_MS`.
  const windowWeight = post.windowEvents.reduce((sum, e) => sum + e.weight, 0);

  // Convert the window duration to hours.
  const windowHours = RISING_WINDOW_MS / (1000 * 3600);

  // Calculate the average engagement rate within the current window (weight per hour).
  const windowRate = windowWeight / windowHours;

  // Convert the long-term EMA (per millisecond) to an hourly baseline rate for comparison.
  const baselineRate = newLongEMA * (1000 * 3600);

  // A post is considered 'rising' if its current window rate is significantly
  // (RISING_RATE_MULTIPLIER times) higher than its long-term baseline rate.
  let isRising = false;

  // Only evaluate 'isRising' if the post is NOT currently considered evergreen
  // post.isEvergreen will be the value from the last cron run
  if (!post.isEvergreen) {
    isRising = windowRate / (baselineRate + epsilon) >= RISING_RATE_MULTIPLIER;
  } else {
    isRising = false;
  }

  // --- Bayesian Score Calculation (Smoothed Average Engagement) ---
  // This section applies Bayesian smoothing to the post's average engagement.
  // It mixes the post's observed engagement with "prior" global knowledge
  // (category and creator averages) to get a more stable score, especially for new posts.

  // 1. Get Global Category Average
  const catName = post.category;
  let catStats = await GlobalStats.findOne({
    entityType: "category",
    name: catName,
  });

  // If category stats don't exist yet, create a placeholder.
  if (!catStats) {
    catStats = await GlobalStats.create({
      entityType: "category",
      name: catName,
      impressionCount: 0,
      totalEngagement: 0,
    });
  }

  // Calculate the global average engagement for this category.
  const catAvg =
    catStats.impressionCount > 0
      ? catStats.totalEngagement / catStats.impressionCount
      : 0; // Default to 0 if no impressions yet.

  // 2. Get Creator Average
  const creatorIdStr = post.creator.toString();
  let creatorStats = await CreatorStats.findOne({ creatorId: creatorIdStr });

  // If creator stats don't exist yet, create a placeholder.
  if (!creatorStats) {
    creatorStats = await CreatorStats.create({
      creatorId: creatorIdStr,
      impressionCount: 0,
      totalEngagement: 0,
    });
  }

  // Calculate the average engagement for this creator. If no impressions yet,
  // fall back to the category average to provide a reasonable default.
  const creatorAvg =
    creatorStats.impressionCount > 0
      ? creatorStats.totalEngagement / creatorStats.impressionCount
      : catAvg;

  // 3. Combine Category and Creator Averages for the Prior Mean
  // This creates a weighted average of the category and creator performance,
  // serving as the "expected" performance of this post based on its context.
  const priorMean =
    PRIOR_CREATOR_WEIGHT * creatorAvg + (1 - PRIOR_CREATOR_WEIGHT) * catAvg;

  // // 4. Get Observed Counts from the Post
  // const obsCount = post.impressionCount || 0; // Total times post was shown
  // const obsSum = post.engagementSum || 0; // Total accumulated engagement weight

  // // Use the choosePriorCount utility for a dynamic prior based on post's global impressions
  // const priorCount = choosePriorCount(obsCount); // Using obsCount as globalImpr for the post

  // // 5. Calculate the Smoothed Average
  // // This is the core Bayesian formula: (prior_mean * prior_count + observed_sum) / (prior_count + observed_count)
  // // It blends the "expected" performance with the "actual" performance.
  // const smoothedAvg =
  //   (priorMean * priorCount + obsSum) / (priorCount + obsCount);

  // // --- Apply Final Time Decay to Bayesian Score ---
  // // A final decay factor based on the post's age, ensuring older posts naturally
  // // fall in ranking unless they receive renewed engagement.
  // const lambdaTime = Math.log(2) / HALF_LIFE_DAYS; // Half-life in days
  // const timeDecay = Math.exp(-lambdaTime * ageDays);

  // // The final bayesian score is the smoothed average, adjusted for time decay.
  // const bayesianScore = smoothedAvg * timeDecay;

  // 4. Get Observed Counts from the Post
  const obsCount = post.impressionCount || 0; // Total times post was shown
  const obsSum = post.engagementSum || 0; // Total accumulated engagement weight

  // Use choosePriorCount to get initial prior count based on impressions
  const initialPriorCount = choosePriorCount(obsCount);

  // Decay the prior count as the post ages
  const decayedPriorCount = Math.max(
    PRIOR_MIN_COUNT,
    initialPriorCount * Math.exp(-PRIOR_DECAY_LAMBDA * ageMs)
  );

  // 5. Calculate the Smoothed Average
  const smoothedAvg =
    (priorMean * decayedPriorCount + obsSum) / (decayedPriorCount + obsCount);

  // --- Apply Final Time Decay to Bayesian Score ---
  const lambdaTime = Math.log(2) / HALF_LIFE_DAYS; // Half-life in days
  const timeDecay = Math.exp(-lambdaTime * ageDays);

  // The final bayesian score is the smoothed average, adjusted for time decay.
  const bayesianScore = smoothedAvg * timeDecay;

  // --- Update Post Document and Save ---
  post.shortTermVelocityEMA = newShortEMA;
  post.historicalVelocityEMA = newLongEMA;
  post.trendingScore = trendingScore;
  post.isRising = isRising;
  post.lastTrendingUpdate = new Date(nowMs); // Specific timestamp for trending updates.
  post.bayesianScore = bayesianScore;

  await post.save();

  return {
    trendingScore,
    isRising,
    bayesianScore,
  };
}
