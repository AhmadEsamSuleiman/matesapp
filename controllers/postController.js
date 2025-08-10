import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import {
  createPostService,
  getPostService,
  getPostCommentsService,
  toggleLikeService,
  deletePostService,
} from "../services/post/postService.js";
import { createPostSchema, postIdParamSchema } from "../validators/postValidator.js";

export const createPost = catchAsync(async (req, res, next) => {
  const { error, value } = createPostSchema.validate(req.body);

  if (error) return next(new AppError(error.details[0].message, 400));

  const post = await createPostService(req.user._id, value);

  res.status(201).json({
    status: "success",
    data: {
      message: "post created",
      post,
    },
  });
});

export const getPost = catchAsync(async (req, res, next) => {
  const { error } = postIdParamSchema.validate(req.params);

  if (error) return next(new AppError(error.details[0].message, 400));

  const post = await getPostService(req.params.postId);

  res.status(200).json({
    status: "success",
    data: post,
  });
});

export const getPostComments = catchAsync(async (req, res, next) => {
  const { postId } = req.params;
  const page = parseInt(req.sanitizedQuery.page, 10) || 1;
  const limit = parseInt(req.sanitizedQuery.limit, 10) || 20;

  const result = await getPostCommentsService(postId, page, limit);

  res.status(200).json({
    status: "success",
    ...result,
  });
});

export const toggleLike = catchAsync(async (req, res, next) => {
  const { error } = postIdParamSchema.validate(req.params);

  if (error) return next(new AppError(error.details[0].message, 400));

  const result = await toggleLikeService(req.user._id, req.params.postId);

  res.status(200).json(result);
});

export const deletePost = catchAsync(async (req, res, next) => {
  const { error } = postIdParamSchema.validate(req.params);

  if (error) return next(new AppError(error.details[0].message, 400));

  await deletePostService(req.user._id, req.params.postId);

  res.status(204).json({
    status: "success",
    message: "post deleted",
  });
});
