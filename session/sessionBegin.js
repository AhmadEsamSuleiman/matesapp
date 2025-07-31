import redis from "./redisClient.js";
import User from "../models/userModel.js";
import { startSession as storeStartSession } from "./sessionStart.js";
import { SESSION_LAST_ACCESS_ZSET } from "../constants/sessionConstants.js";

export async function startUserSession(userId, sessionId) {
  await storeStartSession(userId, sessionId, User);

  const now = Date.now();
  await redis.zadd(SESSION_LAST_ACCESS_ZSET, now, sessionId);
}
