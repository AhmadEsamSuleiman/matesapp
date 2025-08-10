import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import catchAsync from "../utils/catchAsync.js";
import AppError from "../utils/appError.js";
import isEnabled from "../utils/isRedisEnabled.js";

import { loginUserService, signUpService, verifyTokenService } from "../services/auth/authService.js";
import { loginSchema, signUpSchema } from "../validators/authValidator.js";

import startUserSession from "../session/sessionBegin.js";
import { refreshUserSession, getSessionData } from "../session/sessionHelpers.js";
import { SESSION_TTL_SECONDS } from "../constants/sessionConstants.js";

const signToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expires: new Date(Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  res.cookie("jwt", token, cookieOptions);

  res.status(statusCode).json({
    status: "success",
    token,
    data: {
      user,
    },
  });
};

export const signUp = catchAsync(async (req, res, next) => {
  const { error, value } = signUpSchema.validate(req.body, {
    abortEarly: false,
  });

  if (error) {
    const messages = error.details.map((d) => d.message);
    return next(new AppError(messages.join("; "), 400));
  }

  const newUser = await signUpService(value);

  createSendToken(newUser, 201, res);
});

export const login = catchAsync(async (req, res, next) => {
  const { error, value } = loginSchema.validate(req.body);

  if (error) return next(new AppError(error.details[0].message, 400));

  const user = await loginUserService(value);

  createSendToken(user, 200, res);
});

export const logout = catchAsync(async (req, res, next) => {
  res.cookie("jwt", "loggedout", {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  if (req.cookies.sid) {
    res.clearCookie("sid");
  }
  res.status(200).json({ status: "success" });
});

export const protect = catchAsync(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    return next(new AppError("please log in to access this page", 401));
  }

  const user = await verifyTokenService(token);

  req.user = user;

  if (isEnabled()) {
    let { sid } = req.cookies;
    const sessionData = sid && (await getSessionData(sid));

    if (sessionData) {
      try {
        await refreshUserSession(sid);
      } catch (err) {
        console.error("Error refreshing session last-access:", err);
      }
    } else {
      sid = uuid();
      try {
        await startUserSession(user._id, sid);
      } catch (err) {
        console.error("Error starting user session:", err);
      }
    }

    res.cookie("sid", sid, {
      httpOnly: true,
      maxAge: SESSION_TTL_SECONDS * 1000,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
    });

    req.sessionId = sid;
  }

  next();
});
