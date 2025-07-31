/**
 * @file score.js
 * @description This file contains core functions for calculating decayed scores and updating scores using
 * an Exponential Moving Average (EMA). These functions are fundamental to how content relevance
 * and user interests are maintained over time within the recommendation system.
 * @requires ./../constants/scoringConfig - Configuration constants related to scoring (EMA alphas, half-life).
 */

import {
  EMA_ALPHA_DB,
  EMA_ALPHA_SESSION,
  MS_PER_DAY,
  HALF_LIFE_DAYS,
} from "./../constants/scoringConfig.js";

/**
 * @function decayedScore
 * @description Calculates the decayed value of an `oldScore` based on the time elapsed since `lastUpdated`.
 * This function models a half-life decay, meaning the score will halve over a specified `HALF_LIFE_DAYS` period.
 * It's used to reduce the relevance of older scores or interests, ensuring recency is factored in.
 * @param {number} oldScore - The initial score value.
 * @param {Date | number} lastUpdated - The timestamp (or Date object) when the `oldScore` was last updated.
 * @returns {number} The decayed score.
 *
 * @formula
 * The decay is calculated using the exponential decay formula.
 */
export function decayedScore(oldScore, lastUpdated) {
  const deltaDays = (Date.now() - new Date(lastUpdated)) / MS_PER_DAY;
  const lambda = Math.log(2) / HALF_LIFE_DAYS;
  return oldScore * Math.exp(-lambda * deltaDays);
}

/**
 * @function emaUpdate
 * @description Updates a score using an Exponential Moving Average (EMA). This function is designed to
 * smoothly incorporate new engagement data into an existing score, giving more weight to recent data
 * while still considering historical values. It supports different smoothing factors for session-level
 * and database-level updates.
 * @param {number} oldScore - The previous score before the update.
 * @param {Date | number} lastUpdated - The timestamp (or Date object) when the `oldScore` was last updated.
 * This is used by `decayedScore` to determine how much the `oldScore` should have decayed.
 * @param {number} newEngagementScore - The score representing the most recent engagement event
 * (e.g., interaction with a post, a new category affinity).
 * @param {"session" | string} [mode="session"] - Determines which EMA alpha constant to use.
 * - `"session"`: Uses `EMA_ALPHA_SESSION` for more immediate, session-based updates (higher alpha, more reactive).
 * - Any other value (or omitted): Uses `EMA_ALPHA_DB` for slower, more stable database updates (lower alpha, smoother).
 * @returns {number} The new EMA-updated score.
 *
 * @formula
 * The new score is calculated using the standard EMA formula.
 */
export function emaUpdate(
  oldScore,
  lastUpdated,
  newEngagementScore,
  mode = "session"
) {
  // Decay the old score first. If oldScore is 0, no decay is applied as there's no historical value.
  const decayed = oldScore !== 0 ? decayedScore(oldScore, lastUpdated) : 0;
  // Choose the appropriate alpha (smoothing factor) based on the mode.
  const alpha = mode === "session" ? EMA_ALPHA_SESSION : EMA_ALPHA_DB;
  // Apply the EMA formula.
  return alpha * newEngagementScore + (1 - alpha) * decayed;
}
