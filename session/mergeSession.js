/**
 * @file services/mergeSessionIntoUser.js
 * @description
 * This module is responsible for the critical task of merging a user's real-time
 * session data from Redis back into their persistent profile stored in MongoDB.
 * It's executed by the `sessionExpiryWorker` when a session is deemed inactive or expired.
 *
 * The merging process involves:
 * 1.  Fetching the latest session state from Redis.
 * 2.  Loading the user's corresponding long-term profile from MongoDB.
 * 3.  Applying sophisticated blending algorithms (Exponential Moving Average - EMA)
 * to update interest scores and skip counts, ensuring that recent session activity
 * gradually influences the persistent profile without overwriting historical data.
 * 4.  Managing the transition of categories, subcategories, and creators between
 * various interest "pools" (e.g., top, rising, watched, skipped, followed)
 * based on blended scores, skip thresholds, and re-entry delays.
 * 5.  Persisting the updated user document back to MongoDB.
 *
 * This merge strategy allows for responsive real-time recommendations while
 * maintaining a stable and continuously updated long-term user profile.
 *
 * @requires ../session/redisClient.js - The configured Redis client instance.
 * @requires ../constants/constants.js - Defines maximum sizes for various interest pools.
 * @requires ../constants/sessionConstants.js - Defines blending factors, skip thresholds, and re-entry delays.
 * @requires ../utils/nodeHelpers.js - Helper functions for finding/initializing nodes within nested arrays and inserting into pools.
 */

import redis from "../session/redisClient.js";
import User from "../models/userModel.js";
import {
  TOP_CAT_MAX,
  RISING_CAT_MAX,
  TOP_SUB_MAX,
  RISING_SUB_MAX,
  SPECIFIC_MAX,
  TOP_CREATOR_MAX,
  RISING_CREATOR_MAX,
} from "../constants/constants.js";
import {
  SESSION_BLEND_ALPHA, // Blending factor for EMA
  HARSKIP_THRESHOLD, // Number of skips to trigger a "hard skip" demotion
  WATCHED_THRESHOLD, // Number of skips to trigger demotion to "watched" pool
  REENTRY_DELAY_MS, // Time delay before a skipped item can re-enter positive pools
} from "../constants/sessionConstants.js";
import { findOrInitNode, insertIntoPools } from "../utils/nodeHelpers.js";

/**
 * Calculates the next re-entry timestamp for an item (e.g., a creator)
 * that has been temporarily demoted or hard-skipped. This uses `REENTRY_DELAY_MS`.
 *
 * @returns {Date} A Date object representing when the item becomes eligible for re-evaluation.
 */
function computeNextReentry() {
  return new Date(Date.now() + REENTRY_DELAY_MS);
}

/**
 * Performs Exponential Moving Average (EMA) blending between an `oldValue`
 * (from persistent storage) and a `sessionValue` (from real-time session data).
 * The `alpha` factor determines the weight given to the new session value.
 *
 * Formula: `(1 - alpha) * oldValue + alpha * sessionValue`
 *
 * @param {number} [oldValue=0] - The existing score/value from the user's persistent profile.
 * @param {number} [sessionValue=0] - The updated score/value from the active Redis session.
 * @param {number} alpha - The blending factor (0 to 1). A higher alpha gives more weight to sessionValue.
 * @returns {number} The blended score/value.
 */
function emaBlend(oldValue = 0, sessionValue = 0, alpha) {
  return (1 - alpha) * oldValue + alpha * sessionValue;
}

/**
 * Blends skip counts using EMA, ensuring the result is rounded to a whole number.
 * This prevents fractional skip counts and smoothly integrates session-based skips.
 *
 * @param {number} [oldSkips=0] - The existing skip count from the user's persistent profile.
 * @param {number} [sessionSkips=0] - The skip count from the active Redis session.
 * @param {number} alpha - The blending factor.
 * @returns {number} The blended and rounded skip count.
 */
function blendSkipCounts(oldSkips = 0, sessionSkips = 0, alpha) {
  return Math.round(emaBlend(oldSkips, sessionSkips, alpha));
}

/**
 * Blends scores using EMA.
 *
 * @param {number} [oldScore=0] - The existing score from the user's persistent profile.
 * @param {number} [sessionScore=0] - The updated score from the active Redis session.
 * @param {number} alpha - The blending factor.
 * @returns {number} The blended score.
 */
function blendScores(oldScore = 0, sessionScore = 0, alpha) {
  return emaBlend(oldScore, sessionScore, alpha);
}

/**
 * Merges real-time session data into the user's persistent profile in MongoDB.
 * This is the core function executed by the session expiry worker.
 *
 * The merging process updates user's `topInterests`, `risingInterests`, and
 * `creatorsInterests` based on activity within the session.
 *
 * @param {string} userId - The MongoDB ObjectId (as a string) of the user.
 * @param {string} sessionId - The ID of the Redis session to merge.
 */
export async function mergeSessionIntoUser(userId, sessionId) {
  // 1) Load session data from Redis
  const raw = await redis.get(`sess:${sessionId}`);
  if (!raw) {
    console.warn(
      `mergeSessionIntoUser: No raw session data found for sid=${sessionId}`
    );
    return; // Session data might have been manually cleared or expired by Redis's own TTL.
  }
  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    console.error(
      `mergeSessionIntoUser: Failed to parse session JSON for sid=${sessionId}:`,
      err
    );
    return; // Corrupted session data, cannot merge.
  }

  // Ensure session contains userId, as it's critical for the merge.
  if (!session.userId || session.userId !== userId.toString()) {
    console.warn(
      `mergeSessionIntoUser: Mismatch or missing userId in session data for sid=${sessionId}. Expected ${userId}, got ${session.userId}.`
    );
    return;
  }

  // 2) Load user document from MongoDB
  const user = await User.findById(userId);
  if (!user)
    throw new Error(
      `mergeSessionIntoUser: User not found for userId=${userId}`
    );

  // 3) Unpack session pools for easier access
  const sessionTopCategories = session.topCategories || [];
  const sessionRisingCategories = session.risingCategories || [];
  const sessionTopCreators = session.topCreators || [];
  const sessionRisingCreators = session.risingCreators || [];
  const sessionWatchedCreators = session.watchedCreators || [];
  const sessionSkippedCreators = session.skippedCreators || [];
  const sessionFollowedCreators = session.followedCreators || [];

  // ────────────────────────────────────────────────────────────────────────────
  // 4) Merge category trees (Top and Rising Interests)
  // This section iterates through categories and their sub-components (subcategories, specifics)
  // applying EMA blending and re-pooling based on updated scores.
  // ────────────────────────────────────────────────────────────────────────────
  for (const cat of [...sessionTopCategories, ...sessionRisingCategories]) {
    // Find or initialize the category node in the user's persistent top/rising interests.
    const persistentCat = findOrInitNode(
      user.topInterests,
      user.risingInterests,
      cat.name, // Key to search by
      {
        // Default structure if not found
        name: cat.name,
        score: 0,
        lastUpdated: Date.now(),
        lastSkipAt: Date.now(),
        topSubs: [],
        risingSubs: [],
      },
      { key: "name" } // Option to specify the key for comparison
    );

    // Blend category score with the session's score using EMA.
    persistentCat.score = blendScores(
      persistentCat.score,
      cat.score,
      SESSION_BLEND_ALPHA
    );
    persistentCat.lastUpdated = Date.now(); // Update timestamp to reflect merge.

    // Re-pool the category into either `user.topInterests` or `user.risingInterests`
    // based on its new blended score and the defined maximums.
    insertIntoPools(
      user.topInterests,
      user.risingInterests,
      TOP_CAT_MAX,
      RISING_CAT_MAX,
      persistentCat,
      { key: "name" }
    );

    // Now, process subcategories within this category.
    // Ensure `liveCat` points to the *actual* updated object in the user's persistent pools.
    const liveCat =
      user.topInterests.find((c) => c.name === cat.name) ||
      user.risingInterests.find((c) => c.name === cat.name);

    if (!liveCat) continue;

    const subs = [
      ...(Array.isArray(cat.topSubs) ? cat.topSubs : []),
      ...(Array.isArray(cat.risingSubs) ? cat.risingSubs : []),
    ];

    for (const sub of subs) {
      // Find or initialize the subcategory node within the live category's sub-pools.
      const persistentSub = findOrInitNode(
        liveCat.topSubs,
        liveCat.risingSubs,
        sub.name,
        {
          name: sub.name,
          score: 0,
          lastUpdated: Date.now(),
          lastSkipAt: Date.now(),
          specific: [],
        },
        { key: "name" }
      );
      persistentSub.score = blendScores(
        persistentSub.score,
        sub.score,
        SESSION_BLEND_ALPHA
      );
      persistentSub.lastUpdated = Date.now();

      // Re-pool the subcategory.
      insertIntoPools(
        liveCat.topSubs,
        liveCat.risingSubs,
        TOP_SUB_MAX,
        RISING_SUB_MAX,
        persistentSub,
        { key: "name" }
      );

      // Finally, process specific items under that subcategory.
      // Ensure `liveSub` points to the *actual* updated object.
      const liveSub =
        liveCat.topSubs.find((s) => s.name === sub.name) ||
        liveCat.risingSubs.find((s) => s.name === sub.name);
      if (!liveSub) continue;

      const specifics = Array.isArray(sub.specific) ? sub.specific : [];
      for (const sp of specifics) {
        // Find or initialize the specific item node. Note: Specifics typically only have one pool (no rising).
        const persistentSpec = findOrInitNode(
          liveSub.specific,
          [], // No rising pool for specifics in this structure
          sp.name,
          {
            name: sp.name,
            score: 0,
            lastUpdated: Date.now(),
            skips: 0,
            lastSkipAt: Date.now(),
          },
          { key: "name" }
        );
        persistentSpec.score = blendScores(
          persistentSpec.score,
          sp.score,
          SESSION_BLEND_ALPHA
        );
        persistentSpec.lastUpdated = Date.now();

        // Re-pool the specific item.
        insertIntoPools(liveSub.specific, [], SPECIFIC_MAX, 0, persistentSpec, {
          key: "name",
        });
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 5) Merge Creator Interests (complex multi-pool management)
  // This section prioritizes and blends signals for creators, moving them
  // between different pools (followed, skipped, watched, top/rising) based on
  // their engagement within the session and their overall skip count.
  // ────────────────────────────────────────────────────────────────────────────
  const ci = user.creatorsInterests; // Shortcut to user's creatorsInterests
  const dbTop = ci.topCreators;
  const dbRise = ci.risingCreators;
  const dbWatch = ci.watchedCreatorsPool;
  const dbSkip = ci.skippedCreatorsPool;
  const dbFollow = user.following; // User's explicit follows (treated as a high-priority pool)

  // `sessionMap` will store the highest-priority signal for each unique creator ID from the session.
  // Priority: Followed > Positive (Top/Rising) > Watched > Skipped.
  const sessionMap = new Map();

  // 5.1) Process Followed Creators from session (Highest Priority)
  for (const f of sessionFollowedCreators) {
    sessionMap.set(f.creatorId, {
      type: "followed", // Signal type
      score: f.score || 0,
      skips: f.skips || 0,
      lastUpdated: new Date(f.lastUpdated || Date.now()),
      lastSkipAt: new Date(f.lastSkipUpdate || Date.now()),
    });
  }

  // 5.2) Process Positive Creators (Top/Rising) from session
  for (const c of [...sessionTopCreators, ...sessionRisingCreators]) {
    if (sessionMap.has(c.creatorId)) continue; // Already handled by a higher priority (followed).
    sessionMap.set(c.creatorId, {
      type: "positive",
      score: c.score || 0,
      skips: 0, // Positive creators usually have 0 skips in this context.
      lastUpdated: new Date(c.lastUpdated || Date.now()),
      lastSkipAt: new Date(Date.now()), // Or some initial value
    });
  }

  // 5.3) Process Watched Creators from session
  for (const w of sessionWatchedCreators) {
    if (sessionMap.has(w.creatorId)) continue; // Already handled by a higher priority.
    sessionMap.set(w.creatorId, {
      type: "watched",
      score: 0, // Watched creators does not have a score in this context.
      skips: w.skips || 0,
      lastUpdated: new Date(),
      lastSkipAt: new Date(w.lastSkipUpdate || Date.now()),
    });
  }

  // 5.4) Process Skipped Creators from session (Lowest Priority)
  for (const s of sessionSkippedCreators) {
    if (sessionMap.has(s.creatorId)) continue; // Already handled by a higher priority.
    sessionMap.set(s.creatorId, {
      type: "skipped",
      score: 0,
      skips: s.skips || 0,
      lastUpdated: new Date(),
      lastSkipAt: new Date(s.lastSkipUpdate || Date.now()),
    });
  }

  // Helper functions for manipulating DB arrays by creatorId (or userId for followed)
  const findById = (arr, id) =>
    arr.find((x) => (x.creatorId || x.userId)?.toString() === id);
  const removeById = (arr, id) => {
    const idx = arr.findIndex(
      (x) => (x.creatorId || x.userId)?.toString() === id
    );
    if (idx !== -1) arr.splice(idx, 1);
  };

  // Process each unique creator's blended signal from the sessionMap
  for (const [creatorId, data] of sessionMap.entries()) {
    const idStr = creatorId.toString(); // Ensure consistent string comparison

    // Look up existing entries for this creator in all persistent pools
    const followIndex = dbFollow.findIndex(
      (f) => f.userId.toString() === idStr
    );
    const dbFollowed = followIndex >= 0 ? dbFollow[followIndex] : null;
    const dbSkippedEntry = findById(dbSkip, idStr);
    const dbWatchedEntry = findById(dbWatch, idStr);
    const dbTopEntry = findById(dbTop, idStr);
    const dbRiseEntry = findById(dbRise, idStr);

    // Determine the *persistent* old skip count and score before blending
    const oldSkips =
      dbSkippedEntry?.skips ??
      dbWatchedEntry?.skips ??
      dbTopEntry?.skips ??
      dbRiseEntry?.skips ??
      dbFollowed?.skips ?? // Include followed skips in initial lookup
      0;
    const oldScore =
      dbTopEntry?.score ?? dbRiseEntry?.score ?? dbFollowed?.score ?? 0;

    // Blend the session's skips and scores with the persistent old values
    const newSkips = blendSkipCounts(oldSkips, data.skips, SESSION_BLEND_ALPHA);
    const newScore = blendScores(oldScore, data.score, SESSION_BLEND_ALPHA);

    // --- Decision Tree for Creator Pool Management ---

    // 1) Handle "Followed" Creators: Highest precedence
    if (data.type === "followed") {
      // If already followed, update its properties.
      if (dbFollowed) {
        dbFollowed.skips = newSkips;
        dbFollowed.lastSkipAt = data.lastSkipAt;
        dbFollowed.lastUpdated = data.lastUpdated;
        // If hard-skipped while followed, zero out score and set reentry.
        if (newSkips >= HARSKIP_THRESHOLD) {
          dbFollowed.score = 0;
          dbFollowed.reentryAt = computeNextReentry();
        } else {
          dbFollowed.score = newScore; // Otherwise, update score normally.
          dbFollowed.reentryAt = new Date(); // Immediately eligible.
        }
      }
      // Eject from all other pools as 'followed' is the dominant state.
      removeById(dbSkip, idStr);
      removeById(dbWatch, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue; // Move to the next creator in sessionMap.
    }

    // 2) Handle "Hard-skip" Creators: If not followed, check for hard skips.
    if (newSkips >= HARSKIP_THRESHOLD) {
      // If already in skipped pool, update.
      if (dbSkippedEntry) {
        dbSkippedEntry.skips = newSkips;
        dbSkippedEntry.lastSkipUpdate = data.lastSkipAt;
        dbSkippedEntry.reentryAt = computeNextReentry(); // Set a new re-entry delay.
      } else {
        // If not in skipped pool, add it.
        dbSkip.push({
          creatorId: idStr,
          skips: newSkips,
          lastSkipUpdate: data.lastSkipAt,
          reentryAt: computeNextReentry(),
        });
      }
      // Eject from watched, top, and rising pools.
      removeById(dbWatch, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue;
    }

    // 3) Handle "Watched Pool" (Light Demotion): If not followed or hard-skipped, check for "watched" status.
    if (newSkips > WATCHED_THRESHOLD) {
      // If already in watched pool, update.
      if (dbWatchedEntry) {
        dbWatchedEntry.skips = newSkips;
        dbWatchedEntry.lastSkipUpdate = data.lastSkipAt;
        dbWatchedEntry.reentryAt = new Date(); // Eligible for re-entry immediately (soft demotion).
      } else {
        // If not in watched pool, add it.
        dbWatch.push({
          creatorId: idStr,
          skips: newSkips,
          lastSkipUpdate: data.lastSkipAt,
          reentryAt: new Date(),
        });
      }
      // Eject from skipped (as it's less severe) and top/rising pools.
      removeById(dbSkip, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue;
    }

    // 4) Handle Zero Skips / Positive Signal: Promote to top/rising if positive.
    // At this point, the creator is not followed, hard-skipped, or in the watched pool.
    // Clear from skipped and watched pools if they somehow were there (consistency).
    removeById(dbSkip, idStr);
    removeById(dbWatch, idStr);

    if (data.type === "positive") {
      // If the session had a positive signal for this creator:
      const persistentCreator = findOrInitNode(
        dbTop,
        dbRise,
        idStr,
        {
          // Default structure if not found
          creatorId: idStr,
          score: 0,
          lastUpdated: Date.now(),
          skips: 0,
          lastSkipAt: Date.now(),
        },
        { key: "creatorId" }
      );
      // Update with new blended score and reset skips.
      persistentCreator.score = newScore;
      persistentCreator.lastUpdated = data.lastUpdated;
      persistentCreator.skips = 0; // Reset skips as it's a positive signal.
      persistentCreator.lastSkipAt = new Date();

      // Re-pool into top or rising creators based on score.
      insertIntoPools(
        dbTop,
        dbRise,
        TOP_CREATOR_MAX,
        RISING_CREATOR_MAX,
        persistentCreator,
        { key: "creatorId" }
      );
    }
    // Otherwise, if the creator had no positive signal and is not in followed/skipped/watched,
    // they are left out of top/rising pools and effectively disappear from active pools for now.
  }

  console.log(`session merged successfully for userId: ${userId}`);

  // 6) Persist the entire updated user document to MongoDB.
  // `validateBeforeSave: false` can be used to skip Mongoose schema validation.
  // This might be done for performance or if validation is handled at a different layer.
  await user.save({ validateBeforeSave: false });
}
