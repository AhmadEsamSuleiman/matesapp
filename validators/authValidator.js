import Joi from "joi";

export const loginSchema = Joi.object({
  userName: Joi.string(),
  email: Joi.string().email(),
  password: Joi.string().required(),
}).or("userName", "email");

export const signUpSchema = Joi.object({
  firstName: Joi.string().required().messages({
    "any.required": "First name is required.",
    "string.empty": "First name cannot be empty.",
  }),
  lastName: Joi.string().required().messages({
    "any.required": "Last name is required.",
    "string.empty": "Last name cannot be empty.",
  }),
  userName: Joi.string().required().messages({
    "any.required": "Username is required.",
    "string.empty": "Username cannot be empty.",
  }),
  email: Joi.string().email().required().messages({
    "string.email": "Please enter a valid email address.",
    "any.required": "Email is required.",
    "string.empty": "Email cannot be empty.",
  }),
  password: Joi.string().min(8).required().messages({
    "string.min": "Password must be at least 8 characters long.",
    "any.required": "Password is required.",
    "string.empty": "Password cannot be empty.",
  }),
  passwordConfirm: Joi.string().valid(Joi.ref("password")).required().messages({
    "any.only": "Password confirmation must match password.",
    "any.required": "Password confirmation is required.",
    "string.empty": "Password confirmation cannot be empty.",
  }),
});
