/**
 * @file session/sessionExpiryWorker.js
 * @description
 * This module implements a background worker that periodically processes expired
 * user sessions stored in Redis. It is responsible for identifying sessions
 * that have been inactive for a defined period, merging their real-time
 * accumulated interest and creator data back into the user's persistent profile
 * in MongoDB, and then cleaning up the session data from Redis.
 *
 * This worker ensures data consistency by synchronizing real-time session activity
 * with long-term user preferences, and optimizes Redis memory usage by removing
 * stale session data. It uses `node-cron` to schedule its execution at regular intervals.
 *
 * @requires ./redisClient.js - The configured Redis client instance.
 * @requires node-cron - For scheduling periodic tasks.
 * @requires ./mergeSession.js - The module containing `mergeSessionIntoUser` to persist session data to MongoDB.
 * @requires ../constants/sessionConstants.js - Defines constants like `SESSION_LAST_ACCESS_ZSET` and `SESSION_TTL_MS`.
 */

import redis from "./redisClient.js";
import cron from "node-cron";
import { mergeSessionIntoUser } from "./mergeSession.js";
import {
  SESSION_LAST_ACCESS_ZSET,
  SESSION_TTL_MS,
} from "../constants/sessionConstants.js";

/**
 * Asynchronously processes sessions that have expired based on their last access time.
 * This function performs the core logic of identifying, merging, and cleaning up sessions.
 *
 * The process involves:
 * 1.  Querying the `SESSION_LAST_ACCESS_ZSET` to find session IDs whose last access timestamp
 * is older than the defined `cutoff` (current time - `SESSION_TTL_MS`).
 * 2.  For each identified expired session:
 * a.  It attempts to retrieve the full session data from Redis.
 * b.  Parses the session data and extracts the `userId`.
 * c.  Invokes `mergeSessionIntoUser` to persist the session's dynamic data (e.g., updated scores)
 * back into the corresponding user's document in MongoDB.
 * d.  Deletes the session's data from Redis (both the main key and its entry in the sorted set).
 * 3.  Includes robust error handling for Redis operations, JSON parsing, and merging.
 */

async function processExpiredSessions() {
  const now = Date.now();
  // Calculate the cutoff timestamp: any session accessed before this time is considered expired.
  const cutoff = now - SESSION_TTL_MS;
  try {
    // 1) Get sessionIds from the sorted set whose last-access score is less than or equal to the cutoff.
    const expiredSessionIds = await redis.zrangebyscore(
      SESSION_LAST_ACCESS_ZSET,
      0,
      cutoff
    );

    console.log(
      `Worker: checking cutoff=${new Date(cutoff).toISOString()}, ` +
        `found ${expiredSessionIds.length} expired session(s):`,
      expiredSessionIds
    );

    console.log(expiredSessionIds);

    if (!expiredSessionIds || expiredSessionIds.length === 0) {
      return; // No expired sessions to process.
    }

    // Iterate over each expired session ID.
    for (const sid of expiredSessionIds) {
      const sessionKey = `sess:${sid}`;
      try {
        // 2) Read the session JSON data from Redis.
        const raw = await redis.get(sessionKey);
        if (!raw) {
          // If session data is missing in Redis but still in the sorted set, clean up the sorted set entry.
          await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
          continue; // Move to the next session.
        }

        let sessionData;

        try {
          sessionData = JSON.parse(raw);
        } catch (parseErr) {
          console.error(
            `Failed to parse session JSON for sid=${sid}:`,
            parseErr
          );

          // Clean up corrupted session data to prevent repeated errors.
          await redis.del(sessionKey);
          await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
          continue;
        }

        const userId = sessionData.userId;

        if (!userId) {
          console.warn(`No userId in sessionData for sid=${sid}; cleaning up`);
          await redis.del(sessionKey);
          await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
          continue;
        }
        console.log(`Merging expired session sid=${sid} for user=${userId}`);
        // 3) MERGE: Call the external function to merge session data into the user's persistent profile in MongoDB.
        await mergeSessionIntoUser(userId, sid);

        // 4) CLEANUP: Delete the session JSON from Redis and remove its entry from the sorted set.
        await redis.del(sessionKey);
        await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
        console.log(`Successfully merged and cleared session sid=${sid}`);
      } catch (err) {
        console.error(`Error processing expired session sid=${sid}:`, err);
        // If an error occurs during processing a specific session, remove it from the sorted set
        // to prevent it from continuously being picked up and causing repeated failures.
        await redis.zrem(SESSION_LAST_ACCESS_ZSET, sid);
      }
    }
  } catch (err) {
    console.error("Error fetching expired sessions from sorted set:", err);
  }
}

/**
 * Schedules the `processExpiredSessions` function to run periodically using `node-cron`.
 * The current schedule is set to run every minute.
 * This initiates the background task that manages session persistence and cleanup.
 */

if (redis) {
  cron.schedule("*/1 * * * *", async () => {
    await processExpiredSessions();
  });
} else {
  console.log(
    "sessionExpiryWorker: Redis disabled, not scheduling expiry jobs"
  );
}
