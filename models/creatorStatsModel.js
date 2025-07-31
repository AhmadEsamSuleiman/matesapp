import mongoose from "mongoose";

const creatorStatsSchema = new mongoose.Schema({
  creatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    unique: true,
    index: true,
  },
  impressionCount: { type: Number, default: 0 },
  totalEngagement: { type: Number, default: 0 },
});

const CreatorStats = mongoose.model("CreatorStats", creatorStatsSchema);

export default CreatorStats;
