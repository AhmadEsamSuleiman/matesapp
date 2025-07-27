import sinon from "sinon";
import mongoose from "mongoose";

import * as feedService from "../../services/feed/feedService.js";
import * as feedHelpers from "../../utils/feedHelpers.js";
import Post from "../../models/postModel.js";
import { FEED_SIZE } from "../../constants/feedConstants.js";

describe("Feed Service Unit Tests", () => {
  afterEach(() => sinon.restore());

  describe("buildInterestPools", () => {
    it("uses session data when provided, ignoring user interests", () => {
      const user = {
        topInterests: [{ name: "UserCat1", score: 1 }],
        risingInterests: [{ name: "UserCatR", score: 0.1 }],
        creatorsInterests: {
          topCreators: [{ creatorId: "userA", score: 0.2 }],
          risingCreators: [],
          skippedCreatorsPool: [],
          watchedCreatorsPool: [],
        },
        following: [],
      };

      const session = {
        topCategories: [
          { name: "SessCat1", score: 2 },
          { name: "SessCat2", score: 3 },
        ],
        risingCategories: [{ name: "SessCatR", score: 0.5 }],
        topCreators: [{ creatorId: "sessA", score: 0.4 }],
        risingCreators: [],
        followedCreators: [],
        watchedCreators: [],
        skippedCreators: [],
      };

      const { categoryPools, creatorPools } = feedService.buildInterestPools(
        user,
        session
      );

      expect(categoryPools.top).to.eql([
        { name: "SessCat2", score: 3 },
        { name: "SessCat1", score: 2 },
      ]);
      expect(categoryPools.rising).to.eql(session.risingCategories);
      expect(creatorPools.top).to.eql(session.topCreators);
    });

    it("falls back to user data when sessionData is empty or missing", () => {
      const user = {
        topInterests: [
          { name: "UserCat1", score: 1 },
          { name: "UserCat2", score: 0.5 },
        ],
        risingInterests: [{ name: "UserCatR", score: 0.2 }],
        creatorsInterests: {
          topCreators: [
            { creatorId: "userA", score: 0.3 },
            { creatorId: "userB", score: 0.1 },
          ],
          risingCreators: [{ creatorId: "userC", score: 0.4 }],
          skippedCreatorsPool: [{ creatorId: "userD", score: 0.0 }],
          watchedCreatorsPool: [{ creatorId: "userE", score: 0.0 }],
        },
        following: [{ creatorId: "userF", score: 0.9 }],
      };

      const session = {};

      const { categoryPools, creatorPools } = feedService.buildInterestPools(
        user,
        session
      );

      expect(categoryPools.top).to.eql([
        { name: "UserCat1", score: 1 },
        { name: "UserCat2", score: 0.5 },
      ]);
      expect(categoryPools.rising).to.eql([{ name: "UserCatR", score: 0.2 }]);
      expect(creatorPools.top).to.eql([
        { creatorId: "userA", score: 0.3 },
        { creatorId: "userB", score: 0.1 },
      ]);
      expect(creatorPools.rising).to.eql([{ creatorId: "userC", score: 0.4 }]);
      expect(creatorPools.followed).to.eql([
        { creatorId: "userF", score: 0.9 },
      ]);
      expect(creatorPools.skipped).to.eql([{ creatorId: "userD", score: 0.0 }]);
      expect(creatorPools.watched).to.eql([{ creatorId: "userE", score: 0.0 }]);
    });
  });

  describe("buildBucketMaps", () => {
    it("maps each item to the correct bucket label", () => {
      const topCats = [{ name: "Tech" }];
      const risingCats = [{ name: "Science" }];
      const extraCats1 = [{ name: "Art" }];
      const extraCats2 = [{ name: "Gaming" }];
      const topCreators = [{ creatorId: "alice" }];
      const risingCreators = [{ creatorId: "bob" }];
      const extraCreators1 = [{ creatorId: "carol" }];
      const extraCreators2 = [{ creatorId: "dan" }];
      const followedCreators = [{ creatorId: "eve" }];
      const extraFollowed = [{ creatorId: "frank" }];
      const reentryIds = ["oscar"];
      const watchedIds = ["peggy"];

      const { categoryBucketMap, creatorBucketMap } =
        feedService.buildBucketMaps(
          topCats,
          risingCats,
          extraCats1,
          extraCats2,
          topCreators,
          risingCreators,
          extraCreators1,
          extraCreators2,
          followedCreators,
          extraFollowed,
          reentryIds,
          watchedIds
        );

      expect(categoryBucketMap).to.deep.equal({
        Tech: "CAT:TOP",
        Science: "CAT:RISING",
        Art: "CAT:EXTRA",
        Gaming: "CAT:EXTRA",
      });

      expect(creatorBucketMap).to.deep.equal({
        alice: "CREATOR:TOP",
        bob: "CREATOR:RISING",
        carol: "CREATOR:EXTRA",
        dan: "CREATOR:EXTRA",
        eve: "CREATOR:FOLLOWED",
        frank: "CREATOR:FOLLOWED",
        oscar: "SKIP_REENTRY",
        peggy: "WATCHED",
      });
    });
  });

  describe("assembleFeed", () => {
    it("pads with explore when under FEED_SIZE", async () => {
      const scored = Array(5)
        .fill()
        .map((_, i) => ({ bucket: `B${i}`, _id: `${i}` }));

      const fakeExplore = Array(10)
        .fill()
        .map((_, i) => ({ _id: `e${i}` }));

      const result = await feedService.assembleFeed(scored, new Set(), () =>
        Promise.resolve(fakeExplore)
      );

      expect(result.length).to.equal(scored.length + fakeExplore.length);
      expect(result.slice(-fakeExplore.length)).to.eql(fakeExplore);
    });

    it("truncates when over FEED_SIZE", async () => {
      const many = Array(FEED_SIZE + 3)
        .fill()
        .map((_, i) => ({ bucket: "x", _id: `${i}` }));

      const result = await feedService.assembleFeed(many, new Set(), () =>
        Promise.resolve([])
      );

      expect(result.length).to.be.at.most(FEED_SIZE);
    });
  });

  describe("formatFeedPosts", () => {
    it("populates and flags isFollowed correctly", async () => {
      const raw = [
        {
          _id: "p1",
          creator: new mongoose.Types.ObjectId("012345678901234567890123"),
          text: "t",
          image: "i",
          category: "c",
          subCategory: "sc",
          specific: "sp",
          bucket: "B",
          overallScore: 0,
          bayesianScore: 0,
          historicalVelocityEMA: 0,
          shortTermVelocityEMA: 0,
          trendingScore: 0,
          isRising: false,
          isEvergreen: false,
          createdAt: new Date(),
        },
      ];

      const user = { following: [{ userId: raw[0].creator.toString() }] };

      sinon.stub(Post, "populate").resolves([
        {
          ...raw[0],
          creator: {
            _id: raw[0].creator,
            userName: "u",
            profilePicture: "pic",
          },
        },
      ]);

      const formatted = await feedService.formatFeedPosts(raw, user);
      expect(formatted).to.have.length(1);
      const out = formatted[0];
      expect(out).to.include({
        text: "t",
        image: "i",
        category: "c",
        subCategory: "sc",
        specific: "sp",
      });
      expect(out.creator).to.include({ userName: "u", isFollowed: true });
    });
  });
});
