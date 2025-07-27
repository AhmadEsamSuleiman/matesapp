import isEnabled from "../utils/isRedisEnabled.js";
import Redis from "ioredis";

let redis;

if (isEnabled()) {
  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
  });

  redis.on("connect", () => {
    console.log("Connected to Redis Cloud");
  });

  redis.on("error", (err) => {
    console.error("Redis connection error:", err);
  });
} else {
  console.log(`redis disabled`);
}

export default redis;
