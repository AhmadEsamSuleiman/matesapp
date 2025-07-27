import User from "../models/userModel";
import Post from "../models/postModel";
// Create a user with hierarchical interests and empty seen list.

exports.createUserWithInterests = async () => {
  const user = await User.create({
    name: "test User",
    email: "testuser@email.com",
    password: "testtest", // pre-save hook will hash
    topInterests: [
      {
        category: "Tech",
        subcategories: [{ name: "AI", score: 0.9 }],
      },
      {
        category: "Gaming",
        subcategories: [
          { name: "PC", score: 0.7 },
          { name: "CONSOLE", score: 0.6 },
        ],
      },
    ],
    risingInterests: [
      {
        category: "Science",
        subcategories: [{ name: "Space", score: 0.4 }],
      },
    ],
    seen: [],
    creatorsInterests: {
      topCreators: [],
      risingCreators: [],
      watchedCreators: [],
      skippedCreators: [],
    },
  });
  return user;
};

//  Creates posts for the given creatorId.

exports.createPosts = async (creatorId) => {
  return Post.insertMany([
    {
      creator: creatorId,
      content: "post about AI",
      category: "Tech",
      subcategory: "AI",
      trendingScore: 0.8,
      engagementSum: 200,
      impressionCount: 20,
      isEvergreen: false,
      isRising: true,
      createdAt: new Date(Date.now() - 1000 * 60 * 60), // 1h
    },
    {
      creator: creatorId,
      content: "Gaming News",
      category: "Gaming",
      subcategory: "PC",
      specific: "Hardware",
      trendingScore: 0.5,
      engagementSum: 120,
      impressionCount: 10,
      isEvergreen: false,
      isRising: true,
      createdAt: new Date(Date.now() - 1000 * 60 * 120), // 2h
    },
    {
      creator: creatorId,
      content: "Explore Science",
      category: "Science",
      subcategory: "Space",
      specific: "NASA",
      trendingScore: 0.3,
      engagementSum: 60,
      impressionCount: 5,
      isEvergreen: false,
      isRising: true,
      createdAt: new Date(Date.now() - 1000 * 60 * 180), // 3h
    },
  ]);
};
