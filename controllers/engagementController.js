/**
 * This controller is responsible for processing user engagement and skip actions related to posts.
 * It serves as the primary entry point for capturing user signals that drive the recommendation engine.
 *
 * It orchestrates updates to both persistent (MongoDB) and real-time (Redis)
 * user interest profiles, as well as global and creator-specific statistics.
 * The controller routes requests to either the Redis-based or
 * database-based service layers depending on the `isRedisEnabled` flag,
 * ensuring high performance for active sessions and reliable persistence for
 * long-term user preferences.
 *
 * Key functionalities include:
 * - Validating incoming engagement/skip data.
 * - Calculating an aggregate engagement score from various user actions (view, like, comment, etc.).
 * - Updating `seenPosts` for the user to prevent repeated recommendations of already consumed content.
 * - Incrementing impression and engagement counts in `Post`, `GlobalStats`, `UserInterestStats`,
 * and `CreatorStats` collections in MongoDB for long-term trend tracking.
 * - Delegating to `interestServiceDB` / `interestServiceRedis` and
 * `creatorServiceDB` / `creatorServiceRedis` to update granular user interest scores
 * for categories, subcategories, specific topics, and individual creators.
 * - Updating `PostMetricsDB` for post-specific engagement metrics.
 *
 * This controller is vital for the feedback loop of the recommendation system,
 * ensuring that user interactions directly influence future content delivery.
 *
 * @requires ../services/engagementService.js - Functions for managing engagement.
 * @requires ../services/interestServiceDB.js - Functions for updating user interest data in MongoDB.
 * @requires ../services/creatorServiceDB.js - Functions for updating user creator interest data in MongoDB.
 * @requires ../services/interestServiceRedis.js - Functions for updating user interest data in Redis.
 * @requires ../services/creatorServiceRedis.js - Functions for updating user creator interest data in Redis.
 * @requires ../utils/isRedisEnabled.js - Utility to check if Redis is enabled for real-time operations.
 * @requires ../models/globalStatsModel.js - Mongoose model for global statistics.
 * @requires ../models/creatorStatsModel.js - Mongoose model for creator-specific statistics.
 * @requires ../models/userInterestStatsModel.js - Mongoose model for user-specific interest statistics.
 * @requires ../services/postMetricsService.js - Functions for updating post-level engagement metrics.
 * @requires ../constants/scoringConfig.js - Defines engagement scoring weights.
 */

import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import {
  engagementSchema,
  skipSchema,
} from "../validators/engagementValidator.js";
import {
  updateEngagementStatsService,
  markPostSeenService,
  getPostAndUserService,
} from "../services/engagement/engagementService.js";
import {
  scoreInterestDB,
  skipInterestDB,
} from "../services/interest/interestServiceDB.js";
import {
  scoreCreatorDB,
  skipCreatorDB,
} from "../services/creator/creatorServiceDB.js";
import {
  scoreInterestRedis,
  skipInterestRedis,
} from "../services/interest/interestServiceRedis.js";
import {
  scoreCreatorRedis,
  skipCreatorRedis,
} from "../services/creator/creatorServiceRedis.js";
import isEnabled from "../utils/isRedisEnabled.js";
import { updatePostMetricsDB } from "../services/post/postMetricsService.js";
import { WEIGHTS } from "../constants/scoringConfig.js";

export const calculateEngagement = catchAsync(async (req, res, next) => {
  const { error, value } = engagementSchema.validate(req.body.engagement);
  if (error) return next(new AppError(error.details[0].message, 400));

  const {
    postId,
    viewed = 0,
    completed = 0,
    liked = 0,
    commented = 0,
    shared = 0,
    followed = 0,
  } = value;

  const userId = req.user._id;
  const { post, user } = await getPostAndUserService(postId, userId);
  const { category, subCategory, specific, creator } = post;

  await markPostSeenService(userId, postId);

  // Calculate engagement score
  const engagementScore =
    +viewed * WEIGHTS.view +
    +completed * WEIGHTS.completion +
    +liked * WEIGHTS.like +
    +commented * WEIGHTS.comment +
    +shared * WEIGHTS.share;

  // Update MongoDB stats
  await updateEngagementStatsService({
    postId,
    userId,
    category,
    subCategory,
    creator,
    engagementScore,
  });

  // Redis or MongoDB interest/creator updates
  if (isEnabled()) {
    const sessionId = req.sessionId;
    if (!sessionId) {
      console.warn("Redis mode enabled but no sessionId on request.");
    }
    const promises = [];
    try {
      promises.push(
        scoreInterestRedis(
          userId,
          sessionId,
          category,
          subCategory,
          specific,
          engagementScore
        )
      );
    } catch (err) {
      console.error("Error invoking scoreInterestRedis:", err);
    }
    try {
      promises.push(
        scoreCreatorRedis(userId, sessionId, creator._id, engagementScore)
      );
    } catch (err) {
      console.error("Error invoking scoreCreatorRedis:", err);
    }
    await Promise.all(promises);
  } else {
    await scoreInterestDB(userId, {
      categoryName: category,
      subName: subCategory,
      specificName: specific,
      engagementScore,
    });
    await scoreCreatorDB(userId, creator._id, engagementScore);
  }

  // Update post metrics
  await updatePostMetricsDB(
    postId,
    [
      "view",
      liked && "like",
      commented && "comment",
      shared && "share",
      followed && "follow",
    ].filter(Boolean)
  );

  res.status(200).json({ status: "success" });
});

export const calculateSkips = catchAsync(async (req, res, next) => {
  const { error, value } = skipSchema.validate(req.body.skip);
  if (error) return next(new AppError(error.details[0].message, 400));

  const { postId } = value;
  const userId = req.user._id;
  const { post, user } = await getPostAndUserService(postId, userId);
  const { category, subCategory, specific, creator } = post;

  await markPostSeenService(userId, postId);

  if (isEnabled()) {
    const sessionId = req.sessionId;
    if (!sessionId) {
      console.warn("Redis mode enabled but no sessionId on request.");
    }
    const promises = [];
    try {
      promises.push(
        skipInterestRedis(sessionId, category, subCategory, specific)
      );
    } catch (err) {
      console.error("Error invoking skipInterestRedis:", err);
    }
    try {
      promises.push(skipCreatorRedis(sessionId, creator._id.toString()));
    } catch (err) {
      console.error("Error invoking skipCreatorRedis:", err);
    }
    await Promise.all(promises);
  } else {
    await skipInterestDB(userId, {
      categoryName: category,
      subCategoryName: subCategory,
      specificName: specific,
    });
    await skipCreatorDB(userId, creator._id);
  }

  res.status(200).json({ status: "success" });
});
