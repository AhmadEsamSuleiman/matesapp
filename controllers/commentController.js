import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import {
  addCommentService,
  deleteCommentService,
} from "../services/comment/commentService.js";
import { addCommentSchema } from "../validators/commentValidator.js";

export const addComment = catchAsync(async (req, res, next) => {
  const { error, value } = addCommentSchema.validate(req.body);
  if (error) return next(new AppError(error.details[0].message, 400));
  const comment = await addCommentService(
    req.user._id,
    req.params.postId,
    value.text
  );
  res.status(201).json({ status: "success", comment });
});

export const deleteComment = catchAsync(async (req, res, next) => {
  await deleteCommentService(
    req.user._id,
    req.params.postId,
    req.params.commentId
  );
  res.status(204).json({
    status: "success",
    message: "comment deleted",
  });
});
