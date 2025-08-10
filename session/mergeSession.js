/* eslint-disable no-restricted-syntax, no-continue */
import redis from "./redisClient.js";
import User from "../models/userModel.js";
import {
  TOP_CAT_MAX,
  RISING_CAT_MAX,
  TOP_SUB_MAX,
  RISING_SUB_MAX,
  SPECIFIC_MAX,
  TOP_CREATOR_MAX,
  RISING_CREATOR_MAX,
} from "../constants/constants.js";
import { SESSION_BLEND_ALPHA, HARSKIP_THRESHOLD, WATCHED_THRESHOLD, REENTRY_DELAY_MS } from "../constants/sessionConstants.js";
import { findOrInitNode, insertIntoPools } from "../utils/nodeHelpers.js";

function computeNextReentry() {
  return new Date(Date.now() + REENTRY_DELAY_MS);
}

function emaBlend(alpha, oldValue = 0, sessionValue = 0) {
  return (1 - alpha) * oldValue + alpha * sessionValue;
}

function blendSkipCounts(alpha, oldSkips = 0, sessionSkips = 0) {
  return Math.round(emaBlend(alpha, oldSkips, sessionSkips));
}

function blendScores(alpha, oldScore = 0, sessionScore = 0) {
  return emaBlend(alpha, oldScore, sessionScore);
}

async function mergeSessionIntoUser(userId, sessionId) {
  const raw = await redis.get(`sess:${sessionId}`);
  if (!raw) {
    console.warn(`mergeSessionIntoUser: No raw session data found for sid=${sessionId}`);
    return;
  }
  let session;
  try {
    session = JSON.parse(raw);
  } catch (err) {
    console.error(`mergeSessionIntoUser: Failed to parse session JSON for sid=${sessionId}:`, err);
    return;
  }

  if (!session.userId || session.userId !== userId.toString()) {
    console.warn(`mergeSessionIntoUser: Mismatch or missing userId in session data for sid=${sessionId}.`);
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error(`mergeSessionIntoUser: User not found for userId=${userId}`);
  }

  const sessionTopCategories = session.topCategories || [];
  const sessionRisingCategories = session.risingCategories || [];
  const sessionTopCreators = session.topCreators || [];
  const sessionRisingCreators = session.risingCreators || [];
  const sessionWatchedCreators = session.watchedCreators || [];
  const sessionSkippedCreators = session.skippedCreators || [];
  const sessionFollowedCreators = session.followedCreators || [];

  for (const cat of [...sessionTopCategories, ...sessionRisingCategories]) {
    const persistentCat = findOrInitNode(
      user.topInterests,
      user.risingInterests,
      cat.name,
      {
        name: cat.name,
        score: 0,
        lastUpdated: Date.now(),
        lastSkipAt: Date.now(),
        topSubs: [],
        risingSubs: [],
      },
      { key: "name" },
    );

    persistentCat.score = blendScores(persistentCat.score, cat.score, SESSION_BLEND_ALPHA);
    persistentCat.lastUpdated = Date.now();

    insertIntoPools(user.topInterests, user.risingInterests, TOP_CAT_MAX, RISING_CAT_MAX, persistentCat, { key: "name" });

    const liveCat = user.topInterests.find((c) => c.name === cat.name) || user.risingInterests.find((c) => c.name === cat.name);

    if (!liveCat) continue;

    const subs = [...(Array.isArray(cat.topSubs) ? cat.topSubs : []), ...(Array.isArray(cat.risingSubs) ? cat.risingSubs : [])];

    for (const sub of subs) {
      const persistentSub = findOrInitNode(
        liveCat.topSubs,
        liveCat.risingSubs,
        sub.name,
        {
          name: sub.name,
          score: 0,
          lastUpdated: Date.now(),
          lastSkipAt: Date.now(),
          specific: [],
        },
        { key: "name" },
      );
      persistentSub.score = blendScores(persistentSub.score, sub.score, SESSION_BLEND_ALPHA);
      persistentSub.lastUpdated = Date.now();

      insertIntoPools(liveCat.topSubs, liveCat.risingSubs, TOP_SUB_MAX, RISING_SUB_MAX, persistentSub, { key: "name" });

      const liveSub = liveCat.topSubs.find((s) => s.name === sub.name) || liveCat.risingSubs.find((s) => s.name === sub.name);
      if (!liveSub) continue;

      const specifics = Array.isArray(sub.specific) ? sub.specific : [];
      for (const sp of specifics) {
        const persistentSpec = findOrInitNode(
          liveSub.specific,
          [],
          sp.name,
          {
            name: sp.name,
            score: 0,
            lastUpdated: Date.now(),
            skips: 0,
            lastSkipAt: Date.now(),
          },
          { key: "name" },
        );
        persistentSpec.score = blendScores(persistentSpec.score, sp.score, SESSION_BLEND_ALPHA);
        persistentSpec.lastUpdated = Date.now();

        insertIntoPools(liveSub.specific, [], SPECIFIC_MAX, 0, persistentSpec, {
          key: "name",
        });
      }
    }
  }

  const ci = user.creatorsInterests;
  const dbTop = ci.topCreators;
  const dbRise = ci.risingCreators;
  const dbWatch = ci.watchedCreatorsPool;
  const dbSkip = ci.skippedCreatorsPool;
  const dbFollow = user.following;

  const sessionMap = new Map();

  for (const f of sessionFollowedCreators) {
    sessionMap.set(f.creatorId, {
      type: "followed",
      score: f.score || 0,
      skips: f.skips || 0,
      lastUpdated: new Date(f.lastUpdated || Date.now()),
      lastSkipAt: new Date(f.lastSkipUpdate || Date.now()),
    });
  }

  for (const c of [...sessionTopCreators, ...sessionRisingCreators]) {
    if (sessionMap.has(c.creatorId)) continue;
    sessionMap.set(c.creatorId, {
      type: "positive",
      score: c.score || 0,
      skips: 0,
      lastUpdated: new Date(c.lastUpdated || Date.now()),
      lastSkipAt: new Date(Date.now()),
    });
  }

  for (const w of sessionWatchedCreators) {
    if (sessionMap.has(w.creatorId)) continue;
    sessionMap.set(w.creatorId, {
      type: "watched",
      score: 0,
      skips: w.skips || 0,
      lastUpdated: new Date(),
      lastSkipAt: new Date(w.lastSkipUpdate || Date.now()),
    });
  }

  for (const s of sessionSkippedCreators) {
    if (sessionMap.has(s.creatorId)) continue;
    sessionMap.set(s.creatorId, {
      type: "skipped",
      score: 0,
      skips: s.skips || 0,
      lastUpdated: new Date(),
      lastSkipAt: new Date(s.lastSkipUpdate || Date.now()),
    });
  }

  const findById = (arr, id) => arr.find((x) => (x.creatorId || x.userId)?.toString() === id);
  const removeById = (arr, id) => {
    const idx = arr.findIndex((x) => (x.creatorId || x.userId)?.toString() === id);
    if (idx !== -1) arr.splice(idx, 1);
  };

  for (const [creatorId, data] of sessionMap.entries()) {
    const idStr = creatorId.toString();

    const followIndex = dbFollow.findIndex((f) => f.userId.toString() === idStr);
    const dbFollowed = followIndex >= 0 ? dbFollow[followIndex] : null;
    const dbSkippedEntry = findById(dbSkip, idStr);
    const dbWatchedEntry = findById(dbWatch, idStr);
    const dbTopEntry = findById(dbTop, idStr);
    const dbRiseEntry = findById(dbRise, idStr);

    const oldSkips = dbSkippedEntry?.skips ?? dbWatchedEntry?.skips ?? dbTopEntry?.skips ?? dbRiseEntry?.skips ?? dbFollowed?.skips ?? 0;
    const oldScore = dbTopEntry?.score ?? dbRiseEntry?.score ?? dbFollowed?.score ?? 0;

    const newSkips = blendSkipCounts(SESSION_BLEND_ALPHA, oldSkips, data.skips);
    const newScore = blendScores(SESSION_BLEND_ALPHA, oldScore, data.score, SESSION_BLEND_ALPHA);

    if (data.type === "followed") {
      if (dbFollowed) {
        dbFollowed.skips = newSkips;
        dbFollowed.lastSkipAt = data.lastSkipAt;
        dbFollowed.lastUpdated = data.lastUpdated;

        if (newSkips >= HARSKIP_THRESHOLD) {
          dbFollowed.score = 0;
          dbFollowed.reentryAt = computeNextReentry();
        } else {
          dbFollowed.score = newScore;
          dbFollowed.reentryAt = new Date();
        }
      }

      removeById(dbSkip, idStr);
      removeById(dbWatch, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue;
    }

    if (newSkips >= HARSKIP_THRESHOLD) {
      if (dbSkippedEntry) {
        dbSkippedEntry.skips = newSkips;
        dbSkippedEntry.lastSkipUpdate = data.lastSkipAt;
        dbSkippedEntry.reentryAt = computeNextReentry();
      } else {
        dbSkip.push({
          creatorId: idStr,
          skips: newSkips,
          lastSkipUpdate: data.lastSkipAt,
          reentryAt: computeNextReentry(),
        });
      }

      removeById(dbWatch, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue;
    }

    if (newSkips > WATCHED_THRESHOLD) {
      if (dbWatchedEntry) {
        dbWatchedEntry.skips = newSkips;
        dbWatchedEntry.lastSkipUpdate = data.lastSkipAt;
        dbWatchedEntry.reentryAt = new Date();
      } else {
        dbWatch.push({
          creatorId: idStr,
          skips: newSkips,
          lastSkipUpdate: data.lastSkipAt,
          reentryAt: new Date(),
        });
      }

      removeById(dbSkip, idStr);
      removeById(dbTop, idStr);
      removeById(dbRise, idStr);
      continue;
    }

    removeById(dbSkip, idStr);
    removeById(dbWatch, idStr);

    if (data.type === "positive") {
      const persistentCreator = findOrInitNode(
        dbTop,
        dbRise,
        idStr,
        {
          creatorId: idStr,
          score: 0,
          lastUpdated: Date.now(),
          skips: 0,
          lastSkipAt: Date.now(),
        },
        { key: "creatorId" },
      );

      persistentCreator.score = newScore;
      persistentCreator.lastUpdated = data.lastUpdated;
      persistentCreator.skips = 0;
      persistentCreator.lastSkipAt = new Date();

      insertIntoPools(dbTop, dbRise, TOP_CREATOR_MAX, RISING_CREATOR_MAX, persistentCreator, { key: "creatorId" });
    }
  }

  console.log(`session merged successfully for userId: ${userId}`);

  await user.save({ validateBeforeSave: false });
}

export default mergeSessionIntoUser;
/* eslint-enable no-restricted-syntax, no-continue */
