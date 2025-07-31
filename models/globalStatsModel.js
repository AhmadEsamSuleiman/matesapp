import mongoose from "mongoose";

const globalStatsSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ["category", "subcategory"],
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      index: true,
    },
    impressionCount: {
      type: Number,
      default: 0, // number of events recorded
    },
    totalEngagement: {
      type: Number,
      default: 0, // sum of engagementScore across events
    },
  },
  {
    timestamps: false,
  }
);

// Unique index on entityType + name
globalStatsSchema.index({ entityType: 1, name: 1 }, { unique: true });

const GlobalStats = mongoose.model("GlobalStats", globalStatsSchema);

export default GlobalStats;
