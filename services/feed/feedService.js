import Post from "../../models/postModel.js";
import User from "../../models/userModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";
import {
  fetchCandidates,
  fetchRandom,
  pickRandom,
  sampleCategory,
} from "../../utils/feedHelpers.js";
import { interleaveByBucket } from "../../utils/interleaveByBucket.js";
import { FEED_SIZE, RECENT_WINDOW_MS } from "../../constants/feedConstants.js";
import {
  INTEREST_WEIGHT,
  CREATOR_WEIGHT,
  TREND_WEIGHT,
  RAW_WEIGHT,
  PERSONAL_WEIGHT,
  HALF_LIFE_DAYS,
  MS_PER_DAY,
  BAYESIAN_WEIGHT,
} from "../../constants/scoringConfig.js";

// 1. Build and sort pools
export const buildInterestPools = (user, sessionData) => ({
  categoryPools: {
    top: [...(sessionData.topCategories || user.topInterests || [])].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0)
    ),
    rising: [
      ...(sessionData.risingCategories || user.risingInterests || []),
    ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
  },
  creatorPools: {
    top: [
      ...(sessionData.topCreators || user.creatorsInterests.topCreators || []),
    ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    rising: [
      ...(sessionData.risingCreators ||
        user.creatorsInterests.risingCreators ||
        []),
    ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    followed: [...(sessionData.followedCreators || user.following || [])].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0)
    ),
    skipped:
      sessionData.skippedCreators ||
      user.creatorsInterests.skippedCreatorsPool ||
      [],
    watched:
      sessionData.watchedCreators ||
      user.creatorsInterests.watchedCreatorsPool ||
      [],
  },
});

// 2. Candidate selection (top/rising/extra)
export const selectCandidates = (categoryPools, creatorPools, nowMs) => {
  // Categories
  const topCats = categoryPools.top.slice(0, 3);
  const risingCats = categoryPools.rising.slice(0, 2);
  const extraTopCats = pickRandom(categoryPools.top.slice(3), 1);
  const extraRisingCats = pickRandom(categoryPools.rising.slice(2), 1);

  // Creators
  const topCreators = creatorPools.top.slice(0, 4);
  const risingCreators = creatorPools.rising.slice(0, 2);
  const extraTopCreators = pickRandom(creatorPools.top.slice(4), 1);
  const extraRisingCreators = pickRandom(creatorPools.rising.slice(2), 1);
  const topFollowed = creatorPools.followed.slice(0, 3);
  const extraFollowed = pickRandom(creatorPools.followed.slice(3), 2);

  // Skipped/watched creators (probabilistic)
  const readyToReenter = creatorPools.skipped
    .filter((e) => e.reentryAt <= nowMs)
    .map((e) => e.creatorId);

  const reentryCreator =
    Math.random() < 0.4 && readyToReenter.length
      ? pickRandom(readyToReenter, 1)
      : [];

  const watchedCreator =
    Math.random() < 0.4 && creatorPools.watched.length
      ? pickRandom(creatorPools.watched, 1)
      : [];

  return {
    topCats,
    risingCats,
    extraTopCats,
    extraRisingCats,
    topCreators,
    risingCreators,
    extraTopCreators,
    extraRisingCreators,
    topFollowed,
    extraFollowed,
    reentryCreator,
    watchedCreator,
  };
};

// 3. Build bucket maps
export const buildBucketMaps = (
  topCats,
  risingCats,
  extraTopCats,
  extraRisingCats,
  topCreators,
  risingCreators,
  extraTopCreators,
  extraRisingCreators,
  topFollowed,
  extraFollowed,
  reentryCreator,
  watchedCreator
) => {
  const categoryBucketMap = {};
  topCats.forEach((cat) => (categoryBucketMap[cat.name] = "CAT:TOP"));
  risingCats.forEach((cat) => (categoryBucketMap[cat.name] = "CAT:RISING"));
  extraTopCats.forEach((cat) => (categoryBucketMap[cat.name] = "CAT:EXTRA"));
  extraRisingCats.forEach((cat) => (categoryBucketMap[cat.name] = "CAT:EXTRA"));

  const creatorBucketMap = {};
  topCreators.forEach((c) => (creatorBucketMap[c.creatorId] = "CREATOR:TOP"));
  risingCreators.forEach(
    (c) => (creatorBucketMap[c.creatorId] = "CREATOR:RISING")
  );
  extraTopCreators.forEach(
    (c) => (creatorBucketMap[c.creatorId] = "CREATOR:EXTRA")
  );
  extraRisingCreators.forEach(
    (c) => (creatorBucketMap[c.creatorId] = "CREATOR:EXTRA")
  );
  topFollowed.forEach(
    (c) => (creatorBucketMap[c.creatorId] = "CREATOR:FOLLOWED")
  );
  extraFollowed.forEach(
    (c) => (creatorBucketMap[c.creatorId] = "CREATOR:FOLLOWED")
  );
  reentryCreator.forEach((id) => (creatorBucketMap[id] = "SKIP_REENTRY"));
  watchedCreator.forEach((id) => (creatorBucketMap[id] = "WATCHED"));

  return { categoryBucketMap, creatorBucketMap };
};

// 4. Batch fetch posts for creators/categories
export const batchFetchPosts = async (
  topCats,
  risingCats,
  extraTopCats,
  extraRisingCats,
  allCreatorIds,
  seenPostIds,
  creatorBucketMap,
  categoryBucketMap
) => {
  const candidatePosts = [];

  // Use sampleCategory for category-based sampling
  for (const catObj of [
    ...topCats,
    ...risingCats,
    ...extraTopCats,
    ...extraRisingCats,
  ]) {
    const posts = await sampleCategory(catObj, seenPostIds);
    posts.forEach((post) => {
      post.bucket = categoryBucketMap[catObj.name] || "UNKNOWN";
      candidatePosts.push(post);
      seenPostIds.add(post._id.toString());
    });
  }

  // Fetch posts for all selected creators
  let creatorPosts = [];
  if (allCreatorIds.length) {
    creatorPosts = await fetchCandidates({
      filter: {
        _id: { $nin: [...seenPostIds] },
        creator: { $in: allCreatorIds },
      },
      sort: { trendingScore: -1, createdAt: -1 },
      topLimit: 20,
      rndLimit: 10,
      bucket: "CREATOR:MIXED",
    });
    creatorPosts.forEach((post) => {
      post.bucket = creatorBucketMap[post.creator.toString()] || "UNKNOWN";
      seenPostIds.add(post._id.toString());
    });
    candidatePosts.push(...creatorPosts);
  }

  return candidatePosts;
};

// 5. Fetch general pools (rising, trending, recent, evergreen)
export const fetchGeneralPools = async (seenPostIds, nowMs) => {
  const risingPosts = await fetchCandidates({
    filter: {
      _id: { $nin: [...seenPostIds] },
      isRising: true,
      isEvergreen: false,
    },
    sort: { trendingScore: -1, createdAt: -1 },
    topLimit: 4,
    rndLimit: 2,
    bucket: "RISING",
  });

  const trendingPosts = await fetchCandidates({
    filter: { _id: { $nin: [...seenPostIds] }, isEvergreen: false },
    sort: { trendingScore: -1, createdAt: -1 },
    topLimit: 8,
    rndLimit: 4,
    bucket: "TRENDING",
  });

  const recentPosts = await fetchCandidates({
    filter: {
      _id: { $nin: [...seenPostIds] },
      createdAt: { $gte: new Date(nowMs - RECENT_WINDOW_MS) },
    },
    sort: { bayesianScore: -1, createdAt: -1 },
    topLimit: 8,
    rndLimit: 4,
    bucket: "RECENT",
  });

  const evergreenPosts = await fetchCandidates({
    filter: { _id: { $nin: [...seenPostIds] }, isEvergreen: true },
    sort: { bayesianScore: -1, createdAt: -1 },
    topLimit: 8,
    rndLimit: 4,
    bucket: "EVERGREEN",
  });

  return { risingPosts, trendingPosts, recentPosts, evergreenPosts };
};

// 6. Score posts
export const scorePosts = async (
  candidatePosts,
  categoryPools,
  creatorPools,
  nowMs
) => {
  return Promise.all(
    candidatePosts.map(async (post) => {
      const globalCat = await GlobalStats.findOne({
        entityType: "category",
        name: post.category,
      });
      const avgCatEng = globalCat?.impressionCount
        ? globalCat.totalEngagement / globalCat.impressionCount
        : 0;

      const globalCre = await CreatorStats.findOne({
        creatorId: post.creator.toString(),
      });
      const avgCreEng = globalCre?.impressionCount
        ? globalCre.totalEngagement / globalCre.impressionCount
        : avgCatEng;

      const categoryNode =
        categoryPools.top.find((c) => c.name === post.category) ??
        categoryPools.rising.find((c) => c.name === post.category);

      const interestScore = categoryNode?.score ?? 0.1 * avgCatEng;

      const creatorNode =
        creatorPools.top.find(
          (c) => c.creatorId.toString() === post.creator.toString()
        ) ??
        creatorPools.rising.find(
          (c) => c.creatorId.toString() === post.creator.toString()
        );

      const creatorScore = creatorNode?.score ?? 0.1 * avgCreEng;

      const ageInDays = (nowMs - new Date(post.createdAt)) / MS_PER_DAY;
      const timeDecay = Math.exp((-Math.log(2) / HALF_LIFE_DAYS) * ageInDays);

      post.compositeScore =
        PERSONAL_WEIGHT *
          timeDecay *
          (INTEREST_WEIGHT * interestScore + CREATOR_WEIGHT * creatorScore) +
        RAW_WEIGHT * (post.rawScore || 0) +
        TREND_WEIGHT * (post.trendingScore || 0) +
        BAYESIAN_WEIGHT * (post.bayesianScore || 0);

      return post;
    })
  );
};

// 7. Assemble feed (interleave and fill with explore)
export const assembleFeed = async (
  scoredPosts,
  seenPostIds,
  fetchRandomFn = fetchRandom
) => {
  const NON_EXPLORE = 15;
  const coreFeed = interleaveByBucket(scoredPosts, NON_EXPLORE);

  const need = FEED_SIZE - coreFeed.length;
  const explore =
    need > 0
      ? await fetchRandomFn({
          filter: { _id: { $nin: [...seenPostIds] } },
          limit: need,
          bucket: "EXPLORE",
        })
      : [];

  return [...coreFeed, ...explore];
};

export async function formatFeedPosts(posts, currentUser) {
  // Populate creator fields for all posts
  const populatedPosts = await Post.populate(posts, {
    path: "creator",
    select: "userName profilePicture",
    model: User,
  });

  // Get IDs of users the current user follows
  const followedIds = new Set(
    (currentUser.following || []).map((f) => f.userId?.toString())
  );

  // Format posts
  return populatedPosts.map((post) => {
    const creatorId = post.creator?._id?.toString() || post.creator?.toString();
    return {
      _id: post._id,
      text: post.text,
      image: post.image,
      category: post.category,
      subCategory: post.subCategory,
      specific: post.specific,
      bucket: post.bucket,
      score: post.overallScore,
      bayesianScore: post.bayesianScore,
      historicalVelocityEMA: post.historicalVelocityEMA,
      shortTermVelocityEMA: post.shortTermVelocityEMA,
      trendingScore: post.trendingScore,
      isRising: !!post.isRising,
      isEvergreen: !!post.isEvergreen,
      createdAt: post.createdAt,
      creator: {
        _id: creatorId,
        userName: post.creator?.userName,
        profilePicture: post.creator?.profilePicture,
        isFollowed: followedIds.has(creatorId),
      },
    };
  });
}
