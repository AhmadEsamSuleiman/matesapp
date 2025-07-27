/**
 * @file nodeHelpers.js
 * @description
 * This file contains essential utility functions for managing "nodes" within
 * dynamic lists, specifically the 'top' and 'rising' pools used across the
 * recommendation system (e.g., for user interests and creators).
 *
 * These helpers ensure that:
 * 1.  **Consistent Identification:** Nodes (like categories, subcategories, creators)
 * are correctly identified whether their IDs are Mongoose ObjectIds or strings.
 * 2.  **Node Initialization/Retrieval:** Existing nodes can be found in a pair
 * of lists (e.g., top and rising), or a new node can be initialized with default values.
 * 3.  **Score Updates:** Node scores are updated using an Exponential Moving Average (EMA)
 * logic, which smoothly incorporates new engagement while considering past performance.
 * 4.  **Dynamic Pool Management (`insertIntoPools`):** This is the core logic for
 * maintaining the 'top' and 'rising' lists. It intelligently adds new or updated
 * nodes, removes old ones, and demotes nodes between pools based on their score
 * and predefined maximum capacities. This ensures that only the most relevant
 * and currently trending items are kept in a user's profile.
 *
 * These functions are critical for keeping user interest profiles and creator
 * lists fresh, relevant, and within manageable size limits, directly supporting
 * the personalization aspects of the application.
 *
 * @requires ./score.js - For the `emaUpdate` function, which handles score calculations.
 * @requires mongoose - For `ObjectId` comparison and validation.
 */

import { emaUpdate } from "./score.js";
import mongoose from "mongoose";

/**
 * Checks if two identifiers are equal, handling Mongoose ObjectIds, strings,
 * and mixed types robustly. It's designed to compare values that might be
 * Mongoose ObjectIds (which have an `.equals()` method) or plain strings.
 *
 * @param {*} val - The first value to compare.
 * @param {*} identifier - The second value to compare against.
 * @returns {boolean} True if the identifiers are considered equal, false otherwise.
 */
function identifiersEqual(val, identifier) {
  if (val && typeof val.equals === "function") {
    // If 'val' is a Mongoose ObjectId, use its .equals() method for accurate comparison.
    return val.equals(identifier);
  }
  // Fallback: If either is a string or a valid ObjectId (but not necessarily
  // an ObjectId *instance* with .equals), convert both to string for comparison.
  if (
    (typeof val === "string" || mongoose.isValidObjectId(val)) &&
    (typeof identifier === "string" || mongoose.isValidObjectId(identifier))
  ) {
    return val.toString() === identifier.toString();
  }
  // For all other cases (e.g., primitive types like numbers or booleans),
  // perform a direct strict equality comparison.
  return val === identifier;
}

/**
 * Finds an existing node in either of two provided lists (e.g., 'top' and 'rising' arrays)
 * or initializes a new node with default values if not found.
 *
 * @param {Array<Object>} list1 - The primary list to search (e.g., `topCreators`).
 * @param {Array<Object>} list2 - The secondary list to search (e.g., `risingCreators`).
 * @param {string|mongoose.Types.ObjectId} identifier - The value to identify the node (e.g., creator ID, category name).
 * @param {Object} defaults - An object containing default properties for a new node if one needs to be created.
 * @param {{ key: string }} [opts={ key: "name" }] - Options, including `key` which specifies the property
 * on the node objects to use for identification (e.g., 'name' for categories, 'creatorId' for creators).
 * @returns {Object} The found node object, or a newly initialized node object.
 */
export function findOrInitNode(
  list1,
  list2,
  identifier,
  defaults,
  opts = { key: "name" }
) {
  const key = opts.key || "name"; // Determine the key field to use for identification.

  // First, try to find the node in `list1`, then in `list2`.
  let node =
    list1.find((x) => identifiersEqual(x[key], identifier)) ||
    list2.find((x) => identifiersEqual(x[key], identifier));

  if (!node) {
    // If the node isn't found in either list, create a new object.
    // This new object will have the identifier set for its key field,
    // and all other `defaults` properties.
    // Note: The caller is responsible for explicitly adding this new node
    // to a list if it's meant to be stored (e.g., using `insertIntoPools`).
    node = { [key]: identifier, ...defaults };
  }
  return node;
}

/**
 * Updates the score of a given node using an Exponential Moving Average (EMA).
 * This function is designed to smoothly incorporate new engagement scores
 * into an existing score, giving more weight to recent interactions while
 * still considering historical performance. It also updates the `lastUpdated` timestamp.
 *
 * @param {Object} node - The node object whose score needs to be updated. It must have
 * a `score` property (number) and a `lastUpdated` property (Date or timestamp).
 * @param {number} engagementScore - The new engagement score to incorporate into the node's score.
 */
export function updateNodeScore(node, engagementScore) {
  // `emaUpdate` (from score.js) calculates the new score. It takes the old score,
  // the timestamp of the last update, and the new engagement score.
  node.score = emaUpdate(node.score, node.lastUpdated, engagementScore);
  // Update the `lastUpdated` timestamp to the current time, marking when the score was last processed.
  node.lastUpdated = Date.now();
}

/**
 * Helper function to remove an existing candidate (node) from an array in-place.
 * It finds the first occurrence of an item whose `keyField` matches the `identifier`
 * and removes it from the array.
 *
 * @param {Array<Object>} arr - The array from which to remove the candidate.
 * @param {string|mongoose.Types.ObjectId} identifier - The value to match against the `keyField`.
 * @param {string} [keyField="name"] - The property name on the objects in `arr` to use for identification.
 */
function removeExistingCandidate(arr, identifier, keyField = "name") {
  // Find the index of the candidate using `identifiersEqual` for robust comparison.
  const idx = arr.findIndex((x) => identifiersEqual(x[keyField], identifier));
  if (idx !== -1) {
    // If found, remove it from the array.
    arr.splice(idx, 1);
  }
}

/**
 * @function insertIntoPools
 * @description
 * This is the core function for managing and maintaining two sorted lists (pools)
 * of nodes: a `primaryArr` (e.g., 'top' items) and a `secondaryArr` (e.g., 'rising' items).
 * It inserts a `candidate` node into the correct pool based on its score,
 * respecting maximum capacities and ensuring both lists remain sorted.
 *
 * The logic prioritizes the `primaryArr`. If a candidate has a high enough score,
 * it will try to enter or replace an item in the `primaryArr`. If an item is
 * "demoted" from the `primaryArr` (because a higher-scoring candidate took its place),
 * it then attempts to insert into the `secondaryArr`.
 *
 * This function is idempotent: it first removes any existing instance of the
 * `candidate` from both lists before attempting to insert, ensuring no duplicates.
 *
 * @param {Array<Object>} primaryArr - The primary list of nodes (e.g., `user.topInterests`). Modified in-place.
 * @param {Array<Object>} secondaryArr - The secondary list of nodes (e.g., `user.risingInterests`). Modified in-place.
 * @param {number} maxPrimary - The maximum allowed size for `primaryArr`.
 * @param {number} maxSecondary - The maximum allowed size for `secondaryArr`.
 * @param {Object} candidate - The node object to insert. Must have a `score` property and a property matching `opts.key`.
 * @param {{ key: string }} [opts={ key: "name" }] - Options, including `key` for identification.
 */
export function insertIntoPools(
  primaryArr,
  secondaryArr,
  maxPrimary,
  maxSecondary,
  candidate,
  opts = { key: "name" }
) {
  const keyField = opts.key || "name";

  // Step 1: Clean up - Remove any existing occurrences of the candidate from both lists.
  // This ensures that we don't end up with duplicates and that the candidate is
  // re-inserted into its correct, new position based on its updated score.
  removeExistingCandidate(primaryArr, candidate[keyField], keyField);
  removeExistingCandidate(secondaryArr, candidate[keyField], keyField);

  // Step 2: Drop negative-score candidates.
  // If a candidate's score has dropped below zero (e.g., due to skips), it's
  // considered irrelevant and is not inserted into any positive-interest pool.
  if (candidate.score < 0) {
    return;
  }

  // Step 3: Attempt to insert into the primary array.
  // If there's space in the primary array, simply add the candidate and re-sort.
  if (primaryArr.length < maxPrimary) {
    primaryArr.push(candidate);
    primaryArr.sort((a, b) => b.score - a.score); // Sort descending by score.
    return; // Done.
  }

  // Step 4: Primary array is full. Compare candidate with the lowest-scoring item in primary.
  const lowestPrimary = primaryArr[primaryArr.length - 1]; // Get the last (lowest score) item.
  if (candidate.score > lowestPrimary.score) {
    // If the candidate's score is higher than the lowest in primary, replace it.
    primaryArr[primaryArr.length - 1] = candidate; // Replace the lowest item.
    primaryArr.sort((a, b) => b.score - a.score); // Re-sort to maintain order.

    // Now, the old `lowestPrimary` item needs to be demoted to the secondary array.
    if (maxSecondary > 0) {
      // Only attempt demotion if a secondary array is allowed.
      const demoted = lowestPrimary; // The item that was just replaced.

      // Attempt to insert the demoted item into the secondary array.
      if (secondaryArr.length < maxSecondary) {
        secondaryArr.push(demoted);
        secondaryArr.sort((a, b) => b.score - a.score); // Sort secondary.
      } else {
        // If secondary is also full, compare the demoted item with the lowest in secondary.
        const lowestSecondary = secondaryArr[secondaryArr.length - 1];
        if (demoted.score > lowestSecondary.score) {
          secondaryArr[secondaryArr.length - 1] = demoted; // Replace if better.
          secondaryArr.sort((a, b) => b.score - a.score); // Re-sort secondary.
        }
        // If demoted.score is not better than lowestSecondary, it's simply dropped.
      }
    }
    return; // Done.
  }

  // Step 5: Candidate did not make it into the primary array. Try the secondary array.
  if (maxSecondary <= 0) {
    // If no secondary array is allowed, nothing more to do.
    return;
  }
  // If there's space in the secondary array, add the candidate and re-sort.
  if (secondaryArr.length < maxSecondary) {
    secondaryArr.push(candidate);
    secondaryArr.sort((a, b) => b.score - a.score); // Sort descending by score.
    return; // Done.
  }
  // Step 6: Secondary array is also full. Compare candidate with the lowest-scoring item in secondary.
  const lowestSecondary = secondaryArr[secondaryArr.length - 1];
  if (candidate.score > lowestSecondary.score) {
    // If the candidate's score is higher, replace the lowest item in secondary and re-sort.
    secondaryArr[secondaryArr.length - 1] = candidate;
    secondaryArr.sort((a, b) => b.score - a.score);
  }
  // If candidate.score is not better than lowestSecondary, it's simply dropped.
}
