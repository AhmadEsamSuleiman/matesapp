import mongoose from "mongoose";
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

const generateFeed = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user._id).lean();
  if (!user) throw new AppError("User not found", 404);

  const sessionData = isEnabled() ? (await getSessionData(req.sessionId)) || {} : {};

  const nowMs = Date.now();
  const seenPostIds = makeSeenSet(user);

  const { categoryPools, creatorPools } = buildInterestPools(user, sessionData);

  const skippedCreators = (creatorPools.skipped || [])
    .map((c) => c.creatorId)
    .filter(Boolean)
    .map((id) => new mongoose.Types.ObjectId(id));

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
    watchedCreator,
  );

  const allCreatorIds = [
    ...topCreators.map((c) => c.creatorId),
    ...risingCreators.map((c) => c.creatorId),
    ...extraTopCreators.map((c) => c.creatorId),
    ...extraRisingCreators.map((c) => c.creatorId),
    ...topFollowed.map((c) => c.creatorId),
    ...extraFollowed.map((c) => c.creatorId),
    ...reentryCreator.map((c) => c.creatorId),
    ...watchedCreator.map((c) => c.creatorId),
  ].filter(Boolean);

  const candidatePosts = await batchFetchPosts(
    topCats,
    risingCats,
    extraTopCats,
    extraRisingCats,
    allCreatorIds,
    seenPostIds,
    creatorBucketMap,
    categoryBucketMap,
    skippedCreators,
  );

  const { risingPosts, trendingPosts, recentPosts, evergreenPosts } = await fetchGeneralPools(seenPostIds, nowMs, skippedCreators);

  candidatePosts.push(...risingPosts, ...trendingPosts, ...recentPosts, ...evergreenPosts);

  const scoredPosts = await scorePosts(candidatePosts, categoryPools, creatorPools, nowMs);

  const finalFeed = await assembleFeed(scoredPosts, seenPostIds);

  const formattedFeed = await formatFeedPosts(finalFeed, user);

  res.status(200).json({ status: "success", data: { posts: formattedFeed } });
});

export default generateFeed;
