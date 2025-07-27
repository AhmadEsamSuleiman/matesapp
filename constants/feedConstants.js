/**
 * @file feedConstants.js
 * @description
 * This file centralizes key constants specifically for the feed generation algorithm.
 * It defines the overall size of a user's personalized feed and, more importantly,
 * how posts from various content "buckets" are allocated within that feed.
 *
 * The goal here is to ensure a balanced and diverse user experience by strategically
 * interleaving content from different sources, such as:
 * - Posts from interests the user follows.
 * - Content by creators the user engages with.
 * - Globally trending and rising posts.
 * - Recently published content.
 * - Posts that are consistently popular (evergreen).
 * - Even posts that were previously skipped but are now eligible for re-entry.
 *
 * These slot allocations are crucial for controlling the mix of content a user sees,
 * balancing personalization with discovery and freshness.
 *
 * @see src/utils/interleaveByBucket.js for the core logic that uses these slots to build the final feed.
 */

export const FEED_SIZE = 20;
// This is the total number of posts that will be included in the user's
// personalized feed. All the 'SLOTS' constants below describe how these
// 14 posts are distributed and filled from different content sources.
// note that the exploration bucket is filled with the remaining slots from the other buckets
// if the user is new and we couldn't fetch enough posts from interests/creators slots etc
// we fill with exploration

export const SKIP_REENTRY_SLOTS = 1;
// This slot is reserved for content from creators that the user
// previously skipped but, after a certain time or new engagement, are now
// eligible to be shown again. It provides a mechanism for re-introducing content
// that might have been temporarily uninteresting.

export const WATCHED_SLOTS = 1;
// This slot is for content from creators or interests that are in a "watched" state.
// This might mean they were recently skipped but are now being monitored for
// potential re-engagement, or are in a probationary period after re-entry.

export const INTERESTS_SLOTS = 3;
// These slots are dedicated to posts that align with the user's top and rising
// interests (categories, subcategories, specific topics). This is where the
// core personalization based on expressed preferences comes in.

export const CREATORS_SLOTS = 2;
// These slots are for posts specifically from the creators that the user
// frequently engages with (their top and rising creators).
// This ensures content from preferred sources is prioritized.

export const FOLLOWING_SLOTS = 2;
// these are slots for posts from creators that the user follows

export const TRENDING_SLOTS = 2;
// These slots are filled with posts that are currently globally popular or
// showing significant activity across a broad user base. This helps users
// stay updated with what's hot and widely discussed.

export const RISING_SLOTS = 1;
// This slot is for posts that are rapidly gaining popularity but might not
// have hit the "trending" threshold yet. It's designed for discovering new,
// emerging content that could soon become very popular.

export const RECENT_SLOTS = 1;
// This slot ensures that the feed includes very recently published posts.
// It keeps the feed fresh and provides a sense of real-time activity,
// preventing it from feeling stale with only older, high-performing content.

export const EVERGREEN_SLOTS = 1;
// This slot is for content that consistently performs well over a long period,
// posts that had very high engagement and was trending for a long time
// but started losing the momentum of high engagement so we marked them evergreen

export const UNKNOWN_SLOTS = 1;
// This slot acts as a flexible wildcard. It can be used to introduce novel content,
// explore new categories/creators that user has never interacted with

export const RECENT_WINDOW_MS = 60 * 60 * 1000;
// Defines the time window (in milliseconds) for what qualifies as "recent" content.
