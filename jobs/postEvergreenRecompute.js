import cron from "node-cron";
import Post from "../models/postModel.js";
import { MIN_RAW_FOR_EVERGREEN } from "../constants/scoringConfig.js";

cron.schedule("0 0 */2 * * *", async () => {
  try {
    await Post.updateMany({ rawScore: { $gte: MIN_RAW_FOR_EVERGREEN } }, [
      {
        $set: {
          isEvergreen: {
            $lt: [
              {
                $cond: [
                  { $gt: ["$historicalVelocityEMA", 0] },
                  {
                    $divide: ["$shortTermVelocityEMA", "$historicalVelocityEMA"],
                  },
                  1,
                ],
              },
              0.01,
            ],
          },
        },
      },
      {
        $set: {
          isRising: {
            $cond: ["$isEvergreen", false, "$isRising"],
          },
        },
      },
    ]);

    console.log(`[evergreenCron] ${new Date().toISOString()} — evergreen & rising flags updated`);
  } catch (err) {
    console.error("[evergreenCron] error updating evergreen flags:", err);
  }
});
