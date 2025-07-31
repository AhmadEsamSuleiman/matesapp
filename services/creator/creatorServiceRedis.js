/**
 * @file creatorServiceRedis.js
 * @description
 * This file handles the real-time, session-based management of a user's interest
 * in specific creators using Redis. It mirrors the complex logic of
 * `creatorServiceDB.js` but operates on transient session data for immediate
 * responsiveness and dynamic content adaptation.
 *
 * The service is responsible for:
 * 1.  **Instant Creator Scoring:** Updates a creator's score in the user's
 * Redis session immediately upon positive engagement (e.g., liking a post).
 * 2.  **Real-time Skip Management:** Processes explicit "skip" actions for creators,
 * decrementing their score and managing their presence in various session-specific pools.
 * 3.  **Session-bound Creator Pools:** Maintains several dynamic pools directly
 * within the user's Redis session data:
 * - `topCreators`: Top creators for the current session.
 * - `risingCreators`: Creators gaining traction in the current session.
 * - `followedCreators`: Creators the user explicitly follows.
 * - `watchedCreators`: General creators the user has engaged with after reentry.
 * - `skippedCreators`: Creators explicitly skipped by the user, with temporary "cool-off" periods.
 * 4.  **Temporary Cool-off Logic:** For skipped creators, it implements a session-level
 * cool-off period, preventing their content from being recommended for a set duration
 * within the current session, ensuring immediate feedback to the user.
 * 5.  **Session Refresh:** Ensures that after any updates, the modified session data
 * is persisted back to Redis and the session's expiry time is refreshed, maintaining
 * continuity of the user's experience.
 *
 * This service complements the database-driven creator interest management by providing
 * the necessary speed and dynamism for a highly personalized and adaptive user interface.
 *
 * @requires ../session/sessionHelpers.js - Utilities for getting/setting session data in Redis.
 * @requires ../utils/nodeHelpers.js - Utility functions for managing nodes (creators) in pools.
 * @requires ../constants/constants.js - Defines capacity limits for 'top' and 'rising' pools.
 * @requires ../constants/scoringConfig.js - For scoring weights like SKIP_WEIGHT.
 */

import {
  getSessionData,
  setSessionData,
  refreshUserSession,
} from "../../session/sessionHelpers.js";

import {
  findOrInitNode,
  updateNodeScore,
  insertIntoPools,
} from "../../utils/nodeHelpers.js";

import {
  TOP_CREATOR_MAX,
  RISING_CREATOR_MAX,
} from "../../constants/constants.js";
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";

// Define constants for skip threshold and re-entry duration locally for Redis service.
// These might differ from DB service for more aggressive session-based filtering.
const SKIP_THRESHOLD = 10; // Number of skips before a creator is moved to the skipped pool
const REENTRY_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 1 week in milliseconds

/**
 * Computes a future timestamp in milliseconds for when a skipped creator can
 * potentially re-enter active session pools.
 * @returns {number} The timestamp (milliseconds since epoch) for re-entry.
 */
function computeReentryAtMs() {
  return Date.now() + REENTRY_DURATION_MS;
}

/**
 * Updates a user's engagement score for a specific creator within their Redis session.
 * This function processes positive engagement and manages creator's presence in various
 * session-level interest pools.
 *
 * @param {string} userId - The ID of the user. (Note: currently not directly used in function body, but good for context)
 * @param {string} sessionId - The current session ID in Redis.
 * @param {string} creatorId - The ID of the creator being scored.
 * @param {number} engagementScore - The positive score representing the user's engagement.
 */
export async function scoreCreatorRedis(
  userId,
  sessionId,
  creatorId,
  engagementScore
) {
  const session = await getSessionData(sessionId);
  if (!session) return; // If no session, nothing to do.

  // Initialize all relevant creator pools from session data, ensuring they are arrays.
  let topCreators = Array.isArray(session.topCreators)
    ? session.topCreators
    : [];
  let risingCreators = Array.isArray(session.risingCreators)
    ? session.risingCreators
    : [];
  let watchedCreators = Array.isArray(session.watchedCreators)
    ? session.watchedCreators
    : [];
  let skippedCreators = Array.isArray(session.skippedCreators)
    ? session.skippedCreators
    : [];
  let followed = Array.isArray(session.followedCreators)
    ? session.followedCreators
    : [];
  const now = Date.now(); // Current timestamp for updates.

  // --- Case 1: Creator is being followed by the user (within this session's context) ---
  const idxF = followed.findIndex((c) => c.creatorId === creatorId.toString());
  if (idxF !== -1) {
    const entry = followed[idxF];
    // If previously skipped, decrement the skip count on positive engagement.
    if ((entry.skips || 0) > 0) {
      entry.skips = Math.max((entry.skips || 1) - 1, 0); // Ensure skips don't go below zero.
      entry.lastSkipAt = now; // Update timestamp of last skip modification.
    }

    // Update the score of the followed creator.
    const newScore = updateNodeScore(entry, engagementScore);
    entry.score = newScore;
    entry.lastUpdated = now;

    // Save updated `followedCreators` back to session.
    session.followedCreators = followed;
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId); // Keep session alive.
    return; // Exit, as followed creators have special priority.
  }

  // --- Case 2: Creator was previously in the `skippedCreators` pool (within this session) ---
  const skippedIdx = skippedCreators.findIndex(
    (c) => c.creatorId === creatorId.toString()
  );
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];

    entry.skips = Math.max((entry.skips || 1) - 1, 0); // Reduce skip count due to positive engagement.
    entry.lastSkipUpdate = now; // Mark time of update.

    // If skips fall below the threshold due to this positive engagement...
    if (entry.skips < SKIP_THRESHOLD) {
      // And if the re-entry cool-off period has passed (or was never set/is in the past)...
      if (now >= (entry.reentryAt || 0)) {
        skippedCreators.splice(skippedIdx, 1); // Remove from `skippedCreators` pool.
        // Move to `watchedCreators` pool, indicating re-engagement.
        watchedCreators.push({
          creatorId,
          skips: entry.skips,
          lastSkipUpdate: now,
          reentryAt: now, // Reset reentryAt, effectively making it immediately available.
        });
        // Update session with changes to both skipped and watched pools.
        session.skippedCreators = skippedCreators;
        session.watchedCreators = watchedCreators;
        await setSessionData(sessionId, session);
        await refreshUserSession(sessionId);
        return; // Exit.
      }
      // If skips are below threshold but reentry time hasn't passed, just save the updated skips.
      session.skippedCreators = skippedCreators;
      await setSessionData(sessionId, session);
      await refreshUserSession(sessionId);
      return;
    } else {
      // If skips are still >= threshold even after decrement, extend the cool-off period.
      entry.reentryAt = computeReentryAtMs();
      session.skippedCreators = skippedCreators;
      await setSessionData(sessionId, session);
      await refreshUserSession(sessionId);
      return;
    }
  }

  // --- Case 3: Creator is in the `watchedCreators` pool (within this session) ---
  const watchedIdx = watchedCreators.findIndex(
    (c) => c.creatorId === creatorId.toString()
  );
  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0); // Reduce skip count.
    entry.lastSkipUpdate = now;

    if (entry.skips === 0) {
      // If skips drop to zero, remove from `watchedCreators` as it's now a positive signal.
      watchedCreators.splice(watchedIdx, 1);
      session.watchedCreators = watchedCreators;
    } else {
      // If skips are still positive, just save the update to the watched entry.
      session.watchedCreators = watchedCreators;
      await setSessionData(sessionId, session);
      await refreshUserSession(sessionId);
      return; // Exit.
    }
  }

  // --- Case 4: Creator is not found in followed, skipped, or watched pools ---
  // This means it's a new or positively re-engaged creator ready for top/rising.
  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId, // Use creatorId directly as string for findOrInitNode
    {
      creatorId: creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0, // Initialize skips to 0 for positive engagement.
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" } // Specify the key for finding/initializing.
  );

  // Update the creator's score with the positive engagement.
  updateNodeScore(creator, engagementScore);
  // Insert/reposition the creator into `topCreators` or `risingCreators` pools.
  insertIntoPools(
    topCreators,
    risingCreators,
    TOP_CREATOR_MAX,
    RISING_CREATOR_MAX,
    creator,
    { key: "creatorId" }
  );

  // Update session with the modified top/rising creator lists.
  session.topCreators = topCreators;
  session.risingCreators = risingCreators;

  // Save the entire session data back to Redis.
  await setSessionData(sessionId, session);
  await refreshUserSession(sessionId); // Refresh session expiry.
}

/**
 * Handles a user's "skip" action for a specific creator within their Redis session.
 * This applies negative feedback and manages the creator's status across session pools.
 *
 * @param {string} sessionId - The current session ID in Redis.
 * @param {string} creatorId - The ID of the creator being skipped.
 */
export async function skipCreatorRedis(sessionId, creatorId) {
  const session = await getSessionData(sessionId);
  if (!session) return; // If no session, nothing to do.

  // Initialize all relevant creator pools from session data, ensuring they are arrays.
  let topCreators = Array.isArray(session.topCreators)
    ? session.topCreators
    : [];
  let risingCreators = Array.isArray(session.risingCreators)
    ? session.risingCreators
    : [];
  let watchedCreators = Array.isArray(session.watchedCreators)
    ? session.watchedCreators
    : [];
  let skippedCreators = Array.isArray(session.skippedCreators)
    ? session.skippedCreators
    : [];
  let followed = Array.isArray(session.followedCreators)
    ? session.followedCreators
    : [];
  const now = Date.now(); // Current timestamp.

  // --- Case 1: Creator is being followed by the user (within this session) ---
  const idxF = followed.findIndex((c) => c.creatorId === creatorId.toString());
  if (idxF !== -1) {
    const entry = followed[idxF];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Increment skip count.
    entry.lastSkipAt = now; // Update time of last skip.
    entry.score = updateNodeScore(entry, SKIP_WEIGHT); // Apply negative score.
    entry.lastUpdated = now; // Mark as recently updated.

    // If skips reach threshold, zero the score and set a re-entry time.
    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0;
      entry.reentryAt = computeReentryAtMs();
    }
    session.followedCreators = followed; // Save updated followed list.
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  }

  // --- Case 2: Creator is already in the `skippedCreators` pool (within this session) ---
  const skippedIdx = skippedCreators.findIndex(
    (c) => c.creatorId === creatorId.toString()
  );
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Further increment skips.
    entry.lastSkipUpdate = now;
    entry.reentryAt = computeReentryAtMs(); // Extend the cool-off period.
    session.skippedCreators = skippedCreators; // Save updated skipped list.
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  }

  // --- Case 3: Creator is in the `watchedCreators` pool (within this session) ---
  const watchedIdx = watchedCreators.findIndex(
    (c) => c.creatorId === creatorId.toString()
  );
  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Increment skips.
    entry.lastSkipUpdate = now;

    // If skips reach the threshold, move from `watchedCreators` to `skippedCreators`.
    if (entry.skips >= SKIP_THRESHOLD) {
      watchedCreators.splice(watchedIdx, 1); // Remove from watched.
      skippedCreators.push({
        creatorId,
        skips: entry.skips,
        lastSkipUpdate: now,
        reentryAt: computeReentryAtMs(), // Set a cool-off for the skipped pool.
      });
    }
    // Update session with changes to both watched and skipped pools.
    session.watchedCreators = watchedCreators;
    session.skippedCreators = skippedCreators;

    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  }

  // --- Case 4: Creator is in `topCreators` or `risingCreators` (or new to session) ---
  const creatorNode = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId, // Use creatorId directly as string for findOrInitNode
    {
      creatorId: creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0,
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" }
  );
  creatorNode.skips = Math.min((creatorNode.skips || 0) + 1, SKIP_THRESHOLD); // Increment skips.
  creatorNode.lastSkipAt = Date.now(); // Update timestamp.
  updateNodeScore(creatorNode, SKIP_WEIGHT); // Apply negative score.

  // If skips reach a specific (hardcoded) high threshold, remove from active pools
  // and potentially put into the skipped pool.
  if (creatorNode.skips >= SKIP_THRESHOLD) {
    session.topCreators = topCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    session.risingCreators = risingCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    skippedCreators.push({
      creatorId,
      skips: creatorNode.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: computeReentryAtMs(),
    });
    session.skippedCreators = skippedCreators;
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  }

  // If score drops to 0 or below AND at least one skip, move to `watchedCreators` pool.
  // This is a "demotion" from top/rising, but not a full skip yet.
  if (creatorNode.score <= 0 && creatorNode.skips >= 1) {
    session.topCreators = topCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    session.risingCreators = risingCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    watchedCreators.push({
      creatorId,
      skips: creatorNode.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: Date.now(), // Set reentry to now, meaning it's immediately available but in watched.
    });
    session.watchedCreators = watchedCreators;
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  }

  // If none of the above conditions met, simply re-insert into top/rising pools.
  // The score has been updated negatively, so its position might change.
  insertIntoPools(
    topCreators,
    risingCreators,
    TOP_CREATOR_MAX,
    RISING_CREATOR_MAX,
    creatorNode,
    { key: "creatorId" }
  );
  // Update session with modified top/rising creator lists.
  session.topCreators = topCreators;
  session.risingCreators = risingCreators;
  await setSessionData(sessionId, session);
  await refreshUserSession(sessionId);
}
