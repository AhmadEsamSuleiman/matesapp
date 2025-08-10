import { getSessionData, setSessionData, refreshUserSession } from "../../session/sessionHelpers.js";

import { findOrInitNode, updateNodeScore, insertIntoPools } from "../../utils/nodeHelpers.js";

import { TOP_CREATOR_MAX, RISING_CREATOR_MAX } from "../../constants/constants.js";
import { SKIP_WEIGHT } from "../../constants/scoringConfig.js";

const SKIP_THRESHOLD = 10;
const REENTRY_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function computeReentryAtMs() {
  return Date.now() + REENTRY_DURATION_MS;
}

export async function scoreCreatorRedis(userId, sessionId, creatorId, engagementScore) {
  const sessionData = await getSessionData(sessionId);
  if (!sessionData) return;

  const topCreators = Array.isArray(sessionData.topCreators) ? sessionData.topCreators : [];
  const risingCreators = Array.isArray(sessionData.risingCreators) ? sessionData.risingCreators : [];
  const watchedCreators = Array.isArray(sessionData.watchedCreators) ? sessionData.watchedCreators : [];
  const skippedCreators = Array.isArray(sessionData.skippedCreators) ? sessionData.skippedCreators : [];
  const followed = Array.isArray(sessionData.followedCreators) ? sessionData.followedCreators : [];
  const now = Date.now();

  const idxF = followed.findIndex((c) => c.creatorId === creatorId.toString());
  if (idxF !== -1) {
    const entry = followed[idxF];

    if ((entry.skips || 0) > 0) {
      entry.skips = Math.max((entry.skips || 1) - 1, 0);
      entry.lastSkipAt = now;
    }

    const newScore = updateNodeScore(entry, engagementScore);
    entry.score = newScore;
    entry.lastUpdated = now;

    sessionData.followedCreators = followed;

    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  const skippedIdx = skippedCreators.findIndex((c) => c.creatorId === creatorId.toString());
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];

    entry.skips = Math.max((entry.skips || 1) - 1, 0);
    entry.lastSkipUpdate = now;

    if (entry.skips < SKIP_THRESHOLD) {
      if (now >= (entry.reentryAt || 0)) {
        skippedCreators.splice(skippedIdx, 1);
        watchedCreators.push({
          creatorId,
          skips: entry.skips,
          lastSkipUpdate: now,
          reentryAt: now,
        });
        sessionData.skippedCreators = skippedCreators;
        sessionData.watchedCreators = watchedCreators;

        await setSessionData(sessionId, sessionData);
        await refreshUserSession(sessionId);
        return;
      }

      sessionData.skippedCreators = skippedCreators;

      await setSessionData(sessionId, sessionData);
      await refreshUserSession(sessionId);
      return;
    }

    entry.reentryAt = computeReentryAtMs();
    sessionData.skippedCreators = skippedCreators;

    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  const watchedIdx = watchedCreators.findIndex((c) => c.creatorId === creatorId.toString());
  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.max((entry.skips || 1) - 1, 0);
    entry.lastSkipUpdate = now;

    if (entry.skips === 0) {
      watchedCreators.splice(watchedIdx, 1);
      sessionData.watchedCreators = watchedCreators;
    } else {
      sessionData.watchedCreators = watchedCreators;

      await setSessionData(sessionId, sessionData);
      await refreshUserSession(sessionId);
      return; // Exit.
    }
  }

  const creator = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId,
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

  sessionData.topCreators = topCreators;
  sessionData.risingCreators = risingCreators;

  await setSessionData(sessionId, sessionData);
  await refreshUserSession(sessionId);
}

export async function skipCreatorRedis(sessionId, creatorId) {
  const sessionData = await getSessionData(sessionId);
  if (!sessionData) return;

  const topCreators = Array.isArray(sessionData.topCreators) ? sessionData.topCreators : [];
  const risingCreators = Array.isArray(sessionData.risingCreators) ? sessionData.risingCreators : [];
  const watchedCreators = Array.isArray(sessionData.watchedCreators) ? sessionData.watchedCreators : [];
  const skippedCreators = Array.isArray(sessionData.skippedCreators) ? sessionData.skippedCreators : [];
  const followed = Array.isArray(sessionData.followedCreators) ? sessionData.followedCreators : [];
  const now = Date.now();

  const idxF = followed.findIndex((c) => c.creatorId === creatorId.toString());
  if (idxF !== -1) {
    const entry = followed[idxF];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipAt = now;
    entry.score = updateNodeScore(entry, SKIP_WEIGHT);
    entry.lastUpdated = now;

    if (entry.skips >= SKIP_THRESHOLD) {
      entry.score = 0;
      entry.reentryAt = computeReentryAtMs();
    }
    sessionData.followedCreators = followed;
    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  const skippedIdx = skippedCreators.findIndex((c) => c.creatorId === creatorId.toString());
  if (skippedIdx !== -1) {
    const entry = skippedCreators[skippedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipUpdate = now;
    entry.reentryAt = computeReentryAtMs();
    sessionData.skippedCreators = skippedCreators;
    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  const watchedIdx = watchedCreators.findIndex((c) => c.creatorId === creatorId.toString());
  if (watchedIdx !== -1) {
    const entry = watchedCreators[watchedIdx];
    entry.skips = Math.min((entry.skips || 0) + 1, SKIP_THRESHOLD);
    entry.lastSkipUpdate = now;

    if (entry.skips >= SKIP_THRESHOLD) {
      watchedCreators.splice(watchedIdx, 1);
      skippedCreators.push({
        creatorId,
        skips: entry.skips,
        lastSkipUpdate: now,
        reentryAt: computeReentryAtMs(),
      });
    }
    sessionData.watchedCreators = watchedCreators;
    sessionData.skippedCreators = skippedCreators;

    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  const creatorNode = findOrInitNode(
    topCreators,
    risingCreators,
    creatorId,
    {
      creatorId,
      score: 0,
      lastUpdated: Date.now(),
      skips: 0,
      lastSkipAt: Date.now(),
    },
    { key: "creatorId" },
  );
  creatorNode.skips = Math.min((creatorNode.skips || 0) + 1, SKIP_THRESHOLD);
  creatorNode.lastSkipAt = Date.now();
  updateNodeScore(creatorNode, SKIP_WEIGHT);

  if (creatorNode.skips >= SKIP_THRESHOLD) {
    sessionData.topCreators = topCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    sessionData.risingCreators = risingCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    skippedCreators.push({
      creatorId,
      skips: creatorNode.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: computeReentryAtMs(),
    });
    sessionData.skippedCreators = skippedCreators;
    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  if (creatorNode.score <= 0 && creatorNode.skips >= 1) {
    sessionData.topCreators = topCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    sessionData.risingCreators = risingCreators.filter((c) => c.creatorId.toString() !== creatorId.toString());
    watchedCreators.push({
      creatorId,
      skips: creatorNode.skips,
      lastSkipUpdate: Date.now(),
      reentryAt: Date.now(),
    });
    sessionData.watchedCreators = watchedCreators;
    await setSessionData(sessionId, sessionData);
    await refreshUserSession(sessionId);
    return;
  }

  insertIntoPools(topCreators, risingCreators, TOP_CREATOR_MAX, RISING_CREATOR_MAX, creatorNode, { key: "creatorId" });

  sessionData.topCreators = topCreators;
  sessionData.risingCreators = risingCreators;

  await setSessionData(sessionId, sessionData);
  await refreshUserSession(sessionId);
}
