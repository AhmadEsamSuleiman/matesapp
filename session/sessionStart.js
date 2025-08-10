import redis from "./redisClient.js";
import { setSessionData } from "./sessionHelpers.js";
import { SESSION_LAST_ACCESS_ZSET } from "../constants/sessionConstants.js";

async function startSession(userId, sessionId, UserModel) {
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new Error("User not found");
  }

  const sessionData = { userId: userId.toString() };

  sessionData.topCategories = (user.topInterests || []).map((cat) => ({
    name: cat.name,
    score: cat.score,
    lastUpdated: cat.lastUpdated?.getTime() || Date.now(),
    topSubs: (cat.topSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
    risingSubs: (cat.risingSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
  }));

  sessionData.risingCategories = (user.risingInterests || []).map((cat) => ({
    name: cat.name,
    score: cat.score,
    lastUpdated: cat.lastUpdated?.getTime() || Date.now(),
    topSubs: (cat.topSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
    risingSubs: (cat.risingSubs || []).map((sub) => ({
      name: sub.name,
      score: sub.score,
      lastUpdated: sub.lastUpdated?.getTime() || Date.now(),
      specific: (sub.specific || []).map((sp) => ({
        name: sp.name,
        score: sp.score,
        lastUpdated: sp.lastUpdated?.getTime() || Date.now(),
      })),
    })),
  }));

  sessionData.topCreators = (user.creatorsInterests.topCreators || []).map((c) => ({
    creatorId: c.creatorId.toString(),
    score: c.score,
    skips: c.skips || 0,
    lastSkipUpdate: c.lastSkipAt ? c.lastSkipAt.getTime() : Date.now(),
    lastUpdated: c.lastUpdated?.getTime() || Date.now(),
  }));

  sessionData.risingCreators = (user.creatorsInterests.risingCreators || []).map((c) => ({
    creatorId: c.creatorId.toString(),
    score: c.score,
    skips: c.skips || 0,
    lastSkipUpdate: c.lastSkipAt ? c.lastSkipAt.getTime() : Date.now(),
    lastUpdated: c.lastUpdated?.getTime() || Date.now(),
  }));

  sessionData.watchedCreators = (user.creatorsInterests.watchedCreatorsPool || []).map((c) => ({
    creatorId: c.creatorId.toString(),
    skips: c.skips,
    lastSkipUpdate: c.lastSkipUpdate?.getTime() || Date.now(),
    reentryAt: c.reentryAt?.getTime() || Date.now(),
  }));

  sessionData.skippedCreators = (user.creatorsInterests.skippedCreatorsPool || []).map((c) => ({
    creatorId: c.creatorId.toString(),
    skips: c.skips,
    lastSkipUpdate: c.lastSkipUpdate?.getTime() || Date.now(),
    reentryAt: c.reentryAt?.getTime() || Date.now(),
  }));

  sessionData.followedCreators = (user.following || []).map((f) => ({
    creatorId: f.userId.toString(),
    score: f.score || 0,
    lastUpdated: f.lastUpdated ? new Date(f.lastUpdated).getTime() : Date.now(),
    skips: f.skips || 0,
    lastSkipAt: f.lastSkipAt ? new Date(f.lastSkipAt).getTime() : Date.now(),
  }));

  await setSessionData(sessionId, sessionData);

  const now = Date.now();
  await redis.zadd(SESSION_LAST_ACCESS_ZSET, now, sessionId);
}

export default startSession;
