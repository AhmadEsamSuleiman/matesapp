import Joi from "joi";

export const createPostSchema = Joi.object({
  text: Joi.string().required(),
  image: Joi.string().allow(""),
  category: Joi.string().required(),
  subCategory: Joi.string().allow(""),
});

export const postIdParamSchema = Joi.object({
  postId: Joi.string().required(),
});
