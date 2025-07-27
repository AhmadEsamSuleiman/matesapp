/**
 * @file services/feedServices.js
 * @description This file provides a collection of utility functions specifically designed for retrieving and
 * processing post data, primarily used by the feed generation logic. These functions abstract away
 * the complexities of database queries and post selection, ensuring consistent data fetching
 * across the recommendation system.
 */

import Post from "../models/postModel.js";

/**
 * @function fetchCandidates
 * @description Fetches a mix of top-performing and random posts based on specified criteria.
 * It's designed to introduce variety by combining highly relevant content with some exploratory items.
 * @param {Object} options - The options object.
 * @param {Object} options.filter - A MongoDB query filter to narrow down the posts.
 * @param {Object} options.sort - A MongoDB sort object to order the "top" posts (e.g., `{ trendingScore: -1 }`).
 * @param {number} options.topLimit - The maximum number of top-sorted posts to retrieve.
 * @param {number} options.rndLimit - The maximum number of random posts to retrieve.
 * @param {string} options.bucket - A string identifier to categorize the fetched posts (e.g., "RISING", "CREATOR:TOP").
 * @returns {Promise<Array<Object>>} An array of post documents, each enriched with a `bucket` property.
 */
export async function fetchCandidates({
  filter,
  sort,
  topLimit,
  rndLimit,
  bucket,
}) {
  const docs = await Post.aggregate([
    { $match: filter }, // Apply the filter to the posts
    {
      // Use $facet to run two independent pipelines on the same input
      $facet: {
        top: [{ $sort: sort }, { $limit: topLimit }], // Get top-sorted posts
        random: [{ $sample: { size: rndLimit } }], // Get random posts
      },
    },
    // Combine the 'top' and 'random' results into a single array
    { $project: { all: { $concatArrays: ["$top", "$random"] } } },
    { $unwind: "$all" }, // Deconstruct the 'all' array to get individual post documents
    { $replaceRoot: { newRoot: "$all" } }, // Promote the post document to the root
  ]);
  // Add the provided bucket tag to each fetched document
  docs.forEach((d) => (d.bucket = bucket));
  return docs;
}

/**
 * @function fetchTop
 * @description Retrieves a specified number of top-sorted posts based on a filter.
 * This is a simpler fetch compared to `fetchCandidates`, focusing purely on the highest-ranked content.
 * @param {Object} options - The options object.
 * @param {Object} options.filter - A MongoDB query filter.
 * @param {number} options.limit - The maximum number of posts to return.
 * @param {Object} options.sort - A MongoDB sort object to order the posts.
 * @param {string} options.bucket - A string identifier to categorize the fetched posts.
 * @returns {Promise<Array<Object>>} An array of post documents, each enriched with a `bucket` property.
 */
export async function fetchTop({ filter, limit, sort, bucket }) {
  const docs = await Post.find(filter).sort(sort).limit(limit).lean();
  // Add the provided bucket tag to each fetched document
  docs.forEach((d) => (d.bucket = bucket));
  return docs;
}

/**
 * @function fetchRandom
 * @description Retrieves a specified number of truly random posts from the database based on a filter.
 * This is used for exploration slots in the feed.
 * @param {Object} options - The options object.
 * @param {Object} options.filter - A MongoDB query filter.
 * @param {number} options.limit - The maximum number of random posts to return.
 * @param {string} options.bucket - A string identifier to categorize the fetched posts.
 * @returns {Promise<Array<Object>>} An array of post documents, each enriched with a `bucket` property.
 */
export async function fetchRandom({ filter, limit, bucket }) {
  const docs = await Post.aggregate([
    { $match: filter }, // Apply the filter
    { $sample: { size: limit } }, // Select random documents
  ]);
  // Add the provided bucket tag to each fetched document
  docs.forEach((d) => (d.bucket = bucket));
  return docs;
}

/**
 * @function pickRandom
 * @description A utility function to select `n` random items from a given array without replacement.
 * @param {Array<any>} arr - The input array from which to pick random elements.
 * @param {number} n - The number of random elements to pick.
 * @returns {Array<any>} An array containing the randomly picked elements.
 */
export function pickRandom(arr, n) {
  const a = arr.slice(), // Create a shallow copy to avoid mutating the original array
    out = [];
  // Loop until 'n' elements are picked or the array is exhausted
  while (out.length < n && a.length) {
    out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  }
  return out;
}

/**
 * @function makeSeenSet
 * @description Constructs a `Set` of post IDs that the user has already seen.
 * This `Set` is used to efficiently filter out duplicate posts when generating the feed.
 * @param {Object} user - The user document that has a `seenPosts` array.
 * @returns {Set<string>} A Set containing the string representation of `_id`s of seen posts.
 */
export function makeSeenSet(user) {
  // Convert each ObjectId to a string for consistent Set operations
  return new Set((user.seenPosts || []).map((id) => id.toString()));
}

/**
 * @function sampleCategory
 * @description Selects posts from a specific category and its subcategories, prioritizing based on
 * user interest signals and post scores, while excluding already seen posts.
 * @param {Object} categoryObj - An object representing a user's interest in a category,
 * @param {Set<string>} seenSet - A `Set` of post IDs (as strings) that should be excluded from the results.
 * @returns {Promise<Array<Object>>} An array of selected post documents from the category.
 */
export async function sampleCategory(categoryObj, seenSet) {
  const result = [];
  const catName = categoryObj.name;

  // 1) TOP SUBCATEGORIES: pick from the top 2 fixed + 1 random extra
  const topTwoSubs = categoryObj.topSubs.slice(0, 2);
  const extraTopSub = pickRandom(categoryObj.topSubs.slice(2), 1);
  const subsToSample = [...topTwoSubs, ...extraTopSub];

  for (const sub of subsToSample) {
    const filter = {
      _id: { $nin: Array.from(seenSet) }, // Exclude already seen posts
      category: catName,
      subCategory: sub.name,
    };

    // Oversample candidates (e.g., 5 best by bayesianScore + 3 random)
    const candidates = await fetchCandidates({
      filter,
      sort: { bayesianScore: -1, createdAt: -1 }, // Prioritize by Bayesian score then creation date
      topLimit: 5, // Fetch up to 5 top posts
      rndLimit: 3, // And 3 random post
      bucket: `INT:${catName}`, // Assign bucket for interleaving
    });

    candidates.forEach((p) => {
      result.push(p);
      seenSet.add(p._id.toString()); // Add fetched post IDs to seenSet
    });
  }

  // 2) RISING SUBCATEGORIES: pick from the top 1 fixed + 1 random extra
  const topOneRising = categoryObj.risingSubs.slice(0, 1);
  const extraRising = pickRandom(categoryObj.risingSubs.slice(1), 1);
  const risingToSample = [...topOneRising, ...extraRising];

  for (const sub of risingToSample) {
    const filter = {
      _id: { $nin: Array.from(seenSet) },
      category: catName,
      subCategory: sub.name,
    };

    // Oversample candidates (e.g., 2 best by trendingScore + 1 random)
    const candidates = await fetchCandidates({
      filter,
      sort: { trendingScore: -1, createdAt: -1 }, // Prioritize by trending score
      topLimit: 5,
      rndLimit: 3,
      bucket: `INT:${catName}`,
    });

    candidates.forEach((p) => {
      result.push(p);
      seenSet.add(p._id.toString());
    });
  }

  return result;
}
