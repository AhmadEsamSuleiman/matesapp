import { findOrInitNode, updateNodeScore, insertIntoPools } from "../../utils/nodeHelpers.js";
import { TOP_CREATOR_MAX, RISING_CREATOR_MAX } from "../../constants/constants.js";
import { SKIP_WEIGHT, SKIP_THRESHOLD } from "../../constants/scoringConfig.js";
import User from "../../models/userModel.js";

function computeReentryAt() {
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ONE_WEEK_MS);
}

export async function scoreCreatorDB(userId, creatorId, engagementScore) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const ci = user.creatorsInterests;
  const { topCreators } = ci;
  const { risingCreators } = ci;
  const watchedCreators = ci.watchedCreatorsPool;
  const skippedCreators = ci.skippedCreatorsPool;
  const now = Date.now();

  const followIndex = user.following.findIndex((f) => f.userId.equals(creatorId));
  if (followIndex !== -1) {
    const entry = user.following[followIndex];

    if ((entry.skips || 0) > 0) {
      entry.skips = Math.max((entry.skips || 1) - 1, 0);
      entry.lastSkipAt = now;
    }

    entry.score = updateNodeScore(entry, engagementScore);
    entry.lastUpdated = now;

    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0;
      entry.reentryAt = computeReentryAt();
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  const skippedIdx = skippedCreators.findIndex((c) => c.creatorId.equals(creatorId));
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0);
    entry.lastSkipUpdate = now;

    if (entry.skips < SKIP_THRESHOLD) {
      if (Date.now() >= (entry.reentryAt?.getTime() || 0)) {
        skippedCreators.splice(skippedIdx, 1);

        user.creatorsInterests.watchedCreatorsPool.push({
          creatorId,
          skips: entry.skips,
          lastSkipUpdate: new Date(now),
          reentryAt: new Date(now),
        });

        await user.save({ validateBeforeSave: false });
        return;
      }

      await user.save({ validateBeforeSave: false });
      return;
    }

    entry.reentryAt = computeReentryAt();
    await user.save({ validateBeforeSave: false });
    return;
  }

  const watchedIdx = watchedCreators.findIndex((c) => c.creatorId.equals(creatorId));

  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0);
    entry.lastSkipUpdate = now;

    if (entry.skips === 0) {
      watchedCreators.splice(watchedIdx, 1);
    } else {
      await user.save({ validateBeforeSave: false });
      return;
    }
  }

  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId.toString(),
    {
      creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0,
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" },
  );

  updateNodeScore(creator, engagementScore);

  insertIntoPools(topCreators, risingCreators, TOP_CREATOR_MAX, RISING_CREATOR_MAX, creator, { key: "creatorId" });

  user.creatorsInterests.topCreators = topCreators;
  user.creatorsInterests.risingCreators = risingCreators;
  await user.save({ validateBeforeSave: false });
}

export async function skipCreatorDB(userId, creatorId) {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const ci = user.creatorsInterests;
  const { topCreators } = ci;
  const { risingCreators } = ci;
  const watchedCreators = ci.watchedCreatorsPool;
  const skippedCreators = ci.skippedCreatorsPool;
  const now = Date.now();

  const followIndex = user.following.findIndex((f) => f.userId.equals(creatorId));

  if (followIndex !== -1) {
    const entry = user.following[followIndex];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipAt = now;
    entry.score = updateNodeScore(entry, SKIP_WEIGHT);
    entry.lastUpdated = now;

    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0;
      entry.reentryAt = computeReentryAt();
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  const skippedIdx = skippedCreators.findIndex((c) => c.creatorId.equals(creatorId));

  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipUpdate = now;
    entry.reentryAt = computeReentryAt();
    await user.save({ validateBeforeSave: false });
    return;
  }

  const watchedIdx = watchedCreators.findIndex((c) => c.creatorId.equals(creatorId));

  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipUpdate = now;

    if (entry.skips >= SKIP_THRESHOLD) {
      watchedCreators.splice(watchedIdx, 1);
      skippedCreators.push({
        creatorId,
        skips: entry.skips,
        lastSkipUpdate: new Date(now),
        reentryAt: computeReentryAt(),
      });
    }
    await user.save({ validateBeforeSave: false });
    return;
  }

  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId.toString(),
    {
      creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0,
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" },
  );

  creator.skips = Math.min((creator.skips || 0) + 1, SKIP_THRESHOLD);
  creator.lastSkipAt = Date.now();
  updateNodeScore(creator, SKIP_WEIGHT);

  if (creator.skips >= SKIP_THRESHOLD) {
    user.creatorsInterests.topCreators = topCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    user.creatorsInterests.risingCreators = risingCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());

    skippedCreators.push({
      creatorId,
      skips: creator.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: computeReentryAt(),
    });
    user.creatorsInterests.skippedCreatorsPool = skippedCreators;
    await user.save({ validateBeforeSave: false });
    return;
  }

  if (creator.score <= 0 && creator.skips >= 1) {
    user.creatorsInterests.topCreators = topCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    user.creatorsInterests.risingCreators = risingCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    watchedCreators.push({
      creatorId,
      skips: creator.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: Date.now(),
    });
    user.creatorsInterests.watchedCreatorsPool = watchedCreators;
    await user.save({ validateBeforeSave: false });
    return;
  }

  insertIntoPools(topCreators, risingCreators, TOP_CREATOR_MAX, RISING_CREATOR_MAX, creator, { key: "creatorId" });

  user.creatorsInterests.topCreators = topCreators;
  user.creatorsInterests.risingCreators = risingCreators;
  await user.save({ validateBeforeSave: false });
}
