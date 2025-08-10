import mongoose from "mongoose";
import dotenv from "dotenv";
import kafka from "../kafkaClient.js";
import Post from "../../models/postModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import { validateEngagement } from "../validator.js";

dotenv.config();

const DB = process.env.DB.replace("<db_password>", process.env.DB_PASSWORD);

mongoose
  .connect(DB)
  .then(() => console.log("mongoose connected for engagement stats consumer"))
  .catch((err) => {
    console.error("mongoose connection error:", err);
    process.exit(1);
  });

async function run() {
  const consumer = kafka.consumer({ groupId: "engagement-stats" });
  await consumer.connect();
  await consumer.subscribe({
    topic: "engagement-events",
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const raw = JSON.parse(message.value.toString());
        if (!validateEngagement(raw)) {
          console.error("Skipping invalid score message:", validateEngagement.errors);
          return;
        }
        const { postId, userId, category, subCategory, creatorId, engagementScore } = raw;

        const dbUpdates = [
          Post.findByIdAndUpdate(postId, {
            $inc: { impressionCount: 1, engagementSum: engagementScore },
          }),
          GlobalStats.findOneAndUpdate(
            { entityType: "category", name: category },
            { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
            { upsert: true, new: true },
          ),
          UserInterestStats.findOneAndUpdate(
            { userId, entityType: "category", name: category },
            { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
            { upsert: true, new: true },
          ),
          CreatorStats.findOneAndUpdate(
            { creatorId },
            { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
            { upsert: true, new: true },
          ),
        ];

        if (subCategory) {
          dbUpdates.push(
            GlobalStats.findOneAndUpdate(
              { entityType: "subcategory", name: subCategory },
              {
                $inc: { impressionCount: 1, totalEngagement: engagementScore },
              },
              { upsert: true, new: true },
            ),
            UserInterestStats.findOneAndUpdate(
              { userId, entityType: "subcategory", name: subCategory },
              {
                $inc: { impressionCount: 1, totalEngagement: engagementScore },
              },
              { upsert: true, new: true },
            ),
          );
        }

        await Promise.all(dbUpdates);
        console.log(`processed engagement event for post: ${postId}`);
      } catch (err) {
        console.error("error updating engagement stats:", err, message.value.toString());
      }
    },
  });

  console.log("engagement stats consumer running");

  const shutdown = async () => {
    console.log("initiating consumer shutdown");
    await consumer.disconnect();
    console.log("consumer disconnected;exiting.");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

run().catch((err) => {
  console.error("error in engagementStatsConsumer:", err);
  process.exit(1);
});
