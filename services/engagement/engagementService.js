import Post from "../../models/postModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import User from "../../models/userModel.js";
import AppError from "../../utils/appError.js";

export const updateEngagementStatsService = async ({ postId, userId, category, subCategory, creator, engagementScore }) => {
  await Post.findByIdAndUpdate(postId, {
    $inc: { impressionCount: 1, engagementSum: engagementScore },
  });

  await GlobalStats.findOneAndUpdate(
    { entityType: "category", name: category },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true },
  );

  await UserInterestStats.findOneAndUpdate(
    { userId, entityType: "category", name: category },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true },
  );

  await CreatorStats.findOneAndUpdate(
    { creatorId: creator._id.toString() },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true },
  );

  if (subCategory) {
    await GlobalStats.findOneAndUpdate(
      { entityType: "subcategory", name: subCategory },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true },
    );

    await UserInterestStats.findOneAndUpdate(
      { userId, entityType: "subcategory", name: subCategory },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true },
    );
  }
};

export const markPostSeenService = async (userId, postId) => {
  await User.findByIdAndUpdate(userId, { $addToSet: { seenPosts: postId } });
};

export const getPostAndUserService = async (postId, userId) => {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("Post not found", 404);

  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  return { post, user };
};
