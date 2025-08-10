import Joi from "joi";

const addCommentSchema = Joi.object({
  text: Joi.string().trim().min(1).required(),
});

export default addCommentSchema;
