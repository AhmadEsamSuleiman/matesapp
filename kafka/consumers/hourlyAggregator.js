import cron from "node-cron";
import dotenv from "dotenv";
import mongoose from "mongoose";
import kafka from "../kafkaClient.js";
import Post from "../../models/postModel.js";
import updatePostMetricsDB from "../../services/post/postMetricsService.js";
import isEnabled from "../../utils/isRedisEnabled.js";
import redis from "../../session/redisClient.js";

dotenv.config();

const DB = process.env.DB.replace("<db_password>", process.env.DB_PASSWORD);
const TOPIC_NAME = process.env.SCORE_TOPIC || "post-score-events";
const GROUP_ID = "hourly-aggregator";

const MIN_TIME_BETWEEN_UPDATES = 60 * 60 * 1000;
const BUFFER_KEY = "score_buffer";

mongoose
  .connect(DB)
  .then(() => console.log("mongoose connected for hourly aggregator"))
  .catch((err) => {
    console.error("mongoose connection error:", err);
    process.exit(1);
  });

const buffer = new Map();

async function hydrateBuffer() {
  if (!isEnabled() || !redis) return;
  const entries = await redis.hgetall(BUFFER_KEY);
  Object.entries(entries).forEach(([postId, delta]) => {
    buffer.set(postId, Number(delta));
  });
  console.log(`hydrated buffer from Redis: ${buffer.size} entries`);
}

async function handleScoreEvent(message) {
  try {
    const { postId, scoreDelta } = JSON.parse(message.value.toString());
    buffer.set(postId, (buffer.get(postId) || 0) + scoreDelta);
    if (isEnabled() && redis) {
      await redis.hincrbyfloat(BUFFER_KEY, postId, Number(scoreDelta));
    }
  } catch (err) {
    console.error("error buffering malformed event:", err, message.value.toString());
  }
}

async function flushBufferOnShutdown(consumer) {
  console.log("initiating graceful consumer shutdown");
  await consumer.disconnect();
  console.log("consumer disconnected.");

  if (buffer.size > 0) {
    console.log(`processing remaining ${buffer.size} posts before exit`);
    const tasks = Array.from(buffer.entries()).map(([postId, scoreDelta]) =>
      updatePostMetricsDB(postId, [], Date.now(), scoreDelta).catch((err) => {
        console.error(`error in shutdown batch for post ${postId}:`, err);
      }),
    );
    await Promise.all(tasks);
    console.log("final batch processed");
  }

  console.log("exiting");
  process.exit(0);
}

async function startConsumer() {
  await hydrateBuffer();
  const consumer = kafka.consumer({ groupId: GROUP_ID });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC_NAME, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => handleScoreEvent(message),
  });
  console.log("hourly aggregator consumer running");

  process.on("SIGTERM", () => flushBufferOnShutdown(consumer));
  process.on("SIGINT", () => flushBufferOnShutdown(consumer));
}

async function scheduleHourlyJob() {
  cron.schedule("0 * * * *", async () => {
    if (buffer.size === 0) {
      console.log("hourly batch: nothing to process");
      return;
    }

    const nowMs = Date.now();
    console.log(`hourly batch: processing ${buffer.size} posts`);

    const postIds = Array.from(buffer.keys());
    const posts = await Post.find({ _id: { $in: postIds } })
      .select("lastTrendingUpdate")
      .lean();

    const lastUpdateMap = new Map(posts.map((p) => [p._id.toString(), p.lastTrendingUpdate?.getTime() || 0]));

    const updatePromises = postIds
      .filter((postId) => nowMs - (lastUpdateMap.get(postId) || 0) >= MIN_TIME_BETWEEN_UPDATES)
      .map((postId) =>
        updatePostMetricsDB(postId, [], nowMs, buffer.get(postId))
          .then(() => postId)
          .catch((err) => {
            console.error(`error in hourly batch for post ${postId}:`, err);
            return null;
          }),
      );

    const updatedPostIds = await Promise.all(updatePromises);
    const processed = updatedPostIds.filter(Boolean);

    console.log(`- Processed ${processed.length} posts`);

    processed.forEach(async (id) => {
      buffer.delete(id);
      if (isEnabled() && redis) {
        await redis.hdel(BUFFER_KEY, id);
      }
    });

    console.log(`ourly batch complete. Remaining in buffer: ${buffer.size}`);
  });
}

(async () => {
  try {
    await startConsumer();
    scheduleHourlyJob();
  } catch (err) {
    console.error("error in hourlyAggregator:", err);
    process.exit(1);
  }
})();
