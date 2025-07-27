/**
 * @file utils/interleaveByBucket.js
 * @description This utility file contains a single function, `interleaveByBucket`,
 * which is crucial for structuring the final content feed. It takes a pool of candidate posts,
 * each assigned to a "bucket" (e.g., "TRENDING", "CAT:TOP"), and selects a subset of them.
 * The goal is to create a balanced feed that adheres to a total limit and respects individual bucket limits,
 * ensuring a diverse and engaging user experience rather than being dominated by a single content type.
 * @requires ../constants/feedConstants - Constants defining slot limits for different content buckets.
 */

import {
  SKIP_REENTRY_SLOTS,
  WATCHED_SLOTS,
  INTERESTS_SLOTS,
  CREATORS_SLOTS,
  FOLLOWING_SLOTS,
  TRENDING_SLOTS,
  RISING_SLOTS,
  RECENT_SLOTS,
  EVERGREEN_SLOTS,
  UNKNOWN_SLOTS,
} from "../constants/feedConstants.js";

/**
 * @function interleaveByBucket
 * @description Selects a balanced subset of posts from a list of candidates, prioritizing by score
 * while ensuring a mix from various content "buckets" up to defined capacities. This function
 * implements a "fair share" algorithm to distribute posts evenly across buckets.
 * @param {Array<Object>} candidates - An array of post objects. Each object is expected to have
 * a property representing its score and another for its bucket type.
 * @param {number} nonExploreLimit - The total number of posts to select for the "core" feed,
 * excluding purely random "exploration" posts.
 * @param {string} [scoreKey="overallScore"] - The name of the property on each post object to use for sorting.
 * @param {string} [bucketKey="bucket"] - The name of the property on each post object that defines its content bucket.
 * @returns {Array<Object>} An array of selected post objects, forming the balanced core feed.
 */
export function interleaveByBucket(
  candidates,
  nonExploreLimit,
  scoreKey = "compositeScore",
  bucketKey = "bucket"
) {
  const chosen = []; // Stores the posts selected for the final feed
  const counts = {}; // Keeps track of how many posts have been selected from each bucket
  const pool = candidates.slice(); // Create a shallow copy of candidates to modify

  // Hard caps for the number of posts allowed from each bucket type.
  // These values come from a configuration file (`feedConstants.js`).
  // If a bucket isn't explicitly capped, it defaults to the `nonExploreLimit`.
  const caps = {
    SKIP_REENTRY: SKIP_REENTRY_SLOTS,
    WATCHED: WATCHED_SLOTS,
    "CAT:TOP": INTERESTS_SLOTS,
    "CAT:RISING": INTERESTS_SLOTS,
    "CAT:EXTRA": INTERESTS_SLOTS,
    "CREATOR:TOP": CREATORS_SLOTS,
    "CREATOR:RISING": CREATORS_SLOTS,
    "CREATOR:EXTRA": CREATORS_SLOTS,
    "CREATOR:FOLLOWED": FOLLOWING_SLOTS,
    RISING: RISING_SLOTS,
    TRENDING: TRENDING_SLOTS,
    RECENT: RECENT_SLOTS,
    EVERGREEN: EVERGREEN_SLOTS,
    UNKNOWN: 1,
  };

  // Pre-sort the entire pool of candidates in descending order by their score.
  // This helps when selecting the "best" post among eligible ones.
  pool.sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));

  // Loop until the desired `nonExploreLimit` is reached or no more posts can be chosen
  while (chosen.length < nonExploreLimit && pool.length) {
    // 1. Filter out items whose bucket has already reached its capacity.
    const available = pool.filter((item) => {
      const b = item[bucketKey];
      const used = counts[b] || 0; // Current count for this bucket
      const cap = caps[b] ?? nonExploreLimit; // Max allowed for this bucket
      return used < cap; // Only keep if below capacity
    });

    // If no more posts are available that meet bucket capacity requirements, break.
    if (!available.length) break;

    // 2. Find the minimum usage count among the available buckets.
    // This helps prioritize buckets that are currently under-represented.
    const minCount = Math.min(
      ...available.map((item) => counts[item[bucketKey]] || 0)
    );

    // 3. From the `available` posts, select only those whose bucket usage matches `minCount`.
    // These are the "most eligible" posts as their buckets are the "least filled."
    const eligible = available.filter(
      (item) => (counts[item[bucketKey]] || 0) === minCount
    );

    // 4. Sort the `eligible` posts by their score (descending) to pick the best among them.
    eligible.sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));

    // Select the highest-scoring post from the eligible list
    const pick = eligible[0];
    chosen.push(pick); // Add it to the chosen feed

    const bk = pick[bucketKey];
    counts[bk] = (counts[bk] || 0) + 1; // Increment the count for its bucket

    // Remove the chosen post from the `pool` to avoid re-selection
    const idx = pool.indexOf(pick);
    pool.splice(idx, 1);
  }

  return chosen; // Return the final balanced selection
}
