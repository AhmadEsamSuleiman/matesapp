import Joi from "joi";

export const userIdParamSchema = Joi.object({
  id: Joi.string().required(),
});

export const updateMeSchema = Joi.object({
  userName: Joi.string().min(2).max(32),
  bio: Joi.string().max(256),
});

export const updatePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
  newPasswordConfirm: Joi.string().valid(Joi.ref("newPassword")).required(),
});
