import Comment from "../../models/commentModel.js";
import Post from "../../models/postModel.js";
import AppError from "../../utils/appError.js";

export const addCommentService = async (userId, postId, text) => {
  const post = await Post.findById(postId);
  if (!post) throw new AppError("post not found", 404);

  const comment = await Comment.create({ author: userId, post: postId, text });
  await Post.findByIdAndUpdate(postId, { $push: { comments: comment._id } });
  return comment;
};

export const deleteCommentService = async (userId, postId, commentId) => {
  const comment = await Comment.findById(commentId);
  if (!comment) throw new AppError("comment not found", 404);

  const post = await Post.findById(postId);
  if (!post) throw new AppError("Post not found", 404);

  if (!userId.equals(comment.author)) {
    throw new AppError("you don't have permission to do this action", 401);
  }

  await Comment.findByIdAndDelete(commentId);
  post.comments.pull(commentId);
  await post.save();
};
