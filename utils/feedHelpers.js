import Post from "../models/postModel.js";

export async function fetchCandidates({ filter, sort, topLimit, rndLimit, bucket, skippedCreators = [] }) {
  const docs = await Post.aggregate([
    {
      $match: {
        ...filter,
        ...(skippedCreators.length && { creator: { $nin: skippedCreators } }),
      },
    },
    {
      $facet: {
        top: [{ $sort: sort }, { $limit: topLimit }],
        random: [{ $sample: { size: rndLimit } }],
      },
    },
    { $project: { all: { $concatArrays: ["$top", "$random"] } } },
    { $unwind: "$all" },
    { $replaceRoot: { newRoot: "$all" } },
  ]);

  docs.forEach((d) => {
    d.bucket = bucket;
  });

  return docs;
}

export async function fetchTop({ filter, limit, sort, bucket }) {
  const docs = await Post.find(filter).sort(sort).limit(limit).lean();
  docs.forEach((d) => {
    d.bucket = bucket;
  });
  return docs;
}

export async function fetchRandom({ filter, limit, bucket }) {
  const docs = await Post.aggregate([{ $match: filter }, { $sample: { size: limit } }]);
  docs.forEach((d) => {
    d.bucket = bucket;
  });
  return docs;
}

export function pickRandom(arr, n) {
  const a = arr.slice();
  const out = [];
  while (out.length < n && a.length) {
    out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
  }
  return out;
}

export function makeSeenSet(user) {
  return new Set((user.seenPosts || []).map((id) => id.toString()));
}

export async function sampleCategory(categoryObj, seenSet, skippedCreators) {
  const result = [];
  const catName = categoryObj.name;

  const topTwoSubs = categoryObj.topSubs.slice(0, 2);
  const extraTopSub = pickRandom(categoryObj.topSubs.slice(2), 1);
  const subsToSample = [...topTwoSubs, ...extraTopSub];

  const topSubPromises = subsToSample.map(async (sub) => {
    const filter = {
      _id: { $nin: Array.from(seenSet) },
      category: catName,
      subCategory: sub.name,
    };

    const candidates = await fetchCandidates({
      filter,
      sort: { bayesianScore: -1, createdAt: -1 },
      topLimit: 5,
      rndLimit: 3,
      bucket: `INT:${catName}`,
      skippedCreators,
    });

    candidates.forEach((p) => {
      result.push(p);
      // seenSet.add(p._id.toString());
    });
  });

  await Promise.all(topSubPromises);

  const topOneRising = categoryObj.risingSubs.slice(0, 1);
  const extraRising = pickRandom(categoryObj.risingSubs.slice(1), 1);
  const risingToSample = [...topOneRising, ...extraRising];

  const risingSubPromises = risingToSample.map(async (sub) => {
    const filter = {
      _id: { $nin: Array.from(seenSet) },
      category: catName,
      subCategory: sub.name,
    };

    const candidates = await fetchCandidates({
      filter,
      sort: { trendingScore: -1, createdAt: -1 },
      topLimit: 5,
      rndLimit: 3,
      bucket: `INT:${catName}`,
      skippedCreators,
    });

    candidates.forEach((p) => {
      result.push(p);
      // seenSet.add(p._id.toString());
    });
  });

  await Promise.all(risingSubPromises);

  return result;
}
