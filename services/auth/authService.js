import User from "../../models/userModel.js";
import AppError from "../../utils/appError.js";
import jwt from "jsonwebtoken";
import { promisify } from "util";

export const signUpService = async (userData) => {
  const newUser = await User.create(userData);

  if (!newUser) throw new AppError("User creation failed", 400);
  newUser.password = undefined;

  return newUser;
};

export const loginUserService = async ({ userName, email, password }) => {
  let user;
  if (userName) {
    user = await User.findOne({ userName }).select("+password");
  } else if (email) {
    user = await User.findOne({ email }).select("+password");
  }
  if (!user) throw new AppError("user name or email is incorrect", 400);

  const isMatch = await user.comparePassword(password);
  if (!isMatch)
    throw new AppError("the password you entered is incorrect", 400);

  user.password = undefined;
  return user;
};

export const verifyTokenService = async (token) => {
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // try {
  //   decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  // } catch (err) {
  //   if (err.name === "TokenExpiredError") {
  //     throw new AppError("Your session has expired. Please log in again.", 401);
  //   }

  //   throw new AppError("Invalid token. Please log in again.", 401);
  // }

  const user = await User.findById(decoded.id);

  if (!user)
    throw new AppError(
      "the user belonging to this token no longer exists",
      401
    );
  if (user.changedPasswordAfter(decoded.iat)) {
    throw new AppError(
      "user recently changed password! please log in again",
      401
    );
  }
  return user;
};
