/**
 * @file interestServiceDB.js
 * @description
 * This file provides the backend logic for managing a user's interests (categories,
 * subcategories, and specifics) directly within the MongoDB database. It handles
 * both positive engagement (scoring interests) and negative feedback (skipping interests).
 *
 * The service is responsible for:
 * 1.  **Hierarchical Interest Management:** It operates on a nested structure of
 * interests: Category -> Subcategory -> Specific. When a user engages with
 * content, all relevant levels of interest are updated.
 * 2.  **Bayesian Scoring for Interests:** Similar to post metrics, interest scores
 * are smoothed using a Bayesian approach. This means a user's individual
 * engagement with an interest is blended with the global average engagement
 * for that interest. This is particularly useful for new users or new interests,
 * providing a more stable and representative score from the outset.
 * 3.  **Dynamic Pools (`topInterests`, `risingInterests`, `specific`):**
 * The service actively manages these pools on the `User` document. Based on
 * their scores, interests are moved between "top" (strong, sustained interest)
 * and "rising" (growing interest) pools, ensuring the user's profile
 * reflects their most current and relevant preferences, while respecting
 * maximum capacity limits.
 * 4.  **Negative Feedback Handling:** When a user "skips" an interest (e.g.,
 * by not engaging with content from it), its score is reduced. If the score
 * falls below a certain threshold, the interest can be removed from the user's
 * active pools, preventing irrelevant content from constantly appearing.
 *
 * This service ensures that the user's interest profile is a dynamic, accurate,
 * and up-to-date reflection of their preferences, which is fundamental for
 * delivering personalized content recommendations.
 *
 * @requires ../models/globalStatsModel.js - For global average interest engagement.
 * @requires ../models/userInterestStatsModel.js - For per-user interest engagement.
 * @requires ../models/userModel.js - To update the user's interest pools.
 * @requires ../utils/nodeHelpers.js - Utility functions for managing nodes in pools.
 * @requires ../constants/constants.js - For defining pool size limits.
 * @requires ../constants/scoringConfig.js - For scoring weights like SKIP_WEIGHT.
 * @requires ../utils/smoothingUtils.js - For `choosePriorCount` in Bayesian smoothing.
 */

import GlobalStats from "../../models/globalStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import User from "../../models/userModel.js";
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
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";
import { choosePriorCount } from "../../utils/smoothingUtils.js";

/**
 * Updates a user's interest scores in the database based on engagement with content.
 * This function handles category, subcategory, and specific interest levels hierarchically.
 *
 * @param {string} userId - The ID of the user whose interests are being scored.
 * @param {object} params - An object containing details of the engaged interest.
 * @param {string} params.categoryName - The name of the primary category.
 * @param {string} [params.subName] - The name of the subcategory (optional).
 * @param {string} [params.specificName] - The name of the specific interest (optional).
 * @param {number} params.engagementScore - The calculated engagement score for the interaction.
 */

export async function scoreInterestDB(
  userId,
  { categoryName, subName, specificName, engagementScore }
) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

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
  const smoothedAvgCat =
    (globalAvgCat * priorCountCat + UserEngagementScores) /
    (priorCountCat + UserImpressionCount);

  // Get current top and rising category lists from the user document.
  const topCats = user.topInterests || [];
  const risingCats = user.risingInterests || [];

  // Find the category node in the user's existing pools, or create a new one if it's new.
  // `findOrInitNode` ensures we're working with the correct object reference.
  const catNode = findOrInitNode(
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

  // Update the score of the category node with the newly calculated smoothed average.
  // `updateNodeScore` handles applying the new score and time decay.
  updateNodeScore(catNode, smoothedAvgCat);

  // Re-insert the category node into the appropriate 'top' or 'rising' pool
  // based on its updated score and the defined maximum limits. This function
  // will handle sorting, pruning, and moving nodes between pools.
  insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, catNode, {
    key: "name",
  });

  // Retrieve the updated category node from the possibly modified `topCats` or `risingCats` arrays.
  const updatedCatNode =
    topCats.find((c) => c.name === categoryName) ||
    risingCats.find((c) => c.name === categoryName);

  // --- Subcategory Processing (if a subcategory was provided) ---
  if (subName && updatedCatNode) {
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

    // Get the subcategory pools nested within the `updatedCatNode`.
    const topSubs = updatedCatNode.topSubs || [];
    const risingSubs = updatedCatNode.risingSubs || [];

    // Find or initialize the subcategory node.
    const subNode = findOrInitNode(
      topSubs,
      risingSubs,
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
    updateNodeScore(subNode, smoothedAvgSub);

    // Insert the subcategory node into its respective pools within the category.
    insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, subNode, {
      key: "name",
    });

    // Update the `topSubs` and `risingSubs` arrays on the `updatedCatNode`
    // to reflect any changes made by `insertIntoPools`.
    updatedCatNode.topSubs = topSubs;
    updatedCatNode.risingSubs = risingSubs;

    // Retrieve the updated subcategory node.
    const updatedSubNode =
      topSubs.find((s) => s.name === subName) ||
      risingSubs.find((s) => s.name === subName);

    // --- Specific Interest Processing (if a specific interest was provided) ---
    if (specificName && updatedSubNode) {
      // For specific interests, the current implementation only have a single 'specific' pool.
      const specArr = updatedSubNode.specific || [];

      // If specific interest node doesn't exist, create it.
      let specNode = specArr.find((x) => x.name === specificName);
      if (!specNode) {
        specNode = {
          name: specificName,
          score: 0,
          lastUpdated: Date.now(),
        };
      }

      // Update the specific interest's score directly with the provided `engagementScore`.
      // Bayesian smoothing is not applied at this granular level.
      updateNodeScore(specNode, engagementScore);

      // Insert/manage the specific interest within its pool.
      insertIntoPools(specArr, [], SPECIFIC_MAX, 0, specNode, {
        key: "name",
      });

      // Update the array on the parent subcategory node.
      updatedSubNode.specific = specArr;
    }
  }

  // Finally, save the entire user document with all updated interest pools.
  user.topInterests = topCats;
  user.risingInterests = risingCats;
  await user.save({ validateBeforeSave: false });
}

/**
 * Reduces a user's interest scores in the database when they "skip" content
 * related to that interest. This propagates the negative feedback hierarchically.
 *
 * @param {string} userId - The ID of the user.
 * @param {object} params - An object containing details of the skipped interest.
 * @param {string} params.categoryName - The name of the category skipped.
 * @param {string} [params.subCategoryName] - The name of the subcategory skipped (optional).
 * @param {string} [params.specificName] - The name of the specific interest skipped (optional).
 */

export async function skipInterestDB(
  userId,
  { categoryName, subCategoryName, specificName }
) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const topCats = user.topInterests;
  const risingCats = user.risingInterests;

  // Check if the category is even in the user's active interest pools.
  const inTop = topCats.some((c) => c.name === categoryName);
  const inRising = risingCats.some((c) => c.name === categoryName);

  // If not found, there's nothing to skip for this category, so exit.
  if (!inTop && !inRising) return;

  // Find or initialize the category node. We need to do this even for skips
  // to ensure we get the correct reference and can update its score.
  const cat = findOrInitNode(
    topCats,
    risingCats,
    categoryName,
    {
      score: 0,
      lastUpdated: Date.now(),
      risingSubs: [],
    },
    { key: "name" }
  );

  // Apply the negative `SKIP_WEIGHT` to the category's score.
  updateNodeScore(cat, SKIP_WEIGHT);

  // If the category's score drops to 0 or below after the skip,
  // it's considered no longer interesting, so remove it from the pools.
  if (cat.score <= 0) {
    user.topInterests = topCats.filter((c) => c.name !== categoryName);
    user.risingInterests = risingCats.filter((c) => c.name !== categoryName);
    await user.save({ validateBeforeSave: false });
    return; // Exit as the category is now removed.
  } else {
    // If the score is still positive, re-insert the category into its pools.
    // It might move from 'top' to 'rising' or stay in 'top' but with a lower rank.
    insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, cat, {
      key: "name",
    });
  }

  // Retrieve the updated category node reference after `insertIntoPools` might have shifted it.
  const updatedCat =
    topCats.find((c) => c.name === categoryName) ||
    risingCats.find((c) => c.name === categoryName);

  // --- Subcategory Skip Processing (if a subcategory was provided) ---
  if (updatedCat && subCategoryName) {
    const topSubs = updatedCat.topSubs;
    const risingSubs = updatedCat.risingSubs;

    // Find or initialize the subcategory node within the updated category.
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
    if (sub) {
      // Apply the negative `SKIP_WEIGHT` to the subcategory's score.
      updateNodeScore(sub, SKIP_WEIGHT);

      // If subcategory score drops to 0 or below, remove it from pools.
      if (sub.score <= 0) {
        updatedCat.risingSubs = topSubs.filter(
          (s) => s.name !== subCategoryName
        );
        updatedCat.risingSubs = risingSubs.filter(
          (s) => s.name !== subCategoryName
        );

        // Save the user document immediately since a subcategory was removed.
        user.topInterests = topCats;
        user.risingInterests = risingCats;
        await user.save({ validateBeforeSave: false });
        return; // Exit as the subcategory is now removed.
      } else {
        // Otherwise, re-insert it to ensure correct positioning in pools.
        insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, sub, {
          key: "name",
        });
        updatedCat.risingSubs = risingSubs;
      }

      // Retrieve the updated subcategory node reference.
      const updatedSub =
        topSubs.find((s) => s.name === subCategoryName) ||
        risingSubs.find((s) => s.name === subCategoryName);

      // --- Specific Interest Skip Processing (if a specific interest was provided) ---
      if (updatedSub && specificName) {
        const specArr = updatedSub.specific; // Get the specific interests array.

        const spec = specArr.find((x) => x.name === specificName); // Find the specific interest.

        if (spec) {
          // Apply negative `SKIP_WEIGHT` to the specific interest.
          updateNodeScore(spec, SKIP_WEIGHT);

          // If score drops to 0 or below, remove from the specific array.
          if (spec.score <= 0) {
            updatedSub.specific = specArr.filter(
              (x) => x.name !== specificName
            );
          } else {
            // Otherwise, re-insert into the specific pool. Note: only `top` pool is used for specific.
            insertIntoPools(updatedSub.specific, [], SPECIFIC_MAX, 0, spec, {
              key: "name",
            });
          }
        }
      }
    }
  }

  // Save the entire user document with all updated interest pools
  // after all (potentially nested) updates are complete.
  user.topInterests = topCats;
  user.risingInterests = risingCats;
  await user.save({ validateBeforeSave: false });
}
