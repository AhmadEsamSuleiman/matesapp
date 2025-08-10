import { getSessionData, setSessionData, refreshUserSession } from "../../session/sessionHelpers.js";
import { findOrInitNode, updateNodeScore, insertIntoPools } from "../../utils/nodeHelpers.js";
import { TOP_CAT_MAX, RISING_CAT_MAX, TOP_SUB_MAX, RISING_SUB_MAX, SPECIFIC_MAX } from "../../constants/constants.js";
import choosePriorCount from "../../utils/smoothingUtils.js";
import GlobalStats from "../../models/globalStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";

export async function scoreInterestRedis(userId, sessionId, categoryName, subName, specificName, engagementScore) {
  const sessionData = await getSessionData(sessionId);
  if (!sessionData) {
    return;
  }

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

  const smoothedAverageCat = (globalAvgCat * priorCountCat + UserEngagementScores) / (priorCountCat + UserImpressionCount);

  const topCategories = sessionData.topCategories || [];
  const risingCategories = sessionData.risingCategories || [];

  const categoryNode = findOrInitNode(
    topCategories,
    risingCategories,
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

  updateNodeScore(categoryNode, smoothedAverageCat);

  insertIntoPools(topCategories, risingCategories, TOP_CAT_MAX, RISING_CAT_MAX, categoryNode, {
    key: "name",
  });

  sessionData.topCategories = topCategories;
  sessionData.risingCategories = risingCategories;

  const updatedCategoryNode = topCategories.find((c) => c.name === categoryName) || risingCategories.find((c) => c.name === categoryName);

  if (subName && updatedCategoryNode) {
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

    const topSubsArray = Array.isArray(updatedCategoryNode.topSubs) ? updatedCategoryNode.topSubs : [];
    const risingSubsArray = Array.isArray(updatedCategoryNode.risingSubs) ? updatedCategoryNode.risingSubs : [];

    const subcategoryNode = findOrInitNode(
      topSubsArray,
      risingSubsArray,
      subName,
      {
        name: subName,
        score: 0,
        lastUpdated: Date.now(),
        specific: [],
      },
      { key: "name" },
    );

    updateNodeScore(subcategoryNode, smoothedAvgSub);

    insertIntoPools(topSubsArray, risingSubsArray, TOP_SUB_MAX, RISING_SUB_MAX, subcategoryNode, {
      key: "name",
    });

    updatedCategoryNode.topSubs = topSubsArray;
    updatedCategoryNode.risingSubs = risingSubsArray;

    const updatedSubCategoryNode = topSubsArray.find((s) => s.name === subName) || risingSubsArray.find((s) => s.name === subName);

    if (specificName && updatedSubCategoryNode) {
      const specificsArray = Array.isArray(updatedSubCategoryNode.specific) ? updatedSubCategoryNode.specific : [];

      let specificNode = specificsArray.find((x) => x.name === specificName);

      if (!specificNode) {
        specificNode = {
          name: specificName,
          score: 0,
          lastUpdated: Date.now(),
        };
      }

      updateNodeScore(specificNode, engagementScore);

      insertIntoPools(specificsArray, [], SPECIFIC_MAX, 0, specificNode, {
        key: "name",
      });

      updatedSubCategoryNode.specific = specificsArray;
    }
  }

  await setSessionData(sessionId, sessionData);

  await refreshUserSession(sessionId);
}

export async function skipInterestRedis(userId, sessionId, categoryName, subCategoryName, specificName) {
  const sessionData = await getSessionData(sessionId);
  if (!sessionData) return;

  const topCats = sessionData.topCategories || [];
  const risingCats = sessionData.risingCategories || [];

  const inTop = topCats.some((c) => c.name === categoryName);
  const inRising = risingCats.some((c) => c.name === categoryName);
  if (!inTop && !inRising) {
    return;
  }

  const cat = findOrInitNode(
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

  updateNodeScore(cat, SKIP_WEIGHT);

  if (cat.score <= 0) {
    sessionData.topCategories = topCats.filter((c) => c.name !== categoryName);
    sessionData.risingCategories = risingCats.filter((c) => c.name !== categoryName);

    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  insertIntoPools(topCats, risingCats, TOP_CAT_MAX, RISING_CAT_MAX, cat, {
    key: "name",
  });

  const updatedCat = topCats.find((c) => c.name === categoryName) || risingCats.find((c) => c.name === categoryName);

  if (updatedCat && subCategoryName) {
    const topSubs = Array.isArray(updatedCat.topSubs) ? updatedCat.topSubs : [];
    const risingSubs = Array.isArray(updatedCat.risingSubs) ? updatedCat.risingSubs : [];

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

    updateNodeScore(sub, SKIP_WEIGHT);

    if (sub.score <= 0) {
      updatedCat.topSubs = topSubs.filter((s) => s.name !== subCategoryName);
      updatedCat.risingSubs = risingSubs.filter((s) => s.name !== subCategoryName);

      sessionData.topCategories = topCats;
      sessionData.risingCategories = risingCats;
      await setSessionData(sessionId, sessionData);
      await refreshUserSession(sessionId);
      return;
    }

    insertIntoPools(topSubs, risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, sub, {
      key: "name",
    });

    updatedCat.topSubs = topSubs;
    updatedCat.risingSubs = risingSubs;

    const updatedSub =
      updatedCat.topSubs.find((s) => s.name === subCategoryName) || updatedCat.risingSubs.find((s) => s.name === subCategoryName);

    if (updatedSub && specificName) {
      const specArr = Array.isArray(updatedSub.specific) ? updatedSub.specific : [];

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

  sessionData.topCategories = topCats;
  sessionData.risingCategories = risingCats;

  await setSessionData(sessionId, sessionData);
  await refreshUserSession(sessionId);
}
