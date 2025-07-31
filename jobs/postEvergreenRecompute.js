/**
 * @file cron/evergreenRecomputeCron.js
 * @description
 * This cron job is responsible for periodically recalculating the
 * `isEvergreen` and `isRising` flags for posts in the database.
 * It's crucial for maintaining the long-term relevance and categorization of content.
 *
 * It focuses on identifying content that has a sustained, long-term appeal (evergreen)
 * versus content that is no longer actively trending.
 *
 * The job runs every 2 hours (at minute 0, hour 0, 2, 4, ..., 22).
 *
 * @requires node-cron - For scheduling the periodic task.
 * @requires ../models/postModel.js - The Mongoose Post model.
 * @requires ../constants/scoringConfig.js - Configuration constants for scoring calculations.
 */

import cron from "node-cron";
import Post from "../models/postModel.js";
import {
  MIN_RAW_FOR_EVERGREEN, // Minimum raw score for a post to be considered for evergreen status.
} from "../constants/scoringConfig.js";

cron.schedule("0 0 */2 * * *", async () => {
  try {
    await Post.updateMany({ rawScore: { $gte: MIN_RAW_FOR_EVERGREEN } }, [
      {
        $set: {
          // Recalculate isEvergreen based on velocity ratios
          isEvergreen: {
            $lt: [
              {
                $cond: [
                  { $gt: ["$historicalVelocityEMA", 0] },
                  {
                    $divide: [
                      "$shortTermVelocityEMA",
                      "$historicalVelocityEMA",
                    ],
                  },
                  1, // If historicalVelocityEMA is 0, default ratio to 1
                ],
              },
              0.01, // If short-term velocity is less than 1% of historical, it's evergreen
            ],
          },
        },
      },
      {
        $set: {
          isRising: {
            $cond: [
              "$isEvergreen", // If the post is now marked as evergreen
              false, // Then it cannot be rising
              "$isRising", // Otherwise, retain its current isRising status (which comes from postMetricsService)
            ],
          },
        },
      },
    ]);

    console.log(
      `[evergreenCron] ${new Date().toISOString()} — evergreen & rising flags updated`
    );
  } catch (err) {
    console.error("[evergreenCron] error updating evergreen flags:", err);
  }
});
