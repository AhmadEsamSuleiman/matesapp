import redis from "./redisClient.js";

import { SESSION_LAST_ACCESS_ZSET } from "../constants/sessionConstants.js";

export async function setSessionData(sessionId, data) {
  const redisKey = `sess:${sessionId}`;
  const payload = JSON.stringify(data);

  await redis.set(redisKey, payload);
}

export async function getSessionData(sessionId) {
  const redisKey = `sess:${sessionId}`;
  const raw = await redis.get(redisKey);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession(sessionId) {
  const redisKey = `sess:${sessionId}`;
  await redis.del(redisKey);
  await redis.zrem(SESSION_LAST_ACCESS_ZSET, sessionId);
}

export async function refreshUserSession(sessionId) {
  const now = Date.now();

  await redis.zadd(SESSION_LAST_ACCESS_ZSET, now, sessionId);
}
