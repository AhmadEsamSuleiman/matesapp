/**
 * @file utils/smoothingUtils.js
 * @description This utility file provides functions specifically for smoothing and calculating Bayesian
 * average-like scores. These methods are crucial for providing more robust and less volatile metrics,
 * especially for entities with low interaction counts, by incorporating a "prior" belief.
 */

/**
 * @function choosePriorCount
 * @description Determines a "prior count" (or pseudo-count) to be used in Bayesian smoothing calculations.
 * This prior count represents a baseline number of observations that are added to an entity's actual
 * observations. It helps prevent entities with very few impressions from having extreme (and potentially
 * misleading) engagement rates. The prior count grows slowly with the global impressions of an entity,
 * but within defined minimum and maximum bounds.
 * @param {number} globalImpr - The total number of global impressions for a particular entity
 * (e.g., a category, a creator, or a post).
 * @returns {number} An integer representing the pseudo-count, guaranteed to be at least `MIN_PRIOR` and at most `MAX_PRIOR`.
 *
 * @constant {number} MIN_PRIOR - The minimum pseudo-count, used when `globalImpr` is low or zero.
 * @constant {number} MAX_PRIOR - The maximum pseudo-count, to prevent the prior from becoming excessively large.
 *
 */
export function choosePriorCount(globalImpr) {
  const MIN_PRIOR = 20; // minimum pseudo-count
  const MAX_PRIOR = 500; // maximum pseudo-count

  // If there are no global impressions, return the minimum prior to provide a baseline.
  if (!globalImpr || globalImpr <= 0) {
    return MIN_PRIOR;
  }
  // Heuristic: 20 * log10(globalImpr + 1), clamped
  // Math.log10(x) calculates the base-10 logarithm of x.
  // We add 1 to globalImpr to handle cases where globalImpr is very small (e.g., 0 for log).
  const p = Math.floor(20 * Math.log10(globalImpr + 1));
  // Ensure the prior count is within the defined min and max bounds.
  return Math.max(MIN_PRIOR, Math.min(MAX_PRIOR, p));
}
