import dotenv from "dotenv";
import mongoose from "mongoose";
import kafka from "../kafkaClient.js";
import Post from "../../models/postModel.js";
import { validateScore } from "../validator.js";

dotenv.config();

const DB = process.env.DB.replace("<db_password>", process.env.DB_PASSWORD);
const TOPIC_NAME = "post-score-events";
const GROUP_ID = "posts-cum-score";

mongoose
  .connect(DB)
  .then(() => console.log("mongoose connected for cumulative consumer"))
  .catch((err) => {
    console.error("mongoose connection error:", err);
    process.exit(1);
  });

async function run() {
  const consumer = kafka.consumer({ groupId: GROUP_ID });
  await consumer.connect();
  await consumer.subscribe({
    topic: TOPIC_NAME,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const raw = JSON.parse(message.value.toString());
        if (!validateScore(raw)) {
          console.error("Skipping invalid score message:", validateScore.errors);
          return;
        }
        const { postId, scoreDelta, timestamp } = raw;

        await Post.updateOne(
          { _id: postId },
          {
            $inc: { cumulativeScore: scoreDelta },
            $set: { lastScoreUpdatedAt: new Date(timestamp) },
          },
        );
      } catch (err) {
        console.error("error updating cumulativeScore:", err, message.value.toString());
      }
    },
  });

  console.log("cumulative score consumer running");

  const shutdown = async () => {
    console.log("initiating consumer shutdown...");
    await consumer.disconnect();
    console.log("consumer disconnected; exiting.");
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

run().catch((err) => {
  console.error("error in cumulativeConsumer:", err);
  process.exit(1);
});
