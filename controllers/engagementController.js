import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import { engagementSchema, skipSchema } from "../validators/engagementValidator.js";
import { markPostSeenService, getPostAndUserService } from "../services/engagement/engagementService.js";
import { scoreInterestDB, skipInterestDB } from "../services/interest/interestServiceDB.js";
import { scoreCreatorDB, skipCreatorDB } from "../services/creator/creatorServiceDB.js";
import { scoreInterestRedis, skipInterestRedis } from "../services/interest/interestServiceRedis.js";
import { scoreCreatorRedis, skipCreatorRedis } from "../services/creator/creatorServiceRedis.js";
import publishScoreEvent from "../kafka/producers/scoreProducer.js";
import publishEngagementEvent from "../kafka/producers/engagementProducer.js";
import isEnabled from "../utils/isRedisEnabled.js";
import { WEIGHTS } from "../constants/scoringConfig.js";

export const calculateEngagement = catchAsync(async (req, res, next) => {
  const { error, value } = engagementSchema.validate(req.body.engagement);
  if (error) return next(new AppError(error.details[0].message, 400));

  const { postId, viewed = 0, completed = 0, liked = 0, commented = 0, shared = 0 } = value;

  const userId = req.user._id;
  const { post } = await getPostAndUserService(postId, userId);
  const { category, subCategory, specific, creator } = post;

  await markPostSeenService(userId, postId);

  const engagementScore =
    +viewed * WEIGHTS.view +
    +completed * WEIGHTS.completion +
    +liked * WEIGHTS.like +
    +commented * WEIGHTS.comment +
    +shared * WEIGHTS.share;

  const engagementEvent = {
    postId: postId.toString(),
    userId: userId.toString(),
    category,
    subCategory,
    creatorId: creator._id.toString(),
    engagementScore,
  };
  await publishEngagementEvent(engagementEvent);

  if (isEnabled()) {
    const { sessionId } = req;
    if (!sessionId) console.warn("Redis enabled but no sessionId.");

    await scoreInterestRedis(userId, sessionId, category, subCategory, specific, engagementScore);

    await scoreCreatorRedis(userId, sessionId, creator._id, engagementScore);
  } else {
    await scoreInterestDB(userId, {
      categoryName: category,
      subName: subCategory,
      specificName: specific,
      engagementScore,
    });
    await scoreCreatorDB(userId, creator._id, engagementScore);
  }

  await publishScoreEvent({
    postId: postId.toString(),
    userId: userId.toString(),
    engagementType: "engagement",
    scoreDelta: engagementScore,
    timestamp: new Date().toISOString(),
  });

  res.status(200).json({ status: "success" });
});

export const calculateSkips = catchAsync(async (req, res, next) => {
  const { error, value } = skipSchema.validate(req.body.skip);
  if (error) return next(new AppError(error.details[0].message, 400));

  const { postId } = value;
  const userId = req.user._id;
  const { post } = await getPostAndUserService(postId, userId);
  const { category, subCategory, specific, creator } = post;

  await markPostSeenService(userId, postId);

  if (isEnabled()) {
    const { sessionId } = req;
    if (!sessionId) console.warn("Redis enabled but no sessionId.");
    await Promise.all([skipInterestRedis(sessionId, category, subCategory, specific), skipCreatorRedis(sessionId, creator._id.toString())]);
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
