import sinon from "sinon";
import Post from "../../models/postModel.js";
import User from "../../models/userModel.js";
import GlobalStats from "../../models/globalStatsModel.js";
import CreatorStats from "../../models/creatorStatsModel.js";
import UserInterestStats from "../../models/userInterestStatsModel.js";

import { getPostAndUserService, markPostSeenService, updateEngagementStatsService } from "../../services/engagement/engagementService.js";
import AppError from "../../utils/appError.js";

describe("Engagement Service Unit Tests", () => {
  afterEach(() => sinon.restore());

  describe("getPostAndUserService", () => {
    it("resolves when both post and user exist", async () => {
      const fakePost = { _id: "p1" };
      const fakeUser = { _id: "u1" };
      sinon.stub(Post, "findById").resolves(fakePost);
      sinon.stub(User, "findById").resolves(fakeUser);

      const result = await getPostAndUserService("p1", "u1");
      expect(result).to.deep.equal({ post: fakePost, user: fakeUser });
    });

    it("throws 404 if post missing", async () => {
      sinon.stub(Post, "findById").resolves(null);
      await expect(getPostAndUserService("p1", "u1")).to.be.rejectedWith(AppError, /Post not found/);
    });

    it("throws 404 if user missing", async () => {
      sinon.stub(Post, "findById").resolves({ _id: "p1" });
      sinon.stub(User, "findById").resolves(null);
      await expect(getPostAndUserService("p1", "u1")).to.be.rejectedWith(AppError, /User not found/);
    });
  });

  describe("markPostSeenService", () => {
    it("adds postId to user.seenPosts", async () => {
      const postSeenStub = sinon.stub(User, "findByIdAndUpdate").resolves();
      await markPostSeenService("u1", "p1");
      sinon.assert.calledOnceWithExactly(postSeenStub, "u1", {
        $addToSet: { seenPosts: "p1" },
      });
    });
  });

  describe("updateEngagementStatsService", () => {
    const data = {
      postId: "p1",
      userId: "u1",
      category: "Cat",
      subCategory: "Sub",
      creator: { _id: "c1" },
      engagementScore: 5,
    };

    it("increments all relevant counters including subCategory", async () => {
      const postUpdateStub = sinon.stub(Post, "findByIdAndUpdate").resolves();
      const categoryGlobalStatsStub = sinon.stub(GlobalStats, "findOneAndUpdate").resolves();
      const categoryUserInterestStub = sinon.stub(UserInterestStats, "findOneAndUpdate").resolves();
      const creatorStatsStub = sinon.stub(CreatorStats, "findOneAndUpdate").resolves();

      await updateEngagementStatsService(data);

      sinon.assert.calledWith(postUpdateStub, "p1", sinon.match({ $inc: { impressionCount: 1, engagementSum: 5 } }));

      sinon.assert.calledWith(categoryGlobalStatsStub, { entityType: "category", name: "Cat" }, sinon.match.any, sinon.match.object);

      sinon.assert.calledWith(
        categoryUserInterestStub,
        { userId: "u1", entityType: "category", name: "Cat" },
        sinon.match.any,
        sinon.match.object,
      );

      sinon.assert.calledWith(creatorStatsStub, { creatorId: "c1" }, sinon.match.any, sinon.match.object);

      sinon.assert.calledWith(categoryGlobalStatsStub, { entityType: "subcategory", name: "Sub" }, sinon.match.any, sinon.match.object);
      sinon.assert.calledWith(
        categoryUserInterestStub,
        { userId: "u1", entityType: "subcategory", name: "Sub" },
        sinon.match.any,
        sinon.match.object,
      );
    });

    it("skips subCategory updates when subCategory is undefined", async () => {
      const postUpdateStub = sinon.stub(Post, "findByIdAndUpdate").resolves();
      const categoryGlobalStatsStub = sinon.stub(GlobalStats, "findOneAndUpdate").resolves();
      const categoryUserInterestStub = sinon.stub(UserInterestStats, "findOneAndUpdate").resolves();
      const creatorStatsStub = sinon.stub(CreatorStats, "findOneAndUpdate").resolves();

      await updateEngagementStatsService({ ...data, subCategory: undefined });

      sinon.assert.calledOnce(postUpdateStub);

      expect(categoryGlobalStatsStub.callCount).to.equal(1);
      expect(categoryUserInterestStub.callCount).to.equal(1);

      expect(creatorStatsStub.callCount).to.equal(1);
    });
  });
});
