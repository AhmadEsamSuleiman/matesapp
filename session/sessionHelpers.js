/**
 * @file utils/sessionHelpers.js
 * @description
 * This module provides essential low-level utility functions for interacting with
 * Redis to manage user session data. It encapsulates the direct Redis commands
 * for setting, retrieving, clearing, and refreshing session-related keys and
 * their activity timestamps.
 *
 * It is a foundational component that enables other modules (e.g., `sessionStart`,
 * `sessionExpiryWorker`, and the engagement controllers) to manage real-time
 * user profiles stored in Redis.
 *
 * @requires ./redisClient.js - The configured Redis client instance.
 * @requires ../constants/sessionConstants.js - Defines constants like `SESSION_TTL_SECONDS`
 * and `SESSION_LAST_ACCESS_ZSET`.
 */

import redis from "./redisClient.js";
// import { SESSION_TTL_SECONDS } from "../constants/sessionConstants.js";
import { SESSION_LAST_ACCESS_ZSET } from "../constants/sessionConstants.js";

/**
 * Stores arbitrary session `data` in Redis under a key derived from `sessionId`.
 * The `data` object is JSON-stringified before being stored as a Redis String.
 *
 * IMPORTANT NOTE ON TTL: this function doesn't set session TTL
 * the session expiry worker will merge the session data to user db data
 * and clear the session
 *
 * @param {string} sessionId - The unique identifier for the user's current session.
 * @param {object} data - The session data object to store. This object will be JSON.stringified.
 */

export async function setSessionData(sessionId, data) {
  const redisKey = `sess:${sessionId}`; // Constructs the Redis key (e.g., "sess:abc123def456").
  const payload = JSON.stringify(data); // Converts the JavaScript object to a JSON string.

  await redis.set(redisKey, payload);
}

/**
 * Retrieves session data from Redis for a given `sessionId`.
 * The raw JSON string retrieved from Redis is parsed back into a JavaScript object.
 *
 * @param {string} sessionId - The unique identifier for the user's session.
 */
export async function getSessionData(sessionId) {
  const redisKey = `sess:${sessionId}`;
  const raw = await redis.get(redisKey); // Fetches the raw JSON string from Redis.
  return raw ? JSON.parse(raw) : null; // Parses the string if data exists, otherwise returns null.
}

/**
 * Clears all data associated with a specific `sessionId` from Redis.
 * This includes deleting the main session key (`sess:<sessionId>`) and
 * removing the session ID from the `SESSION_LAST_ACCESS_ZSET`, effectively
 * ending the session's presence in the real-time store.
 *
 * @param {string} sessionId - The unique identifier of the session to clear.
 * @returns {Promise<void>} A Promise that resolves once the session data is successfully removed.
 */
export async function clearSession(sessionId) {
  const redisKey = `sess:${sessionId}`;
  await redis.del(redisKey); // Deletes the main session key from Redis.
  await redis.zrem(SESSION_LAST_ACCESS_ZSET, sessionId); // Removes the session from the sorted set tracking last accesses.
}

/**
 * Updates the last access timestamp for a session within a Redis sorted set
 * (`SESSION_LAST_ACCESS_ZSET`). This sorted set records the last activity time
 * (Unix timestamp in milliseconds) for each session ID as its score. It is
 * primarily used by the `sessionExpiryWorker` to identify and clean up stale sessions.
 *
 * @param {string} sessionId - The unique identifier for the session whose last access time is being updated.
 */
export async function refreshUserSession(sessionId) {
  const now = Date.now(); // Gets the current Unix timestamp in milliseconds.
  // Adds or updates the session ID in the sorted set with `now` as its score.
  await redis.zadd(SESSION_LAST_ACCESS_ZSET, now, sessionId);
}

// export async function refreshSessionTTL(sessionId) {
//   const redisKey = `sess:${sessionId}`;
//   await redis.expire(redisKey, SESSION_TTL_SECONDS);
// }
