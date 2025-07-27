import bcrypt from "bcrypt";
import User from "../../models/userModel.js";
import Post from "../../models/postModel.js";

export async function insertUser(overrides = {}) {
  const passwordPlain = overrides.password || "password123";
  const hash = await bcrypt.hash(passwordPlain, 12);

  const base = {
    firstName: "test",
    lastName: "user",
    userName: "testuser",
    email: "test@email.com",
    password: passwordPlain,
    passwordConfirm: passwordPlain,
    bio: "",
    profilePicture: "",
    seenPosts: [],
    topInterests: [],
    risingInterests: [],
    creatorsInterests: {
      topCreators: [],
      risingCreators: [],
      skippedCreatorsPool: [],
      watchedCreatorsPool: [],
    },
    following: [],
  };

  const user = await User.create({ ...base, ...overrides });
  user.password = undefined;
  return { user, passwordPlain };
}

export async function insertPost(creatorId, overrides = {}) {
  const base = {
    creator: creatorId,
    text: "test text",
    image: "",
    category: "general",
    subCategory: "sub",
    specific: "spec",
    trendingScore: 0,
    engagementSum: 0,
    impressionCount: 0,
    isEvergreen: false,
    isRising: false,
  };
  return Post.create({ ...base, ...overrides });
}
