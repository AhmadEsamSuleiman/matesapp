export default (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (err.name === "ValidationError") {
    err.statusCode = 400;
    err.status = "fail";
    err.message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  if (err.code === 11000) {
    err.statusCode = 409;
    err.status = "fail";
    const fields = Object.keys(err.keyValue || {});
    err.message = fields.length ? `Duplicate field value entered for: ${fields.join(", ")}.` : "Duplicate field value entered.";
  }

  if (err.name === "JsonWebTokenError") {
    err.statusCode = 401;
    err.status = "fail";
    err.message = "Invalid token. Please log in again!";
  }
  if (err.name === "TokenExpiredError") {
    err.statusCode = 401;
    err.status = "fail";
    err.message = "Your token has expired! Please log in again.";
  }

  if (err.name === "CastError") {
    err.statusCode = 400;
    err.status = "fail";
    err.message = `Invalid ${err.path}: ${err.value}`;
  }

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message || "Something went wrong!",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};
