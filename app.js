import express from "express";
import swaggerUi from "swagger-ui-express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerSpec from "./swagger/swagger.js";
import userRouter from "./routes/userRoutes.js";
import feedRouter from "./routes/feedRoutes.js";
import engagementRouter from "./routes/engagementRoutes.js";
import postRouter from "./routes/postRoutes.js";
import commentRouter from "./routes/commentRoutes.js";
import globalErrorHandler from "./utils/globalErrorHandler.js";

import "./jobs/decayUserRising.js";
import "./jobs/postEvergreenRecompute.js";
import "./session/sessionExpiryWorker.js";

const app = express();

app.use(helmet());
app.disable("x-powered-by");

const allowedOrigins = ["http://localhost:3000", "https://13-62-80-72.sslip.io"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET));

app.use((req, res, next) => {
  if (req.body) {
    mongoSanitize.sanitize(req.body);
  }
  if (req.params) {
    mongoSanitize.sanitize(req.params);
  }
  if (req.query) {
    req.sanitizedQuery = mongoSanitize.sanitize(req.query);
  } else {
    req.sanitizedQuery = {};
  }
  next();
});

app.use(hpp({}));

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: "Too many requests from this IP, please try again after an hour.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

app.use("/api/v1/user", userRouter);
app.use("/api/v1/engagement", engagementRouter);
app.use("/api/v1/feed", feedRouter);
app.use("/api/v1/post", postRouter);
app.use("/api/v1/comment", commentRouter);

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No endpoint for ${req.method} ${req.originalUrl}`,
  });
});

app.use(globalErrorHandler);

export default app;
