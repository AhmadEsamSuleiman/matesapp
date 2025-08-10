/**
 * @file scoringConfig.js
 * @description
 * This file contains a critical set of constants that define the "secret sauce"
 * of the application's recommendation, trending, and scoring algorithms.
 * These values determine how content is weighted, how scores decay over time,
 * and how different types of engagement contribute to a post's or user's overall
 * relevance.
 *
 * Think of this file as the configuration panel for your core logic. Adjusting
 * these numbers directly impacts how content trends, how user interests are
 * learned, and how quickly engagement signals influence rankings.
 *
 * - **Engagement Weights:** How much different user actions (like, comment, view) contribute to a post's score.
 * - **Skip/Negative Feedback:** How 'skips' affect scores and thresholds for hiding content.
 * - **Interest/Creator Prioritization:** Relative importance of broad interests vs. specific creators.
 * - **Trending Algorithms:** Parameters for calculating a post's "trending" status,
 * including activity normalization and burst factors.
 * - **Temporal Decay:** How scores naturally decrease over time (half-life),
 * crucial for keeping feeds fresh and prioritizing recent engagement.
 * - **Exponential Moving Averages (EMA):** Alpha values determining the sensitivity of EMA calculations
 * for both session-based and persistent (database) scores.
 * - **Evergreen Content:** Thresholds for identifying content that consistently performs well.
 * - **Rising Content:** Parameters for detecting content that is rapidly gaining popularity.
 * - **Bayesian Prior Smoothing:** Constants for stabilizing scores, especially for new items, by incorporating global average data.
 *
 * Understanding these constants is fundamental to grasping how the recommendation
 * system operates at a mathematical level.
 */

// --- Engagement Scoring Weights ---
export const WEIGHTS = {
  view: 0.5,
  // The base weight for a 'view' action.
  like: 1.0,
  // Weight for a 'like'.
  comment: 2.5,
  // Weight for a 'comment'.
  share: 5.0,
  // Weight for a 'share'.
  completion: 4.0,
  // Weight for a 'completion' (e.g., watching a video entirely).
};

export const SKIP_WEIGHT = -1.5;
// The negative weight applied when a user 'skips' or explicitly signals
// disinterest in a post, creator, or interest. This rapidly decreases its score.

export const SKIP_THRESHOLD = 10;
// If a creator accumulates this many skips, they might be
// temporarily removed from the user's active pools,
// preventing content fatigue from unwanted sources.

// --- Interest and Creator Score Contribution ---
export const INTEREST_WEIGHT = 0.7;
// The relative weight given to a post's relevance to a user's general
// interests (categories, subcategories) when calculating a personalized score.

export const CREATOR_WEIGHT = 0.3;
// The relative weight given to a post's creator when calculating a personalized
// score. This allows the system to balance a user's broad topic interests
// with their specific preferred content creators.

// --- Trending Algorithm Parameters ---
export const TRENDING_WEIGHT = 8.0;
// A multiplier that amplifies how much engagement contributes to a post's trending score.

export const TRENDING_THRESHOLD = 1.5;
// The minimum score a post needs to be officially considered "trending."
// -- not used yet --

export const TRENDING_EXPONENT = 1;
// Controls how sensitive the trending score is to increases in a post's engagement velocity.

export const TRENDING_ACTIVITY_NORMALIZER = 10;
// Used to scale down the raw engagement activity when calculating trending scores.
// It helps prevent small, erratic bursts from disproportionately affecting the score.

export const TRENDING_BURST_FACTOR = 0.5;
// This factor gives an additional boost to posts that experience sudden, rapid increases
// in engagement, helping to quickly identify content that is "going viral."

// --- Temporal Decay Constants (General) ---
export const HALF_LIFE_DAYS = 0.5;
// Defines the half-life in days for general score decay. For example, if
// a score has a half-life of 0.5 days (12 hours), it will lose half its value
// every 12 hours if no new engagement occurs. This keeps scores fresh.

export const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const SHORT_HALF_LIFE_MS = 1 * 60 * 60 * 1000; // 1h
// The half-life for short-term velocity calculations. A shorter half-life
// makes the velocity metric more reactive to very recent changes in engagement,
// useful for detecting "rising" content quickly.

export const LONG_HALF_LIFE_MS = 24 * 60 * 60 * 1000; // 24h
// The half-life for long-term velocity calculations. A longer half-life
// provides a more stable, historical baseline for a post's performance,
// useful for identifying "evergreen" content.

// --- Exponential Moving Average (EMA) Smoothing Factors ---
export const EMA_ALPHA_DB = 0.25;
// The smoothing factor (alpha) for EMA calculations when persisting scores
// to the database. A lower alpha (closer to 0) makes the EMA smoother and
// less responsive to new data, giving more weight to historical values.
// Used for long-term, stable scores.

export const EMA_ALPHA_SESSION = 0.7;
// The smoothing factor (alpha) for EMA calculations within a user's
// active session (e.g., in Redis). A higher alpha (closer to 1) makes
// the EMA more responsive to very recent user actions, providing a
// highly dynamic and real-time reflection of interest during a session.

export const MIN_INITIAL_RISING_WEIGHT = 10;
// min weight to detect rising post if lastUpdatedAt = createdAt

export const MIN_RAW_FOR_EVERGREEN = 1000;
// A minimum cumulative raw score (sum of all engagement weights) a post
// must achieve to even be considered as "evergreen" content. This prevents
// low-engagement posts from being flagged as consistently popular.

export const RISING_WINDOW_MS = 60 * 60 * 1000;
// The time window (in milliseconds) over which recent engagement is
// considered when determining if a post is "rising." Currently 1 hour.

export const RISING_RATE_MULTIPLIER = 2.0;
// A multiplier applied to the comparison between short-term and long-term
// velocities to determine if a post is "rising." If the short-term velocity
// is X times greater than the long-term velocity the post is considered rising.

/**
 * @constant {number} PERSONAL_WEIGHT
 * @description The weight given to the user's personal interest and creator scores in the overall post score.
 * Current Value: 0.5.
 */
export const PERSONAL_WEIGHT = 0.5;

/**
 * @constant {number} RAW_WEIGHT
 * @description The weight given to a post's raw engagement score in the overall post score.
 * Current Value: 0.25.
 */
export const RAW_WEIGHT = 0.25;

/**
 * @constant {number} TREND_WEIGHT
 * @description The weight given to a post's trending score in the overall post score.
 * Current Value: 0.25.
 */
export const TREND_WEIGHT = 0.25;

/**
 * @constant {number} BAYESIAN_WEIGHT
 * @description The weight given to a post's bayesian score in the overall post score.
 * Current Value: 0.15.
 */
export const BAYESIAN_WEIGHT = 0.15;

// --- Bayesian Prior Smoothing Constants ---
export const PRIOR_INITIAL_COUNT = 50;
// The "strength" or initial assumed number of observations for the Bayesian prior.
// A higher number means the prior has more influence on the initial score,
// smoothing out early fluctuations for new items/categories.

export const PRIOR_HALF_LIFE_HOURS = 2;
// The half-life (in hours) used to decay the 'count' of observations for
// Bayesian smoothing. This makes older observations less influential over time.

export const PRIOR_CREATOR_WEIGHT = 0.4;
// The weight given to the creator's average engagement when calculating
// a Bayesian-smoothed score for a post, allowing creator performance to
// influence the score, especially for new posts.

export const PRIOR_MIN_COUNT = 1;
// A minimum count for the prior, ensuring that even with decay, there's
// always at least some statistical weight applied to prevent division by zero
// or undefined behavior.

export const PRIOR_DECAY_LAMBDA = Math.log(2) / (PRIOR_HALF_LIFE_HOURS * 3600 * 1000);
// The pre-calculated decay rate (lambda) for the Bayesian prior count,
// derived from its half-life. This is used in the exponential decay formula.
