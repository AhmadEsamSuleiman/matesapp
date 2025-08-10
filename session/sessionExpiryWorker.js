import cron from "node-cron";
import redis from "./redisClient.js";
import mergeSessionIntoUser from "./mergeSession.js";
import { SESSION_LAST_ACCESS_ZSET, SESSION_TTL_MS } from "../constants/sessionConstants.js";

async function handleSession(sid) {
  const sessionKey = `sess:${sid}`;
  try {
    const raw = await redis.get(sessionKey);
    if (!raw) {
      await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
      return;
    }

    let sessionData;
    try {
      sessionData = JSON.parse(raw);
    } catch (parseErr) {
      console.error(`failed to parse session JSON for sid=${sid}:`, parseErr);
      await Promise.all([redis.del(sessionKey), redis.zrem(SESSION_LAST_ACCESS_ZSET, sid)]);
      return;
    }

    const { userId } = sessionData;
    if (!userId) {
      console.warn(`no userId in sessionData for sid=${sid}; cleaning up`);
      await Promise.all([redis.del(sessionKey), redis.zrem(SESSION_LAST_ACCESS_ZSET, sid)]);
      return;
    }

    console.log(`merging expired session sid=${sid} for user=${userId}`);
    await mergeSessionIntoUser(userId, sid);

    await Promise.all([redis.del(sessionKey), redis.zrem(SESSION_LAST_ACCESS_ZSET, sid)]);

    console.log(`successfully merged and cleared session sid=${sid}`);
  } catch (err) {
    console.error(`error processing expired session sid=${sid}:`, err);
    await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
  }
}

async function processExpiredSessions() {
  const now = Date.now();
  const cutoff = now - SESSION_TTL_MS;

  try {
    const expiredSessionIds = await redis.zrangebyscore(SESSION_LAST_ACCESS_ZSET, 0, cutoff);

    console.log(
      `worker: checking cutoff=${new Date(cutoff).toISOString()}, found ${expiredSessionIds.length} expired session(s):`,
      expiredSessionIds,
    );

    if (!expiredSessionIds?.length) return;

    await Promise.all(expiredSessionIds.map((sid) => handleSession(sid)));
  } catch (err) {
    console.error("error fetching expired sessions from sorted set:", err);
  }
}

if (redis) {
  cron.schedule("*/1 * * * *", async () => {
    await processExpiredSessions();
  });
} else {
  console.log("sessionExpiryWorker: Redis disabled, not scheduling expiry jobs");
}
