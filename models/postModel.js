import mongoose from "mongoose";
import Category from "./categoryModel.js";

const postSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.ObjectId,
    required: true,
  },
  text: {
    type: String,
  },
  image: {
    type: String,
  },
  likes: {
    type: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    default: [],
  },
  comments: {
    type: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Comment",
      },
    ],
    default: [],
  },
  category: {
    type: String,
    required: true,
  },
  subCategory: {
    type: String,
    required: true,
  },
  specific: {
    type: String,
    default: null,
  },
  impressionCount: {
    type: Number,
    default: 0,
  },
  engagementSum: {
    type: Number,
    default: 0,
  },
  rawScore: { type: Number, default: 0 },
  trendingScore: { type: Number, default: 0 },
  lastTrendingUpdate: { type: Date, default: Date.now },
  historicalVelocityEMA: { type: Number, default: 0 },
  shortTermVelocityEMA: { type: Number, default: 0 },
  bayesianScore: { type: Number, default: 0 },
  isEvergreen: { type: Boolean, default: false },
  cumulativeScore: {
    type: Number,
    default: 0,
  },
  isRising: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastScoreUpdate: { type: Date, default: Date.now },
  lastWindowRoll: {
    type: Date,
    default() {
      return this.createdAt;
    },
  },
  averageViewTime: Number,
});

postSchema.index({
  category: 1,
  subCategory: 1,
  bayesianScore: -1,
  createdAt: -1,
});
postSchema.index({
  category: 1,
  subCategory: 1,
  isRising: 1,
  trendingScore: -1,
  createdAt: -1,
});
postSchema.index({ creator: 1, trendingScore: -1, createdAt: -1 });
postSchema.index({ isRising: 1, trendingScore: -1, createdAt: -1 });
postSchema.index({ isEvergreen: 1, trendingScore: -1, createdAt: -1 });
postSchema.index({ createdAt: -1 });

postSchema.post("save", async (doc, next) => {
  const { category, subCategory } = doc;

  await Category.findOneAndUpdate(
    { category },
    { $addToSet: { subCategories: subCategory } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  next();
});

const Post = mongoose.model("Post", postSchema);

export default Post;
