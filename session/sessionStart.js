/**
 * @file services/sessionStart.js
 * @description
 * This module provides the `startSession` function, which is a critical service
 * for initializing a user's real-time session in Redis. It acts as the bridge
 * that takes a user's long-term, persistent interest and creator data from
 * MongoDB and transforms it into a transient session object stored in Redis.
 * This allows the application to quickly access and update
 * user preferences during active interactions.
 *
 * The function fetches detailed user data (top/rising interests by category,
 * subcategory, specific; and various creator pools) and maps it to a JSON
 * structure stored in a Redis string. It also updates the session's activity
 * timestamp in a Redis sorted set.
 *
 * @requires ./redisClient.js - The Redis client instance for direct Redis operations (like zadd).
 * @requires ./sessionHelpers.js - Utility functions for setting session data in Redis.
 * @requires ../constants/sessionConstants.js - For Redis key constants.
 */

import redis from "./redisClient.js";
import { setSessionData } from "./sessionHelpers.js";
import { SESSION_LAST_ACCESS_ZSET } from "../constants/sessionConstants.js";

/**
 * Initiates a user's real-time session by loading their persistent interest and
 * creator data from MongoDB and storing it in Redis.
 *
 * This function performs the following steps:
 * 1.  Fetches the user's document from MongoDB using the provided `UserModel`.
 * 2.  Constructs a `sessionData` object containing various interest and creator
 * pools (top/rising categories, subcategories, specific interests, top/rising/watched/skipped/followed creators).
 * Date objects from MongoDB are converted to Unix timestamps (milliseconds)
 * for Redis compatibility.
 * 3.  Stores the prepared `sessionData` into Redis using `setSessionData` from `sessionHelpers`.
 * 4.  Updates the `SESSION_LAST_ACCESS_ZSET` in Redis with the current timestamp
 * for the `sessionId`, marking it as active for the expiry worker.
 *
 * @param {string} userId - The unique ID of the user whose session is being started.
 * @param {string} sessionId - The unique ID for the current Redis session.
 * @param {mongoose.Model} UserModel - The Mongoose User model (e.g., `User` from `../models/userModel.js`),
 * passed as an argument to avoid circular dependencies.
 */
export async function startSession(userId, sessionId, UserModel) {
  // 1. Fetch user data from MongoDB in a lean format for efficiency.
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new Error("User not found");
  }

  // 2. Initialize the sessionData object with the userId.
  const sessionData = { userId: userId.toString() };

  // --- Populate Session Data with User's Interest Pools (Categories/Subcategories/Specifics) ---
  // Transforms and maps the nested interest arrays from the user document.
  // Ensures default empty arrays if properties are null/undefined and converts Date objects to timestamps.
  sessionData.topCategories = (user.topInterests || []).map((cat) => ({
    name: cat.name,
    score: cat.score,
    lastUpdated: cat.lastUpdated?.getTime() || Date.now(),
    topSubs: (cat.topSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
    risingSubs: (cat.risingSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
  }));

  sessionData.risingCategories = (user.risingInterests || []).map((cat) => ({
    name: cat.name,
    score: cat.score,
    lastUpdated: cat.lastUpdated?.getTime() || Date.now(),
    topSubs: (cat.topSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
    risingSubs: (cat.risingSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
  }));

  // --- Populate Session Data with User's Creator Interest Pools ---
  sessionData.topCreators = (user.creatorsInterests.topCreators || []).map(
    (c) => ({
      creatorId: c.creatorId.toString(), // Convert ObjectId to string for Redis compatibility
      score: c.score,
      skips: c.skips || 0,
      lastSkipUpdate: c.lastSkipAt ? c.lastSkipAt.getTime() : Date.now(),
      lastUpdated: c.lastUpdated?.getTime() || Date.now(),
    })
  );

  sessionData.risingCreators = (
    user.creatorsInterests.risingCreators || []
  ).map((c) => ({
    creatorId: c.creatorId.toString(),
    score: c.score,
    skips: c.skips || 0,
    lastSkipUpdate: c.lastSkipAt ? c.lastSkipAt.getTime() : Date.now(),
    lastUpdated: c.lastUpdated?.getTime() || Date.now(),
  }));

  sessionData.watchedCreators = (
    user.creatorsInterests.watchedCreatorsPool || []
  ).map((c) => ({
    creatorId: c.creatorId.toString(),
    skips: c.skips,
    lastSkipUpdate: c.lastSkipUpdate?.getTime() || Date.now(),
    reentryAt: c.reentryAt?.getTime() || Date.now(),
  }));

  sessionData.skippedCreators = (
    user.creatorsInterests.skippedCreatorsPool || []
  ).map((c) => ({
    creatorId: c.creatorId.toString(),
    skips: c.skips,
    lastSkipUpdate: c.lastSkipUpdate?.getTime() || Date.now(),
    reentryAt: c.reentryAt?.getTime() || Date.now(),
  }));

  // Map followed creators, ensuring consistent field names and types.
  sessionData.followedCreators = (user.following || []).map((f) => ({
    creatorId: f.userId.toString(), // Assuming userId in `following` refers to the creator ID
    score: f.score || 0,
    lastUpdated: f.lastUpdated ? new Date(f.lastUpdated).getTime() : Date.now(),
    skips: f.skips || 0,
    lastSkipAt: f.lastSkipAt ? new Date(f.lastSkipAt).getTime() : Date.now(),
  }));

  // 3. Store the prepared session data into Redis using the helper function.
  await setSessionData(sessionId, sessionData);

  // 4. Update the session's last access time in the Redis sorted set.
  const now = Date.now();
  await redis.zadd(SESSION_LAST_ACCESS_ZSET, now, sessionId);
}
