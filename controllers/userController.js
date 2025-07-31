import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import {
  followUnFollowService,
  getUserPostsService,
  updateMeService,
  updateMyPasswordService,
  createSendToken,
} from "../services/user/userService.js";
import {
  userIdParamSchema,
  updateMeSchema,
  updatePasswordSchema,
} from "../validators/userValidator.js";
import {
  getSessionData,
  setSessionData,
  refreshUserSession,
} from "../session/sessionHelpers.js";

import isEnabled from "../utils/isRedisEnabled.js";

export const getMe = catchAsync(async (req, res, next) => {
  if (!req.user) {
    return next(new AppError("You are not logged in!", 401));
  }

  const { firstName, lastName, userName, email, bio, profilePicture } =
    req.user;

  res.status(200).json({
    status: "success",
    data: {
      user: { firstName, lastName, userName, email, bio, profilePicture },
    },
  });
});

export const followUnFollow = catchAsync(async (req, res, next) => {
  const { error } = userIdParamSchema.validate(req.params);
  if (error) return next(new AppError(error.details[0].message, 400));

  const userId = req.user._id;
  const targetId = req.params.id;
  const { to, action } = await followUnFollowService(userId, targetId);

  // Redis session logic
  if (isEnabled() && req.sessionId) {
    try {
      const sessionData = await getSessionData(req.sessionId);
      const creatorIdStr = to._id.toString();

      if (sessionData) {
        sessionData.followedCreators = sessionData.followedCreators || [];

        if (action === "followed") {
          const existingFollowInSession = sessionData.followedCreators.find(
            (f) => f.creatorId === creatorIdStr
          );
          if (!existingFollowInSession) {
            sessionData.followedCreators.push({
              creatorId: creatorIdStr,
              score: 0,
              lastUpdated: Date.now(),
              skips: 0,
              lastSkipAt: Date.now(),
            });
          } else {
            existingFollowInSession.lastUpdated = Date.now();
          }
        } else if (action === "unfollowed") {
          sessionData.followedCreators = sessionData.followedCreators.filter(
            (f) => f.creatorId !== creatorIdStr
          );
        }

        await setSessionData(req.sessionId, sessionData);
        await refreshUserSession(req.sessionId);
      } else {
        console.warn(
          `Redis session ${req.sessionId} not found for update during ${action}.`
        );
      }
    } catch (redisErr) {
      console.error(
        `Error updating Redis session for follow/unfollow (sessionId: ${req.sessionId}, creatorId: ${creatorIdStr}): ${redisErr.message}`
      );
    }
  }

  res.status(200).json({
    status: "success",
    message: `You have ${action} ${to.userName}`,
  });
});

export const getUserPosts = catchAsync(async (req, res, next) => {
  const { error } = userIdParamSchema.validate(req.params);
  if (error) return next(new AppError(error.details[0].message, 400));

  const page = parseInt(req.sanitizedQuery.page, 10) || 1;
  const { posts, results } = await getUserPostsService(req.params.id, page);

  res.status(200).json({
    status: "success",
    results,
    page,
    data: { posts },
  });
});

export const updateMe = catchAsync(async (req, res, next) => {
  if (req.body.password || req.body.passwordConfirm) {
    return next(
      new AppError(
        "This route is not for password updates. Please use /updateMyPassword",
        400
      )
    );
  }

  const { error, value } = updateMeSchema.validate(req.body);
  if (error) return next(new AppError(error.details[0].message, 400));

  const updatedUser = await updateMeService(req.user._id, value);

  res.status(200).json({
    status: "success",
    data: { user: updatedUser },
  });
});

export const updateMyPassword = catchAsync(async (req, res, next) => {
  const { error, value } = updatePasswordSchema.validate(req.body);
  if (error) return next(new AppError(error.details[0].message, 400));

  const user = await updateMyPasswordService(
    req.user._id,
    value.currentPassword,
    value.newPassword,
    value.newPasswordConfirm
  );

  createSendToken(user, 200, res);
});
