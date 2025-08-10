import {
  SKIP_REENTRY_SLOTS,
  WATCHED_SLOTS,
  INTERESTS_SLOTS,
  CREATORS_SLOTS,
  FOLLOWING_SLOTS,
  TRENDING_SLOTS,
  RISING_SLOTS,
  RECENT_SLOTS,
  EVERGREEN_SLOTS,
} from "../constants/feedConstants.js";

function interleaveByBucket(candidates, nonExploreLimit, scoreKey = "overallScore", bucketKey = "bucket") {
  const chosen = [];
  const counts = {};
  const pool = candidates.slice();

  const caps = {
    SKIP_REENTRY: SKIP_REENTRY_SLOTS,
    WATCHED: WATCHED_SLOTS,
    "CAT:TOP": INTERESTS_SLOTS,
    "CAT:RISING": INTERESTS_SLOTS,
    "CAT:EXTRA": INTERESTS_SLOTS,
    "CREATOR:TOP": CREATORS_SLOTS,
    "CREATOR:RISING": CREATORS_SLOTS,
    "CREATOR:EXTRA": CREATORS_SLOTS,
    "CREATOR:FOLLOWED": FOLLOWING_SLOTS,
    RISING: RISING_SLOTS,
    TRENDING: TRENDING_SLOTS,
    RECENT: RECENT_SLOTS,
    EVERGREEN: EVERGREEN_SLOTS,
    UNKNOWN: 1,
  };

  pool.sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));

  while (chosen.length < nonExploreLimit && pool.length) {
    const available = pool.filter((item) => {
      const b = item[bucketKey];
      const used = counts[b] || 0;
      const cap = caps[b] ?? nonExploreLimit;
      return used < cap;
    });

    if (!available.length) break;

    const minCount = Math.min(...available.map((item) => counts[item[bucketKey]] || 0));

    const eligible = available.filter((item) => (counts[item[bucketKey]] || 0) === minCount);

    eligible.sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));

    const pick = eligible[0];
    chosen.push(pick);

    const bk = pick[bucketKey];
    counts[bk] = (counts[bk] || 0) + 1;

    const idx = pool.indexOf(pick);
    pool.splice(idx, 1);
  }

  return chosen;
}

export default interleaveByBucket;
