import express from "express";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger/swagger.js";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import hpp from "hpp";
import cors from "cors";
import cookieParser from "cookie-parser";
import csurf from "csurf";
import expressSession from "express-session";

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

// --- 1. Security Middleware (Helmet) ---
// Helmet helps secure Express apps by setting various HTTP headers.
app.use(helmet());
app.disable("x-powered-by"); // Good practice to remove the X-Powered-By header

// --- 2. CORS (Cross-Origin Resource Sharing) ---
// Re-enabled with a specific whitelist to prevent cross-site requests from untrusted origins.
const allowedOrigins = [
  "http://localhost:3000", // Example: your frontend development server
  "https://your-production-frontend.com", // Example: your production frontend domain
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, postman, or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true, // Allow cookies to be sent with requests
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  })
);

// --- 3. Body & Cookie Parsing ---
app.use(express.json({ limit: "10kb" })); // Limit JSON payload size to prevent DoS attacks
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET)); // Use a strong secret for signing cookies

// --- 4. Input Sanitization ---
// a) Protects against NoSQL query injection attacks.
app.use(mongoSanitize());

// b) Protects against HTTP Parameter Pollution.
app.use(
  hpp({
    // Whitelist parameters that are expected to be arrays.
    // Example: if you expect `?sort=createdAt&sort=name`, you'd add 'sort' here.
    // whitelist: ['sort', 'filter']
  })
);

// --- 5. Rate Limiting ---
// Protects against brute-force attacks and DoS. Adjust limits as needed.
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // limit each IP to 1000 requests per window
  message: "Too many requests from this IP, please try again after an hour.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", apiLimiter);

// --- 6. CSRF Protection (Requires a session) ---
// Re-enabled for critical protection against Cross-Site Request Forgery attacks.
// It uses a simple in-memory session store just for the CSRF token.
app.use(
  expressSession({
    secret: process.env.SESSION_SECRET || "a_secret_key", // Use a strong secret
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === "production" },
  })
);

app.use(
  csurf({
    cookie: {
      httpOnly: true, // Prevents client-side JS access to the token cookie
      secure: process.env.NODE_ENV === "production", // Only send in production over HTTPS
      sameSite: "Lax", // Or 'Strict' for stronger protection
    },
  })
);

// Expose CSRF token for forms and AJAX requests
app.get("/api/v1/csrf-token", (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// --- API Documentation ---
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// --- Route Handlers ---
app.use("/api/v1/user", userRouter);
app.use("/api/v1/engagement", engagementRouter);
app.use("/api/v1/feed", feedRouter);
app.use("/api/v1/post", postRouter);
app.use("/api/v1/comment", commentRouter);

// --- Error Handling ---
// Catch-all 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    message: `No endpoint for ${req.method} ${req.originalUrl}`,
  });
});

// Global error handler
app.use(globalErrorHandler);

export default app;
