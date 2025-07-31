import User from "../../models/userModel.js";
import Post from "../../models/postModel.js";
import AppError from "../../utils/appError.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

export const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
    ),
    httpOnly: true,
  };
  res.cookie("jwt", token, cookieOptions);
  res.status(statusCode).json({
    status: "success",
    token,
    data: { user },
  });
};

export const followUnFollowService = async (userId, targetId) => {
  const to = await User.findById(targetId);
  if (!to)
    throw new AppError(
      "the user you are trying to follow/unfollow doesnt exist",
      404
    );
  if (userId.equals(to._id))
    throw new AppError("you cant follow/unfollow yourself", 403);

  let action;
  const user = await User.findById(userId);

  if (user.following.some((f) => f.userId.toString() === to._id.toString())) {
    await User.findByIdAndUpdate(userId, {
      $pull: { following: { userId: to._id } },
    });
    await User.findByIdAndUpdate(to._id, { $pull: { followers: userId } });
    action = "unfollowed";
  } else {
    await User.findByIdAndUpdate(userId, {
      $addToSet: { following: { userId: to._id } },
    });
    await User.findByIdAndUpdate(to._id, { $addToSet: { followers: userId } });
    action = "followed";
  }

  return { to, action };
};

export const getUserPostsService = async (userId, page = 1, limit = 15) => {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404);

  const skip = (page - 1) * limit;
  const posts = await Post.find({ creator: userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  return { posts, page, results: posts.length };
};

export const updateMeService = async (userId, updates) => {
  const updatedUser = await User.findByIdAndUpdate(userId, updates, {
    new: true,
    runValidators: true,
    context: "query",
  }).select("-password");
  if (!updatedUser) throw new AppError("User not found", 404);
  return updatedUser;
};

export const updateMyPasswordService = async (
  userId,
  currentPassword,
  newPassword,
  newPasswordConfirm
) => {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError("User not found", 404);

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new AppError("Your current password is incorrect", 400);

  if (newPassword !== newPasswordConfirm)
    throw new AppError("newPassword and confirm do not match", 400);

  user.password = newPassword;
  user.passwordConfirm = newPasswordConfirm;
  await user.save();

  return user;
};
