/**
 * @file controllers/feedController.js
 * @description This controller is responsible for generating a personalized content feed for a logged-in user.
 * It orchestrates multiple data sources and algorithms to select, score, and interleave posts,
 * aiming to provide a relevant and engaging experience.
 * @requires ../utils/feedHelpers - functions for fetching and processing post data.
 * @requires ../services/feed/feedService - functions to manage feed generation.
 * @requires ../utils/isRedisEnabled - Utility to check if Redis is enabled.
 * @requires ../session/sessionHelpers - Helpers for interacting with session data (e.g., Redis).
 * @requires ../constants/scoringConfig - Configuration constants for post scoring.
 * @requires ../utils/interleaveByBucket - Utility for interleaving posts from different buckets.
 * @requires ../constants/feedConstants - Configuration constants for feed generation.
 */

import User from "../models/userModel.js";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import isEnabled from "../utils/isRedisEnabled.js";
import { getSessionData } from "../session/sessionHelpers.js";
import { makeSeenSet } from "../utils/feedHelpers.js";
import {
  buildInterestPools,
  selectCandidates,
  buildBucketMaps,
  batchFetchPosts,
  fetchGeneralPools,
  scorePosts,
  assembleFeed,
  formatFeedPosts,
} from "../services/feed/feedService.js";

export const generateFeed = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id).lean();
  if (!user) throw new AppError("User not found", 404);

  const sessionData = isEnabled()
    ? (await getSessionData(req.sessionId)) || {}
    : {};

  const nowMs = Date.now();
  const seenPostIds = makeSeenSet(user);

  // 1. Build pools
  const { categoryPools, creatorPools } = buildInterestPools(user, sessionData);

  // 2. Select candidates
  const {
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
  } = selectCandidates(categoryPools, creatorPools, nowMs);

  // 3. Build bucket maps
  const { categoryBucketMap, creatorBucketMap } = buildBucketMaps(
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
  );

  // 4. Collect all creator IDs
  const allCreatorIds = [
    ...topCreators.map((c) => c.creatorId),
    ...risingCreators.map((c) => c.creatorId),
    ...extraTopCreators.map((c) => c.creatorId),
    ...extraRisingCreators.map((c) => c.creatorId),
    ...topFollowed.map((c) => c.creatorId),
    ...extraFollowed.map((c) => c.creatorId),
    ...reentryCreator,
    ...watchedCreator,
  ].filter(Boolean);

  // 5. Batch fetch posts (uses sampleCategory for categories)
  const candidatePosts = await batchFetchPosts(
    topCats,
    risingCats,
    extraTopCats,
    extraRisingCats,
    allCreatorIds,
    seenPostIds,
    creatorBucketMap,
    categoryBucketMap
  );

  // 6. General pools
  const { risingPosts, trendingPosts, recentPosts, evergreenPosts } =
    await fetchGeneralPools(seenPostIds, nowMs);

  candidatePosts.push(
    ...risingPosts,
    ...trendingPosts,
    ...recentPosts,
    ...evergreenPosts
  );

  // 7. Score posts
  const scoredPosts = await scorePosts(
    candidatePosts,
    categoryPools,
    creatorPools,
    nowMs
  );

  // 8. Assemble feed
  const finalFeed = await assembleFeed(scoredPosts, seenPostIds);

  const formattedFeed = await formatFeedPosts(finalFeed, user);

  res.status(200).json({ status: "success", data: { posts: formattedFeed } });
});
