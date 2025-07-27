/**
 * @file constants.js
 * @description
 * This file centralizes the maximum capacities for various "top" and "rising"
 * content pools within the recommendation system. Think of these as the 'slots'
 * available in a user's interest profile for different types of content or categories.
 *
 * Why do we need these?
 * In a dynamic recommendation system, we can't just keep adding every single
 * item a user interacts with to their 'top' lists. These limits ensure:
 * 1.  **Relevance:** Only the most impactful or currently trending items make the cut,
 * keeping the user's profile focused and relevant.
 * 2.  **Performance:** Limiting array sizes prevents them from growing indefinitely,
 * which could impact database query times and memory usage.
 * 3.  **Manageability:** It helps maintain a clear hierarchy and focus for the
 * recommendation algorithms when deciding what to prioritize.
 *
 * These values determine how many categories, subcategories, creators, and
 * specific interests can be held in a user's 'top' or 'rising' personal
 * preference lists at any given time.
 *
 * @see /utils/nodeHelpers.js for how these constants are used with insertIntoPools.
 * @see /services/creatorServiceDB.js and src/services/creatorServiceRedis.js for creator-specific usage.
 * @see /services/interestServiceDB.js and src/services/interestRedis.js for interest-specific usage.
 */

export const TOP_CAT_MAX = 20;
// Represents the maximum number of 'top' interest categories a user can have.

export const RISING_CAT_MAX = 12;
// Defines the maximum number of 'rising' interest categories. These are categories
// where the user's engagement has recently surged, indicating growing interest.

export const TOP_SUB_MAX = 6;
// Sets the cap for 'top' subcategories within any given main interest category.

export const RISING_SUB_MAX = 4;
// Maximum number of 'rising' subcategories. Similar to rising categories,

export const TOP_CREATOR_MAX = 50;
// Specifies the maximum number of 'top' creators for a user. These are the content
// creators whose content the user consistently engages with and enjoys most.

export const RISING_CREATOR_MAX = 25;
// Defines the maximum number of 'rising' creators. These are creators whose
// content the user has recently started engaging with more frequently.

export const SPECIFIC_MAX = 2;
// This limit applies to the most granular level of interests – "specifics".
// -- not fully implemented yet --
