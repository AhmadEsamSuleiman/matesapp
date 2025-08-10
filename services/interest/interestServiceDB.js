import GlobalStats from "../../models/globalStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import User from "../../models/userModel.js";
import { findOrInitNode, updateNodeScore, insertIntoPools } from "../../utils/nodeHelpers.js";
import { TOP_CAT_MAX, RISING_CAT_MAX, TOP_SUB_MAX, RISING_SUB_MAX, SPECIFIC_MAX } from "../../constants/constants.js";
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";
import choosePriorCount from "../../utils/smoothingUtils.js";

export async function scoreInterestDB(userId, { categoryName, subName, specificName, engagementScore }) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const globalCat = await GlobalStats.findOneAndUpdate(
    { entityType: "category", name: categoryName },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true },
  );

  const userStatsCat = await UserInterestStats.findOneAndUpdate(
    { userId, entityType: "category", name: categoryName },
    { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
    { upsert: true, new: true },
  );

  const GlobalEngagementScores = globalCat.totalEngagement;
  const GlobalImpressionCount = globalCat.impressionCount;
  const UserEngagementScores = userStatsCat.totalEngagement;
  const UserImpressionCount = userStatsCat.impressionCount;

  const priorCountCat = choosePriorCount(GlobalImpressionCount);

  const globalAvgCat = GlobalImpressionCount > 0 ? GlobalEngagementScores / GlobalImpressionCount : 0;

  const smoothedAvgCat = (globalAvgCat * priorCountCat + UserEngagementScores) / (priorCountCat + UserImpressionCount);

  const topCats = user.topInterests || [];
  const risingCats = user.risingInterests || [];

  const catNode = findOrInitNode(
    topCats,
    risingCats,
    categoryName,
    {
      name: categoryName,
      score: 0,
      lastUpdated: Date.now(),
      topSubs: [],
      risingSubs: [],
    },
    { key: "name" },
  );

  updateNodeScore(catNode, smoothedAvgCat);

  insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, catNode, {
    key: "name",
  });

  const updatedCatNode = topCats.find((c) => c.name === categoryName) || risingCats.find((c) => c.name === categoryName);

  if (subName && updatedCatNode) {
    const globalSub = await GlobalStats.findOneAndUpdate(
      { entityType: "subcategory", name: subName },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true },
    );

    const userStatsSub = await UserInterestStats.findOneAndUpdate(
      { userId, entityType: "subcategory", name: subName },
      { $inc: { impressionCount: 1, totalEngagement: engagementScore } },
      { upsert: true, new: true },
    );

    const GlobalSubEngagementScores = globalSub.totalEngagement;
    const GlobalSubImpressionCount = globalSub.impressionCount;
    const UserSubEngagementScores = userStatsSub.totalEngagement;
    const UserSubImpressionCount = userStatsSub.impressionCount;

    const priorCountSub = choosePriorCount(GlobalSubImpressionCount);

    const globalAvgSub = GlobalSubImpressionCount > 0 ? GlobalSubEngagementScores / GlobalSubImpressionCount : 0;

    const smoothedAvgSub = (globalAvgSub * priorCountSub + UserSubEngagementScores) / (priorCountSub + UserSubImpressionCount);

    const topSubs = updatedCatNode.topSubs || [];
    const risingSubs = updatedCatNode.risingSubs || [];

    const subNode = findOrInitNode(
      topSubs,
      risingSubs,
      subName,
      {
        name: subName,
        score: 0,
        lastUpdated: Date.now(),
        specific: [],
      },
      { key: "name" },
    );

    updateNodeScore(subNode, smoothedAvgSub);

    insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, subNode, {
      key: "name",
    });

    updatedCatNode.topSubs = topSubs;
    updatedCatNode.risingSubs = risingSubs;

    const updatedSubNode = topSubs.find((s) => s.name === subName) || risingSubs.find((s) => s.name === subName);

    if (specificName && updatedSubNode) {
      const specArr = updatedSubNode.specific || [];

      let specNode = specArr.find((x) => x.name === specificName);
      if (!specNode) {
        specNode = {
          name: specificName,
          score: 0,
          lastUpdated: Date.now(),
        };
      }

      updateNodeScore(specNode, engagementScore);

      insertIntoPools(specArr, [], SPECIFIC_MAX, 0, specNode, {
        key: "name",
      });

      updatedSubNode.specific = specArr;
    }
  }

  user.topInterests = topCats;
  user.risingInterests = risingCats;
  await user.save({ validateBeforeSave: false });
}

export async function skipInterestDB(userId, { categoryName, subCategoryName, specificName }) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const topCats = user.topInterests;
  const risingCats = user.risingInterests;

  const inTop = topCats.some((c) => c.name === categoryName);
  const inRising = risingCats.some((c) => c.name === categoryName);

  if (!inTop && !inRising) return;

  const cat = findOrInitNode(
    topCats,
    risingCats,
    categoryName,
    {
      score: 0,
      lastUpdated: Date.now(),
      risingSubs: [],
    },
    { key: "name" },
  );

  updateNodeScore(cat, SKIP_WEIGHT);

  if (cat.score <= 0) {
    user.topInterests = topCats.filter((c) => c.name !== categoryName);
    user.risingInterests = risingCats.filter((c) => c.name !== categoryName);
    await user.save({ validateBeforeSave: false });
    return;
  }

  insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, cat, {
    key: "name",
  });

  const updatedCat = topCats.find((c) => c.name === categoryName) || risingCats.find((c) => c.name === categoryName);

  if (updatedCat && subCategoryName) {
    const { topSubs } = updatedCat;
    const { risingSubs } = updatedCat;

    const sub = findOrInitNode(
      topSubs,
      risingSubs,
      subCategoryName,
      {
        name: subCategoryName,
        score: 0,
        lastUpdated: Date.now(),
        specific: [],
      },
      { key: "name" },
    );
    if (sub) {
      updateNodeScore(sub, SKIP_WEIGHT);

      if (sub.score <= 0) {
        updatedCat.risingSubs = topSubs.filter((s) => s.name !== subCategoryName);
        updatedCat.risingSubs = risingSubs.filter((s) => s.name !== subCategoryName);

        user.topInterests = topCats;
        user.risingInterests = risingCats;
        await user.save({ validateBeforeSave: false });
        return;
      }

      insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, sub, {
        key: "name",
      });
      updatedCat.risingSubs = risingSubs;

      const updatedSub = topSubs.find((s) => s.name === subCategoryName) || risingSubs.find((s) => s.name === subCategoryName);

      if (updatedSub && specificName) {
        const specArr = updatedSub.specific;

        const spec = specArr.find((x) => x.name === specificName);

        if (spec) {
          updateNodeScore(spec, SKIP_WEIGHT);

          if (spec.score <= 0) {
            updatedSub.specific = specArr.filter((x) => x.name !== specificName);
          } else {
            insertIntoPools(updatedSub.specific, [], SPECIFIC_MAX, 0, spec, {
              key: "name",
            });
          }
        }
      }
    }
  }

  user.topInterests = topCats;
  user.risingInterests = risingCats;
  await user.save({ validateBeforeSave: false });
}
