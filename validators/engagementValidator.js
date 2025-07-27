import Joi from "joi";

export const engagementSchema = Joi.object({
  postId: Joi.string().required(),
  viewed: Joi.number().integer().min(0).max(1).default(0),
  completed: Joi.number().integer().min(0).max(1).default(0),
  liked: Joi.number().integer().min(0).max(1).default(0),
  commented: Joi.number().integer().min(0).max(1).default(0),
  shared: Joi.number().integer().min(0).max(1).default(0),
  followed: Joi.number().integer().min(0).max(1).default(0),
});

export const skipSchema = Joi.object({
  postId: Joi.string().required(),
});
