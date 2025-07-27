import express from "express";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger/swagger.js";
// import redis from "./session/redisClient.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize, { sanitize } from "express-mongo-sanitize";
// import csurf from "csurf";
import hpp from "hpp";
// import cors from 'cors';

import userRouter from "./routes/userRoutes.js";
import feedRouter from "./routes/feedRoutes.js";
import engagementRouter from "./routes/engagementRoutes.js";
import postRouter from "./routes/postRoutes.js";
import commentRouter from "./routes/commentRoutes.js";
import globalErrorHandler from "./utils/globalErrorHandler.js";
// import { startUserSession } from "./session/sessionBegin.js";

import cookieParser from "cookie-parser";

import "./jobs/decayUserRising.js";
import "./jobs/postEvergreenRecompute.js";
import "./session/sessionExpiryWorker.js";

const app = express();

app.use(helmet());
app.disable("x-powered-by");

// CORS setup (disabled):
// const allowed = ["domain.com"];
// app.use(
//   cors({
//     origin(origin, callback) {
//       if (!origin || allowed.includes(origin)) return callback(null, true);
//       callback(new Error("Not allowed by CORS"));
//     },
//     credentials: true,
//   })
// );

// CSRF protection (disabled):
// app.use(
//   csurf({
//     cookie: {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       sameSite: "lax",
//     },
//   })
// );

// expose CSRF token if you enable csurf()
// app.get("/api/v1/csrf-token", (req, res) => {
//   res.json({ csrfToken: req.csrfToken() });
// });

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

// sanitize against NoSQL query injection
app.use((req, res, next) => {
  req.body = sanitize(req.body);
  req.params = sanitize(req.params);
  next();
});

app.use(hpp());

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // limit each IP to 1000 requests per window
  message: "Too many requests, please try again later.",
});
app.use("/api/", apiLimiter);

// API docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// route handlers
app.use("/api/v1/user", userRouter);
app.use("/api/v1/engagement", engagementRouter);
app.use("/api/v1/feed", feedRouter);
app.use("/api/v1/post", postRouter);
app.use("/api/v1/comment", commentRouter);

// catch-all 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No endpoint for ${req.method} ${req.originalUrl}`,
  });
});

// global error handler
app.use(globalErrorHandler);

export default app;
