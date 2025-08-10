import { EMA_ALPHA_DB, EMA_ALPHA_SESSION, MS_PER_DAY, HALF_LIFE_DAYS } from "../constants/scoringConfig.js";

export function decayedScore(oldScore, lastUpdated) {
  const deltaDays = (Date.now() - new Date(lastUpdated)) / MS_PER_DAY;
  const lambda = Math.log(2) / HALF_LIFE_DAYS;
  return oldScore * Math.exp(-lambda * deltaDays);
}

export function emaUpdate(oldScore, lastUpdated, newEngagementScore, mode = "session") {
  const decayed = oldScore !== 0 ? decayedScore(oldScore, lastUpdated) : 0;

  const alpha = mode === "session" ? EMA_ALPHA_SESSION : EMA_ALPHA_DB;

  return alpha * newEngagementScore + (1 - alpha) * decayed;
}
