// models/userInterestStatsModel.js

import mongoose from "mongoose";

const userInterestStatsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ["category", "subcategory"],
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    impressionCount: {
      type: Number,
      default: 0,
    },
    totalEngagement: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: false,
  }
);

// Unique per user+entityType+name
userInterestStatsSchema.index(
  { userId: 1, entityType: 1, name: 1 },
  { unique: true }
);

const UserInterestStats = mongoose.model(
  "UserInterestStats",
  userInterestStatsSchema
);

export default UserInterestStats;
