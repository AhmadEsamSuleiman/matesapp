import Joi from "joi";

export const addCommentSchema = Joi.object({
  text: Joi.string().trim().min(1).required(),
});
