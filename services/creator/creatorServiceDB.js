/**
 * @file creatorServiceDB.js
 * @description
 * This file manages a user's interest in specific creators, storing and updating
 * these preferences directly in the MongoDB database. It's distinct from general
 * interest categories as it focuses on the individual content creators.
 *
 * The service handles:
 * 1.  **Creator Scoring:** When a user positively engages with a creator's content,
 * the creator's score for that user is updated. This score reflects the user's
 * cumulative interest in that creator.
 * 2.  **Explicit Creator Skipping:** When a user explicitly "skips" content from a creator,
 * a negative weight is applied, and a `skips` count is incremented. This is vital
 * for allowing users to filter out creators they don't wish to see.
 * 3.  **Creator Pools:** Creators are organized into various pools on the `User` document:
 * - `topCreators`: Creators the user consistently engages with.
 * - `risingCreators`: Creators whose content the user is increasingly engaging with.
 * - `following`: Creators the user explicitly follows. These have special handling
 * for skips and generally higher priority.
 * - `skippedCreatorsPool`: Creators who have been skipped a certain number of times
 * (`SKIP_THRESHOLD`) and are put on a "cool-off" period (`reentryAt`).
 *  * - `watchedCreatorsPool`: Creators whose content the user has engaged with after being hard skipped,
 * it is a period where we check if the creator is eligible to be scored for top rising
 * but only after multiple positive engagements.
 * 4.  **Cool-off / Re-entry Logic:** If a creator is skipped frequently, they are
 * moved to a `skippedCreatorsPool` and assigned a `reentryAt` timestamp. This
 * prevents their content from being recommended for a set period, after which they
 * can potentially re-enter the general `watchedCreatorsPool` if the user's engagement changes.
 * 5.  **Score Decay & Removal:** Scores naturally decay, and if a creator's score
 * drops too low (especially due to skips), they can be removed from active pools.
 *
 * This service ensures personalized content recommendations by understanding
 * a user's granular preferences for individual content creators, including
 * their explicit dislikes.
 *
 * @requires ../utils/nodeHelpers.js - Utility functions for managing nodes in pools.
 * @requires ../constants/constants.js - For defining pool size limits.
 * @requires ../constants/scoringConfig.js - For scoring weights like SKIP_WEIGHT and SKIP_THRESHOLD.
 * @requires ../models/userModel.js - To update the user's creator interest data.
 */

import {
  findOrInitNode,
  updateNodeScore,
  insertIntoPools,
} from "../../utils/nodeHelpers.js";
import {
  TOP_CREATOR_MAX,
  RISING_CREATOR_MAX,
} from "../../constants/constants.js";
import { SKIP_WEIGHT, SKIP_THRESHOLD } from "../../constants/scoringConfig.js";
import User from "../../models/userModel.js";

/**
 * Calculates a future timestamp for when a skipped creator can potentially re-enter
 * a user's active interest pools. This creates a "cool-off" period.
 * @returns {Date} The timestamp when the creator can be reconsidered.
 */
function computeReentryAt() {
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ONE_WEEK_MS);
}

/**
 * Updates a user's engagement score for a specific creator in the database.
 * This function handles positive engagement and manages creator's presence
 * in various interest pools.
 *
 * @param {string} userId - The ID of the user whose creator interests are being updated.
 * @param {mongoose.Types.ObjectId} creatorId - The ID of the creator being scored.
 * @param {number} engagementScore - The positive score representing the user's engagement.
 */

export async function scoreCreatorDB(userId, creatorId, engagementScore) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const ci = user.creatorsInterests;
  const topCreators = ci.topCreators; // Creators with high, sustained interest
  const risingCreators = ci.risingCreators; // Creators with rapidly increasing interest
  const watchedCreators = ci.watchedCreatorsPool; // Creators the user has some history with - after being removed from skipped -
  const skippedCreators = ci.skippedCreatorsPool; // Creators explicitly skipped by the user
  const now = Date.now();

  // --- Case 1: Creator is being followed by the user ---
  const followIndex = user.following.findIndex((f) =>
    f.userId.equals(creatorId)
  );
  if (followIndex !== -1) {
    const entry = user.following[followIndex];

    // If the user previously skipped this followed creator, reduce the skip count on positive engagement.
    if ((entry.skips || 0) > 0) {
      entry.skips = Math.max((entry.skips || 1) - 1, 0); // Decrement skips, but not below zero.
      entry.lastSkipAt = now; // Update timestamp of the last skip modification.
    }

    // Update the follower's score with the new engagement.
    entry.score = updateNodeScore(entry, engagementScore);
    entry.lastUpdated = now; // Mark as recently updated.

    // If skips still >= threshold, zero score and set reentryAt
    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0;
      entry.reentryAt = computeReentryAt();
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  // --- Case 2: Creator was previously skipped by the user ---
  let skippedIdx = skippedCreators.findIndex((c) =>
    c.creatorId.equals(creatorId)
  );
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0); // Reduce skip count for positive engagement.
    entry.lastSkipUpdate = now; // Update timestamp.

    // If skips fall below the threshold (meaning the user is now engaging with them again)...
    if (entry.skips < SKIP_THRESHOLD) {
      // And if the cool-off period has passed (or never set)...
      if (Date.now() >= (entry.reentryAt?.getTime() || 0)) {
        skippedCreators.splice(skippedIdx, 1); // Remove from `skippedCreatorsPool`.

        // Move to `watchedCreatorsPool` as a milder form of interest.
        user.creatorsInterests.watchedCreatorsPool.push({
          creatorId: creatorId,
          skips: entry.skips,
          lastSkipUpdate: new Date(now),
          reentryAt: new Date(now), // Reset reentryAt
        });

        await user.save({ validateBeforeSave: false });
        return;
      }

      // If skips are below threshold but reentry time hasn't passed, just save and exit.
      await user.save({ validateBeforeSave: false });
      return;
    } else {
      // If skips are still >= threshold even after decrement, update reentry time
      // to keep them in the skipped pool longer.
      entry.reentryAt = computeReentryAt();
      await user.save({ validateBeforeSave: false });
      return;
    }
  }

  // --- Case 3: Creator is in the general 'watched' pool ---
  let watchedIdx = watchedCreators.findIndex((c) =>
    c.creatorId.equals(creatorId)
  );

  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0); // Reduce skips.
    entry.lastSkipUpdate = now;

    // If skips reach zero, remove from `watchedCreatorsPool` as they are
    // now a positively engaged creator ready to potentially enter top/rising.
    if (entry.skips === 0) {
      watchedCreators.splice(watchedIdx, 1);
    } else {
      // If skips are still positive, just save and exit.
      await user.save({ validateBeforeSave: false });
      return;
    }
  }

  // --- Case 4: Creator is not explicitly followed, skipped, or in watched pool ---
  // This means it's a new or previously unknown creator for whom the user has just engaged.
  // Find or initialize the creator node within the `topCreators` or `risingCreators` pools.
  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId.toString(),
    {
      creatorId: creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0, // Initialize skips to 0 for new engagement.
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" } // Specify the key for finding/initializing.
  );

  // Update the creator's score with the positive engagement.
  updateNodeScore(creator, engagementScore);

  // Insert/reposition the creator into the `topCreators` or `risingCreators` pools
  // based on its score and the configured maximum limits.
  insertIntoPools(
    topCreators,
    risingCreators,
    TOP_CREATOR_MAX,
    RISING_CREATOR_MAX,
    creator,
    { key: "creatorId" }
  );

  // Save the updated creator interest pools back to the user document.
  user.creatorsInterests.topCreators = topCreators;
  user.creatorsInterests.risingCreators = risingCreators;
  await user.save({ validateBeforeSave: false });
}

/**
 * Handles a user's "skip" action for a specific creator, applying negative weight
 * and managing the creator's status across different interest pools.
 *
 * @param {string} userId - The ID of the user performing the skip.
 * @param {mongoose.Types.ObjectId} creatorId - The ID of the creator being skipped.
 */
export async function skipCreatorDB(userId, creatorId) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const ci = user.creatorsInterests;
  const topCreators = ci.topCreators;
  const risingCreators = ci.risingCreators;
  const watchedCreators = ci.watchedCreatorsPool;
  const skippedCreators = ci.skippedCreatorsPool;
  const now = Date.now();

  // --- Case 1: Creator is being followed by the user ---
  const followIndex = user.following.findIndex((f) =>
    f.userId.equals(creatorId)
  );

  if (followIndex !== -1) {
    const entry = user.following[followIndex];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Increment skip count.
    entry.lastSkipAt = now; // Record the time of this skip.
    entry.score = updateNodeScore(entry, SKIP_WEIGHT); // Apply negative score.
    entry.lastUpdated = now; // Mark as recently updated.

    // If the number of skips reaches the threshold, "hide" the creator temporarily.
    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0; // Set score to zero to remove immediate recommendation.
      entry.reentryAt = computeReentryAt(); // Set a cool-off period.
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  // --- Case 2: Creator is already in the `skippedCreatorsPool` ---
  let skippedIdx = skippedCreators.findIndex((c) =>
    c.creatorId.equals(creatorId)
  );

  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Further increment skip count.
    entry.lastSkipUpdate = now; // Update timestamp.
    entry.reentryAt = computeReentryAt(); // Reset/extend the cool-off period.
    await user.save({ validateBeforeSave: false });
    return;
  }

  // --- Case 3: Creator is in the `watchedCreatorsPool` ---
  let watchedIdx = watchedCreators.findIndex((c) =>
    c.creatorId.equals(creatorId)
  );

  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD); // Increment skip count.
    entry.lastSkipUpdate = now;

    // If skips reach the threshold, move from `watchedCreatorsPool` to `skippedCreatorsPool`.
    if (entry.skips >= SKIP_THRESHOLD) {
      watchedCreators.splice(watchedIdx, 1); // Remove from watched.
      skippedCreators.push({
        creatorId: creatorId,
        skips: entry.skips,
        lastSkipUpdate: new Date(now),
        reentryAt: computeReentryAt(), // Set reentry time for the skipped pool.
      });
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  // --- Case 4: Creator is in `topCreators` or `risingCreators` (or a completely new creator) ---
  // Find or initialize the creator node.
  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId.toString(),
    {
      creatorId: creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0,
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" }
  );

  creator.skips = Math.min((creator.skips || 0) + 1, SKIP_THRESHOLD); // Increment skip count for this creator.
  creator.lastSkipAt = Date.now(); // Record time of skip.
  updateNodeScore(creator, SKIP_WEIGHT); // Apply negative score to the creator.

  // If the total skips for this creator reach skip threshold
  // remove from top/rising and add to skipped pool.
  if (creator.skips >= SKIP_THRESHOLD) {
    // Remove from top/rising pools.
    user.creatorsInterests.topCreators = topCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    user.creatorsInterests.risingCreators = risingCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );

    // Move to `skippedCreatorsPool` indefinitely (or with a default reentry).
    skippedCreators.push({
      creatorId,
      skips: creator.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: computeReentryAt(),
    });
    user.creatorsInterests.skippedCreatorsPool = skippedCreators;
    await user.save({ validateBeforeSave: false });
    return;
  }

  // If score drops to 0 or below AND at least one skip, move to `watchedCreatorsPool`.
  // This means it's not a strong interest, but not fully "skipped" yet.
  if (creator.score <= 0 && creator.skips >= 1) {
    user.creatorsInterests.topCreators = topCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    user.creatorsInterests.risingCreators = risingCreators.filter(
      (c) => c.creatorId.toString() !== creatorId.toString()
    );
    watchedCreators.push({
      creatorId,
      skips: creator.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: Date.now(),
    });
    user.creatorsInterests.watchedCreatorsPool = watchedCreators;
    await user.save({ validateBeforeSave: false });
    return;
  }

  // If none of the above conditions met (i.e., score is still positive after skip
  // or skips < 10 but not yet 0 score), re-insert into top/rising pools.
  insertIntoPools(
    topCreators,
    risingCreators,
    TOP_CREATOR_MAX,
    RISING_CREATOR_MAX,
    creator,
    { key: "creatorId" }
  );

  user.creatorsInterests.topCreators = topCreators;
  user.creatorsInterests.risingCreators = risingCreators;
  await user.save({ validateBeforeSave: false });
}
