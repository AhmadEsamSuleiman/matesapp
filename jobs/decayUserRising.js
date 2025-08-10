import cron from "node-cron";
import User from "../models/userModel.js";

const DECAY_FACTOR = 0.9;

cron.schedule("0 3 * * *", async () => {
  try {
    await User.updateMany({}, [
      {
        $set: {
          topInterests: {
            $map: {
              input: "$topInterests",
              as: "ti",
              in: {
                $mergeObjects: [
                  "$$ti",
                  {
                    risingSubs: {
                      $map: {
                        input: "$$ti.risingSubs",
                        as: "rs",
                        in: {
                          $mergeObjects: [
                            "$$rs",
                            {
                              score: {
                                $multiply: ["$$rs.score", DECAY_FACTOR],
                              },
                              lastUpdated: "$$NOW",
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

          risingInterests: {
            $map: {
              input: "$risingInterests",
              as: "ri",
              in: {
                $mergeObjects: [
                  "$$ri",
                  {
                    score: { $multiply: ["$$ri.score", DECAY_FACTOR] },
                    lastUpdated: "$$NOW",
                    risingSubs: {
                      $map: {
                        input: "$$ri.risingSubs",
                        as: "rs",
                        in: {
                          $mergeObjects: [
                            "$$rs",
                            {
                              score: {
                                $multiply: ["$$rs.score", DECAY_FACTOR],
                              },
                              lastUpdated: "$$NOW",
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

          "creatorsInterests.risingCreators": {
            $map: {
              input: "$creatorsInterests.risingCreators",
              as: "c",
              in: {
                $mergeObjects: [
                  "$$c",
                  {
                    score: { $multiply: ["$$c.score", DECAY_FACTOR] },
                    lastUpdated: "$$NOW",
                  },
                ],
              },
            },
          },
        },
      },
    ]);
  } catch (err) {
    console.error("[decayUserRisingCron] Error decaying user rising scores:", err);
  }
});
