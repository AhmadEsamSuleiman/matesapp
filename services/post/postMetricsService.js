import Post from "../../models/postModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";

import {
  WEIGHTS,
  RISING_RATE_MULTIPLIER,
  SHORT_HALF_LIFE_MS,
  LONG_HALF_LIFE_MS,
  MS_PER_DAY,
  HALF_LIFE_DAYS,
  TRENDING_ACTIVITY_NORMALIZER,
  TRENDING_BURST_FACTOR,
  TRENDING_EXPONENT,
  TRENDING_WEIGHT,
  PRIOR_CREATOR_WEIGHT,
  PRIOR_DECAY_LAMBDA,
  PRIOR_MIN_COUNT,
  MIN_INITIAL_RISING_WEIGHT,
} from "../../constants/scoringConfig.js";

import choosePriorCount from "../../utils/smoothingUtils.js";

const LAMBDA_SHORT = Math.log(2) / SHORT_HALF_LIFE_MS;
const LAMBDA_LONG = Math.log(2) / LONG_HALF_LIFE_MS;

async function updatePostMetricsDB(postId, eventTypes = [], nowMs = Date.now(), scoreDelta = null) {
  const post = await Post.findById(postId);
  if (!post) throw new Error("Post not found");

  const weight = scoreDelta != null ? scoreDelta : eventTypes.reduce((sum, e) => sum + (WEIGHTS[e] || 0), 0);

  const createdAtMs = post.createdAt.getTime();
  const lastUpdMs = post.lastTrendingUpdate?.getTime() ?? createdAtMs;
  const deltaMs = nowMs - lastUpdMs;
  const ageMs = nowMs - createdAtMs;
  const ageDays = ageMs / MS_PER_DAY;

  const oldShort = post.shortTermVelocityEMA || 0;
  const oldLong = post.historicalVelocityEMA || 0;
  const alphaShort = 1 - Math.exp(-LAMBDA_SHORT * deltaMs);
  const alphaLong = 1 - Math.exp(-LAMBDA_LONG * deltaMs);
  const newShortEMA = oldShort * (1 - alphaShort) + weight * alphaShort;
  const newLongEMA = oldLong * (1 - alphaLong) + weight * alphaLong;

  const eps = 1e-6;
  const velocityRatio = newShortEMA / (newLongEMA + eps);
  const ratioScore = TRENDING_WEIGHT * velocityRatio ** TRENDING_EXPONENT;
  const normalizedAct = Math.min(1, newShortEMA / TRENDING_ACTIVITY_NORMALIZER);
  const burstScore = TRENDING_WEIGHT * TRENDING_BURST_FACTOR * normalizedAct;
  const trendingScore = ratioScore + burstScore;

  let isRising;
  const isFirstBatch = lastUpdMs === createdAtMs;
  if (isFirstBatch) {
    isRising = weight >= MIN_INITIAL_RISING_WEIGHT;
  } else {
    isRising = velocityRatio >= RISING_RATE_MULTIPLIER;
  }

  const catDoc = await GlobalStats.findOneAndUpdate(
    { entityType: "category", name: post.category },
    { $setOnInsert: { impressionCount: 0, totalEngagement: 0 } },
    { upsert: true, new: true },
  );
  const catStats = catDoc.value || catDoc;
  const catAvg = catStats.impressionCount > 0 ? catStats.totalEngagement / catStats.impressionCount : 0;

  const creatorDoc = await CreatorStats.findOneAndUpdate(
    { creatorId: post.creator.toString() },
    { $setOnInsert: { impressionCount: 0, totalEngagement: 0 } },
    { upsert: true, new: true },
  );
  const creatorStats = creatorDoc.value || creatorDoc;
  const creatorAvg = creatorStats.impressionCount > 0 ? creatorStats.totalEngagement / creatorStats.impressionCount : catAvg;

  const priorMean = PRIOR_CREATOR_WEIGHT * creatorAvg + (1 - PRIOR_CREATOR_WEIGHT) * catAvg;
  const obsCount = post.impressionCount || 0;
  const obsSum = post.engagementSum || 0;
  const initPrior = choosePriorCount(obsCount);
  const decayedPriorCount = Math.max(PRIOR_MIN_COUNT, initPrior * Math.exp(-PRIOR_DECAY_LAMBDA * ageMs));
  const smoothedAvg = (priorMean * decayedPriorCount + obsSum) / (decayedPriorCount + obsCount);
  const timeDecay = Math.exp((-Math.log(2) / HALF_LIFE_DAYS) * ageDays);
  const bayesianScore = smoothedAvg * timeDecay;

  post.cumulativeScore = 0;
  post.shortTermVelocityEMA = newShortEMA;
  post.historicalVelocityEMA = newLongEMA;
  post.trendingScore = trendingScore;
  post.isRising = isRising;
  post.lastTrendingUpdate = new Date(nowMs);
  post.bayesianScore = bayesianScore;

  await post.save();

  return { trendingScore, isRising, bayesianScore };
}

export default updatePostMetricsDB;
