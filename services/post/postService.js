import Post from "../../models/postModel.js";
import Comment from "../../models/commentModel.js";
import AppError from "../../utils/appError.js";

export const createPostService = async (userId, postData) => {
  return await Post.create({
    creator: userId,
    ...postData,
  });
};

export const getPostService = async (postId) => {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("post not found", 404);
  return post;
};

export const getPostCommentsService = async (postId, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;

  const comments = await Comment.find({ post: postId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Comment.countDocuments({ post: postId });

  return {
    comments,
    total,
    page,
    results: comments.length,
  };
};

export const toggleLikeService = async (userId, postId) => {
  const post = await Post.findById(postId, "likes");
  if (!post) throw new AppError("Post not found", 404);

  const alreadyLiked = post.likes.includes(userId);

  const updateOp = alreadyLiked
    ? { $pull: { likes: userId } }
    : { $addToSet: { likes: userId } };

  const updated = await Post.findByIdAndUpdate(postId, updateOp, {
    new: true,
    select: "likes",
  });

  return {
    liked: !alreadyLiked,
    totalLikes: updated.likes.length,
    likes: updated.likes,
  };
};

export const deletePostService = async (userId, postId) => {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("post not found", 404);

  if (!userId.equals(post.creator)) {
    throw new AppError("you don't have permission to do this action", 401);
  }

  await Comment.deleteMany({ post: post._id });

  await Post.findByIdAndDelete(post._id);
  return true;
};
