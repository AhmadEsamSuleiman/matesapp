import Post from "../models/textPostModel.js";
import GlobalStats from "../models/globalStatsModel.js"; // CHANGED: reuse GlobalStats
import CreatorStats from "../models/creatorStatsModel.js";
import { rawPostScore } from "./postScoringBase.js"; // existing rawPostScore
import { HALF_LIFE_DAYS, MS_PER_DAY } from "./postConstants - deprecated.js";
// import { choosePriorCount } from "../utils/smoothingUtils.js"; // optional if needed

/**
 * computePostScoreDB:
 *   - postDoc: Mongoose document or plain object with fields:
 *       _id, creator, category, createdAt, impressionCount, engagementSum
 *   - Uses GlobalStats for:
 *       entityType: "postCategory", name: postDoc.category
 *       entityType: "creator",     name: postDoc.creator.toString()
 *   - Performs time-varying Bayesian smoothing:
 *       priorMean = blend(creatorAvg, categoryAvg)
 *       priorCount decays exponentially with post age
 *       smoothedAvg = (priorMean * priorCount + observedSum) / (priorCount + observedCount)
 *       finalScore = smoothedAvg * timeDecayFactor
 *   - Returns finalScore (Number).
 */
export async function computePostScoreDB(postDoc) {
  const now = Date.now();
  const createdAtMs = new Date(postDoc.createdAt).getTime();
  const ageMs = now - createdAtMs;
  const ageHours = ageMs / (1000 * 3600);
  const ageDays = ageMs / MS_PER_DAY;

  // 1) Fetch or initialize post-category stats
  const categoryName = postDoc.category;
  let categoryStats = await GlobalStats.findOne({
    entityType: "category",
    name: categoryName,
  });
  if (!categoryStats) {
    categoryStats = await GlobalStats.create({
      entityType: "category",
      name: categoryName,
      impressionCount: 0,
      totalEngagement: 0,
    });
  }
  const globalImpressionCount = categoryStats.impressionCount;
  const globalTotalEngagement = categoryStats.totalEngagement;
  const categoryAvg =
    globalImpressionCount > 0
      ? globalTotalEngagement / globalImpressionCount
      : 0;

  // 2) Fetch or initialize creator stats
  const creatorIdStr = postDoc.creator.toString();
  let creatorStats = await CreatorStats.findOne({
    creatorId: creatorIdStr,
  });
  if (!creatorStats) {
    creatorStats = await CreatorStats.create({
      creatorId: creatorIdStr,
      impressionCount: 0,
      totalEngagement: 0,
    });
  }
  const creatorImpressionCount = creatorStats.impressionCount;
  const creatorTotalEngagement = creatorStats.totalEngagement;
  const creatorAvg =
    creatorImpressionCount > 0
      ? creatorTotalEngagement / creatorImpressionCount
      : categoryAvg;

  // 3) Blend priorMean
  const wCreator = 0.5; // TUNE: weight for creator vs category baseline
  const priorMean = creatorAvg * wCreator + categoryAvg * (1 - wCreator);

  // 4) Compute time-varying priorCount
  const initialPriorCount = 50; // TUNE: initial prior strength
  const priorHalfLifeHours = 1; // TUNE: half-life for prior influence in hours
  const priorCountRaw =
    initialPriorCount *
    Math.exp((-Math.log(2) * ageHours) / priorHalfLifeHours);
  const minPriorCount = 1;
  const priorCount = Math.max(priorCountRaw, minPriorCount);

  // 5) Observed data from postDoc
  const observedCount = postDoc.impressionCount || 0;
  const observedSum = postDoc.engagementSum || 0;

  // 6) Bayesian-smoothed average engagement per impression
  const smoothedAvg =
    (priorMean * priorCount + observedSum) / (priorCount + observedCount);

  // 7) Time decay for older posts
  const timeDecayLambda = Math.log(2) / HALF_LIFE_DAYS;
  const timeDecayFactor = Math.exp(-timeDecayLambda * ageDays);

  const finalScore = smoothedAvg * timeDecayFactor;
  return finalScore;
}
