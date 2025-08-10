/**
 * @file constants/sessionConstants.js
 * @description
 * Defines various constants related to user session management and preference blending,
 * particularly for the recommendation system. These values control session lifetime,
 * the blending of user interest scores, and thresholds for content demotion/re-entry.
 */

/**
 * @constant {number} SESSION_TTL_SECONDS
 * @description
 * Time-to-live (TTL) for Redis sessions, in seconds.
 * This defines how long a session remains active in Redis without any user interaction
 * before it's considered expired and eligible for merging into the persistent user profile.
 */
export const SESSION_TTL_SECONDS = 600; // 10 minutes

/**
 * @constant {number} SESSION_TTL_MS
 * @description
 * Time-to-live (TTL) for Redis sessions, in milliseconds.
 */
export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

/**
 * @constant {string} SESSION_LAST_ACCESS_ZSET
 * @description
 * The name of the Redis Sorted Set (ZSET) used to track the last access timestamp
 * for all active sessions. This ZSET is crucial for the `sessionExpiryWorker` to efficiently
 * identify and process expired or inactive sessions based on their last access time.
 */
export const SESSION_LAST_ACCESS_ZSET = "sessions:lastAccess";

/**
 * @constant {number} SESSION_BLEND_ALPHA
 * @description
 * The alpha value (weight) used in the Exponential Moving Average (EMA) blending
 * for merging session-based scores and skip counts into a user's persistent profile.
 * Higher values give more weight to recent session activity,making the profile more reactive.
 * Lower values make it more stable and resistant to rapid changes.
 * Current Value: 0.25 (25% weight to session data).
 */
export const SESSION_BLEND_ALPHA = 0.25;

/**
 * @constant {number} HARSKIP_THRESHOLD
 * @description
 * The number of accumulated "skips" (negative interactions) a creator must reach within a user's profile
 * to trigger a "hard-skip" demotion.
 * Hard-skipped creators are temporarily removed from recommendation pools
 * and face a longer re-entry delay before they can be considered again.
 */
export const HARSKIP_THRESHOLD = 10;

/**
 * @constant {number} WATCHED_THRESHOLD
 * @description
 * The number of accumulated "skips" a content item must reach to trigger a demotion
 * to the "watched" pool. This is a lighter form of demotion than a hard-skip,
 * indicating mild disinterest but not complete rejection. Watched items might still appear, but less frequently.
 */
export const WATCHED_THRESHOLD = 2;

/**
 * @constant {number} REENTRY_DELAY_MS
 * @description
 * The time delay, in milliseconds, before a content item that has been hard-skipped
 * becomes eligible to re-enter positive recommendation pools (e.g., top or rising).
 * This prevents immediately re-recommending content that a user has explicitly shown strong disinterest in.
 */
export const REENTRY_DELAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
