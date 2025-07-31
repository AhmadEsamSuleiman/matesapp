/**
 * @file cron/decayUserRisingCron.js
 * @description
 * This cron job is responsible for periodically decaying the "rising" scores
 * associated with a user's `topInterests`, `risingInterests`, and `creatorsInterests.risingCreators`.
 * This ensures that a user's rapidly increasing (rising) interests naturally
 * fade over time if not continually reinforced by new engagement, preventing
 * stale "rising" signals from persisting indefinitely.
 *
 * The job runs daily at 03:00 AM (UTC, or local time depending on server config).
 *
 * @requires node-cron - For scheduling the periodic task.
 * @requires ../models/userModel.js - The Mongoose User model.
 */

import cron from "node-cron";
import User from "../models/userModel.js";

/**
 * @constant {number} DECAY_FACTOR
 * @description
 * The factor by which existing "rising" scores (for sub-interests, categories, and creators)
 * are multiplied to simulate time decay. A value less than 1.0 (e.g., 0.80) means the score
 * will decrease by 20% each time the cron job runs.
 * Current Value: 0.80.
 */
const DECAY_FACTOR = 0.9;

/**
 * @event cron.schedule
 * @description
 * Schedules a cron job to run daily at 03:00 AM.
 * This job updates all user documents by applying a decay factor to their
 * `topInterests.risingSubs`, `risingInterests` (including their `risingSubs`),
 * and `creatorsInterests.risingCreators` scores. It also updates the `lastUpdated`
 * timestamp for these decaying scores.
 *
 * **Cron Schedule:** `0 3 * * *`
 * - `0`: At the 0th minute.
 * - `3`: At the 3rd hour (03:00 AM).
 * - `*`: Every day of the month.
 * - `*`: Every month.
 * - `*`: Every day of the week.
 */

cron.schedule("0 3 * * *", async () => {
  try {
    await User.updateMany({}, [
      {
        $set: {
          /**
           * Iterates over each object in the `topInterests` array.
           * For each `topInterest`, it further iterates over its nested `risingSubs` array
           * to apply the `DECAY_FACTOR` to the `score` and update `lastUpdated`.
           */
          topInterests: {
            $map: {
              input: "$topInterests",
              as: "ti", // Alias for each topInterest object
              in: {
                $mergeObjects: [
                  "$$ti", // Retain all existing fields of the topInterest
                  {
                    // Update the risingSubs array within this topInterest
                    risingSubs: {
                      $map: {
                        input: "$$ti.risingSubs",
                        as: "rs", // Alias for each risingSub object
                        in: {
                          $mergeObjects: [
                            "$$rs", // Retain all existing fields of the risingSub
                            {
                              score: {
                                $multiply: ["$$rs.score", DECAY_FACTOR],
                              }, // Decay the score
                              lastUpdated: "$$NOW", // Update timestamp
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },

          /**
           * Iterates over each object in the `risingInterests` array.
           * For each `risingInterest`, it applies the `DECAY_FACTOR` to its own `score`,
           * updates its `lastUpdated` timestamp, and then further iterates over its
           * nested `risingSubs` array to decay their scores and update their timestamps.
           */
          risingInterests: {
            $map: {
              input: "$risingInterests",
              as: "ri", // Alias for each risingInterest object
              in: {
                $mergeObjects: [
                  "$$ri", // Retain all existing fields of the risingInterest
                  {
                    score: { $multiply: ["$$ri.score", DECAY_FACTOR] }, // Decay the primary score of the risingInterest
                    lastUpdated: "$$NOW", // Update its timestamp
                    // Also decay nested risingSubs within this risingInterest
                    risingSubs: {
                      $map: {
                        input: "$$ri.risingSubs",
                        as: "rs", // Alias for each risingSub object
                        in: {
                          $mergeObjects: [
                            "$$rs", // Retain all existing fields
                            {
                              score: {
                                $multiply: ["$$rs.score", DECAY_FACTOR],
                              }, // Decay the score
                              lastUpdated: "$$NOW", // Update timestamp
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
            },
          },

          /**
           * Iterates over each object in the `creatorsInterests.risingCreators` array.
           * For each `risingCreator`, it applies the `DECAY_FACTOR` to its `score`
           * and updates its `lastUpdated` timestamp.
           */
          "creatorsInterests.risingCreators": {
            $map: {
              input: "$creatorsInterests.risingCreators",
              as: "c", // Alias for each risingCreator object
              in: {
                $mergeObjects: [
                  "$$c", // Retain all existing fields of the risingCreator
                  {
                    score: { $multiply: ["$$c.score", DECAY_FACTOR] }, // Decay the score
                    lastUpdated: "$$NOW", // Update timestamp
                  },
                ],
              },
            },
          },
        },
      },
    ]);

    console.log(
      `[decayUserRisingCron] ${new Date().toISOString()} — User rising scores decayed.`
    );
  } catch (err) {
    console.error(
      "[decayUserRisingCron] Error decaying user rising scores:",
      err
    );
  }
});
