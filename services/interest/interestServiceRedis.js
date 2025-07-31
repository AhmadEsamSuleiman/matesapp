/**
 * @file interestServiceRedis.js
 * @description
 * This file handles the real-time, session-based management of a user's interests
 * (categories, subcategories, and specifics) using Redis. It mirrors the hierarchical
 * and Bayesian scoring logic found in `interestServiceDB.js` but operates on temporary
 * session data to provide immediate feedback and adapt content recommendations within
 * a single user session.
 *
 * The primary goals of this service are:
 * 1.  **Real-time Responsiveness:** Instantly update a user's interest profile
 * in Redis upon every engagement (or skip), allowing the recommendation system
 * to adapt quickly within the current Browse session.
 * 2.  **Performance:** By using Redis (an in-memory data store), these updates
 * are extremely fast, ensuring a fluid user experience without waiting for database writes.
 * 3.  **Bayesian Smoothing (Session Context):** Applies Bayesian smoothing to interest scores,
 * blending a user's session-specific engagement with global and their overall historical
 * engagement (fetched from MongoDB for the prior). This helps provide stable scores
 * even with limited session interactions.
 * 4.  **Dynamic Session Pools:** Manages `topCategories`, `risingCategories`,
 * `topSubs`, `risingSubs`, and `specific` lists directly within the user's
 * Redis session data. Interests move between 'top' and 'rising' pools based
 * on their real-time scores, similar to the DB version but for immediate use.
 * 5.  **Temporary Negative Feedback:** Handles 'skip' actions by reducing interest scores
 * in the session. If an interest's score drops too low, it can be temporarily
 * removed from the session's active pools, preventing immediate re-recommendation
 * of undesired content.
 * 6.  **Session Refresh:** Ensures the updated session data is saved back to Redis
 * and its expiry time is refreshed, maintaining the session's continuity.
 *
 * This service complements `interestServiceDB.js` by providing the immediate,
 * high-speed layer of interest profile management, crucial for a dynamic user feed.
 *
 * @requires ../session/sessionHelpers.js - Utilities for getting/setting session data in Redis.
 * @requires ../utils/nodeHelpers.js - Utility functions for managing nodes (interests) in pools.
 * @requires ../constants/constants.js - Defines capacity limits for 'top' and 'rising' pools.
 * @requires ../utils/smoothingUtils.js - For `choosePriorCount` in Bayesian calculations.
 * @requires ../models/globalStatsModel.js - To fetch global average engagement data.
 * @requires ../models/userInterestStatsModel.js - To fetch a user's historical engagement data.
 * @requires ../constants/scoringConfig.js - For scoring weights like SKIP_WEIGHT.
 * @requires ../session/redisClient.js - The Redis client instance.
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
  TOP_CAT_MAX,
  RISING_CAT_MAX,
  TOP_SUB_MAX,
  RISING_SUB_MAX,
  SPECIFIC_MAX,
} from "../../constants/constants.js";
import { choosePriorCount } from "../../utils/smoothingUtils.js";
import GlobalStats from "../../models/globalStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";

import redis from "../../session/redisClient.js";

/**
 * Updates a user's interest scores in Redis session data based on positive engagement.
 * This function is called frequently to provide real-time adaptation of recommendations.
 *
 * @param {string} userId - The ID of the user.
 * @param {string} sessionId - The current session ID in Redis.
 * @param {string} categoryName - The name of the engaged category.
 * @param {string} [subName] - The name of the engaged subcategory (optional).
 * @param {string} [specificName] - The name of the engaged specific interest (optional).
 * @param {number} engagementScore - The score representing the strength of the user's engagement.
 */

export async function scoreInterestRedis(
  userId,
  sessionId,
  categoryName,
  subName,
  specificName,
  engagementScore
) {
  const sessionData = await getSessionData(sessionId);
  if (!sessionData) {
    // If no session data, either session expired or invalid, nothing to do.
    return;
  }

  // // --- Category Scoring ---

  // Fetch and update global and user-specific stats for the category.
  // These are needed for the Bayesian smoothing to provide a "prior" (global average)
  // and the user's observed engagement for this specific category.
  const globalCat = await GlobalStats.findOneAndUpdate(
    { entityType: "category", name: categoryName },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true }
  );

  const userStatsCat = await UserInterestStats.findOneAndUpdate(
    { userId, entityType: "category", name: categoryName },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true }
  );

  // Extract raw engagement and impression counts from global and user stats.
  const GlobalEngagementScores = globalCat.totalEngagement;
  const GlobalImpressionCount = globalCat.impressionCount;
  const UserEngagementScores = userStatsCat.totalEngagement;
  const UserImpressionCount = userStatsCat.impressionCount;

  // Determine the 'prior count' for Bayesian smoothing. This is a crucial step
  // that decides how much weight the global average should have compared to
  // the user's specific observations. `choosePriorCount` makes this dynamic.
  const priorCountCat = choosePriorCount(GlobalImpressionCount);

  // Calculate the global average engagement score for this category.
  const globalAvgCat =
    GlobalImpressionCount > 0
      ? GlobalEngagementScores / GlobalImpressionCount
      : 0;

  // This is the core Bayesian smoothing formula for the category.
  // It combines the global average (`globalAvgCat`) with the user's specific
  // engagement (`UserEngagementScores` and `UserImpressionCount`), weighted
  // by `priorCountCat`. This provides a stable, context-aware score, especially
  // for categories where the user has limited interactions.
  const smoothedAverageCat =
    (globalAvgCat * priorCountCat + UserEngagementScores) /
    (priorCountCat + UserImpressionCount);

  // Get/initialize category pools from session data.
  const topCategories = sessionData.topCategories || [];
  const risingCategories = sessionData.risingCategories || [];

  // Find or create the category node within the session's interest structure.
  const categoryNode = findOrInitNode(
    topCategories,
    risingCategories,
    categoryName,
    {
      name: categoryName,
      score: 0,
      lastUpdated: Date.now(),
      topSubs: [],
      risingSubs: [],
    },
    { key: "name" }
  );

  // Update the category node's score. This score will decay over time within the session
  // and is influenced by EMA principles as `updateNodeScore` implements them for Redis.
  updateNodeScore(categoryNode, smoothedAverageCat);

  // Re-insert the updated category node into the appropriate session pools (`top` or `rising`).
  insertIntoPools(
    topCategories,
    risingCategories,
    TOP_CAT_MAX,
    RISING_CAT_MAX,
    categoryNode,
    {
      key: "name",
    }
  );

  // Update the session data with the potentially reordered or pruned category lists.
  sessionData.topCategories = topCategories;
  sessionData.risingCategories = risingCategories;

  // --- Subcategory Scoring (if applicable) ---
  const updatedCategoryNode =
    topCategories.find((c) => c.name === categoryName) ||
    risingCategories.find((c) => c.name === categoryName);

  if (subName && updatedCategoryNode) {
    // Similar logic flow as for categories, but applied to subcategories.
    // Fetch and increment global and user-specific stats for the subcategory.
    const globalSub = await GlobalStats.findOneAndUpdate(
      { entityType: "subcategory", name: subName },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true }
    );

    const userStatsSub = await UserInterestStats.findOneAndUpdate(
      { userId, entityType: "subcategory", name: subName },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true }
    );

    // Extract raw engagement and impression counts for the subcategory.
    const GlobalSubEngagementScores = globalSub.totalEngagement;
    const GlobalSubImpressionCount = globalSub.impressionCount;
    const UserSubEngagementScores = userStatsSub.totalEngagement;
    const UserSubImpressionCount = userStatsSub.impressionCount;

    // Determine the 'prior count' for the subcategory's Bayesian smoothing.
    const priorCountSub = choosePriorCount(GlobalSubImpressionCount);

    // Calculate the global average engagement score for this subcategory.
    const globalAvgSub =
      GlobalSubImpressionCount > 0
        ? GlobalSubEngagementScores / GlobalSubImpressionCount
        : 0;

    // Calculate the Bayesian smoothed average for the subcategory.
    const smoothedAvgSub =
      (globalAvgSub * priorCountSub + UserSubEngagementScores) /
      (priorCountSub + UserSubImpressionCount);

    // Get/initialize subcategory pools from the updated category node within session data.
    const topSubsArray = Array.isArray(updatedCategoryNode.topSubs)
      ? updatedCategoryNode.topSubs
      : [];
    const risingSubsArray = Array.isArray(updatedCategoryNode.risingSubs)
      ? updatedCategoryNode.risingSubs
      : [];

    // Find or create the subcategory node in session.
    const subcategoryNode = findOrInitNode(
      topSubsArray,
      risingSubsArray,
      subName,
      {
        name: subName,
        score: 0,
        lastUpdated: Date.now(),
        specific: [],
      },
      { key: "name" }
    );

    // Update the subcategory node's score.
    updateNodeScore(subcategoryNode, smoothedAvgSub);

    // Re-insert into subcategory pools.
    insertIntoPools(
      topSubsArray,
      risingSubsArray,
      TOP_SUB_MAX,
      RISING_SUB_MAX,
      subcategoryNode,
      {
        key: "name",
      }
    );

    // Update the parent category node's subcategory lists in session data.
    updatedCategoryNode.topSubs = topSubsArray;
    updatedCategoryNode.risingSubs = risingSubsArray;

    // --- Specific Interest Scoring (if applicable) ---
    const updatedSubCategoryNode =
      topSubsArray.find((s) => s.name === subName) ||
      risingSubsArray.find((s) => s.name === subName);

    if (specificName && updatedSubCategoryNode) {
      // Get/initialize specific interest pool from the updated subcategory node.
      const specificsArray = Array.isArray(updatedSubCategoryNode.specific)
        ? updatedSubCategoryNode.specific
        : [];

      // Find or create the specific interest node.
      let specificNode = specificsArray.find((x) => x.name === specificName);

      if (!specificNode) {
        specificNode = {
          name: specificName,
          score: 0,
          lastUpdated: Date.now(),
        };
      }

      // Update specific interest score directly with engagementScore (no Bayesian smoothing at this level).
      updateNodeScore(specificNode, engagementScore);

      // Insert into the single 'specific' pool.
      insertIntoPools(specificsArray, [], SPECIFIC_MAX, 0, specificNode, {
        key: "name",
      });

      // Update the parent subcategory node's specific interests list in session data.
      updatedSubCategoryNode.specific = specificsArray;
    }
  }

  console.log(`redis interest scored`);

  // Save the modified session data back to Redis.
  await setSessionData(sessionId, sessionData);

  // Refresh the session's expiry to keep it alive in last access z set as long as user is active.
  await refreshUserSession(sessionId);
}

/**
 * Reduces a user's interest scores in Redis session data when they "skip" content
 * related to that interest. This provides immediate negative feedback within the session.
 *
 * @param {string} userId - The ID of the user.
 * @param {string} sessionId - The current session ID in Redis.
 * @param {string} categoryName - The name of the category skipped.
 * @param {string} [subCategoryName] - The name of the subcategory skipped (optional).
 *
 * @param {string} [specificName] - The name of the specific interest skipped (optional).
 */

export async function skipInterestRedis(
  userId,
  sessionId,
  categoryName,
  subCategoryName,
  specificName
) {
  const session = await getSessionData(sessionId);
  if (!session) return; // If no session, nothing to skip.

  const topCats = session.topCategories || [];
  const risingCats = session.risingCategories || [];

  // Check if the category exists in session pools to avoid unnecessary operations.
  const inTop = topCats.some((c) => c.name === categoryName);
  const inRising = risingCats.some((c) => c.name === categoryName);
  if (!inTop && !inRising) {
    return; // Category not found in session, nothing to do.
  }

  // Find or initialize the category node in the session's data structure.
  const cat = findOrInitNode(
    topCats,
    risingCats,
    categoryName,
    {
      name: categoryName,
      score: 0,
      lastUpdated: Date.now(),
      topSubs: [],
      risingSubs: [],
    },
    { key: "name" }
  );

  // Apply the negative `SKIP_WEIGHT` to the category's score.
  updateNodeScore(cat, SKIP_WEIGHT);

  // If the category's score drops to 0 or below, remove it from session pools immediately.
  if (cat.score <= 0) {
    session.topCategories = topCats.filter((c) => c.name !== categoryName);
    session.risingCategories = risingCats.filter(
      (c) => c.name !== categoryName
    );

    // Save updated session and refresh its expiry.
    await setSessionData(sessionId, session);
    await refreshUserSession(sessionId);
    return;
  } else {
    // Otherwise, re-insert to ensure correct sorting/placement in pools after score reduction.
    insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, cat, {
      key: "name",
    });
  }

  // Retrieve the (potentially moved) category node to access its nested subcategories.
  const updatedCat =
    topCats.find((c) => c.name === categoryName) ||
    risingCats.find((c) => c.name === categoryName);

  // --- Subcategory Skip Processing (if applicable) ---
  if (updatedCat && subCategoryName) {
    // Ensure nested arrays are initialized.
    const topSubs = Array.isArray(updatedCat.topSubs) ? updatedCat.topSubs : [];
    const risingSubs = Array.isArray(updatedCat.risingSubs)
      ? updatedCat.risingSubs
      : [];

    // Find or initialize the subcategory node in session.
    const sub = findOrInitNode(
      topSubs,
      risingSubs,
      subCategoryName,
      {
        name: subCategoryName,
        score: 0,
        lastUpdated: Date.now(),
        specific: [],
      },
      { key: "name" }
    );

    // Apply negative `SKIP_WEIGHT` to subcategory.
    updateNodeScore(sub, SKIP_WEIGHT);

    // If subcategory score drops to 0 or below, remove it from session pools.
    if (sub.score <= 0) {
      updatedCat.topSubs = topSubs.filter((s) => s.name !== subCategoryName);
      updatedCat.risingSubs = risingSubs.filter(
        (s) => s.name !== subCategoryName
      );

      // Propagate changes up to the session and save.
      session.topCategories = topCats;
      session.risingCategories = risingCats;
      await setSessionData(sessionId, session);
      await refreshUserSession(sessionId);
      return;
    } else {
      // Re-insert into subcategory pools.
      insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, sub, {
        key: "name",
      });

      // Update the parent category's subcategory lists in session.
      updatedCat.topSubs = topSubs;
      updatedCat.risingSubs = risingSubs;
    }

    // Retrieve the (potentially moved) subcategory node to access specific interests.
    const updatedSub =
      updatedCat.topSubs.find((s) => s.name === subCategoryName) ||
      updatedCat.risingSubs.find((s) => s.name === subCategoryName);

    // --- Specific Interest Skip Processing (if applicable) ---
    if (updatedSub && specificName) {
      const specArr = Array.isArray(updatedSub.specific)
        ? updatedSub.specific
        : [];

      const spec = specArr.find((x) => x.name === specificName); // Find specific interest.

      if (spec) {
        // Apply negative `SKIP_WEIGHT` to specific interest.
        updateNodeScore(spec, SKIP_WEIGHT);

        // If score drops to 0 or below, remove from specifics array.
        if (spec.score <= 0) {
          updatedSub.specific = specArr.filter((x) => x.name !== specificName);
        } else {
          // Re-insert into specific pool.
          insertIntoPools(updatedSub.specific, [], SPECIFIC_MAX, 0, spec, {
            key: "name",
          });
        }
      }
    }
  }

  // Save the entire modified session data back to Redis after all hierarchical updates.
  session.topCategories = topCats;
  session.risingCategories = risingCats;
  await setSessionData(sessionId, session);
  await refreshUserSession(sessionId);
}
