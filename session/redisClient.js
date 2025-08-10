import Redis from "ioredis";
import isEnabled from "../utils/isRedisEnabled.js";

let redisClient;

if (isEnabled()) {
  redisClient = new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
  });

  redisClient.on("connect", () => {
    console.log("Connected to Redis Cloud");
  });

  redisClient.on("error", (err) => {
    console.error("Redis connection error:", err);
  });
} else {
  console.log("redis disabled");
}

const redis = redisClient;

export default redis;
