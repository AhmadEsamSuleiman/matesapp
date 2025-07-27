import sinon from "sinon";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import User from "../../models/userModel.js";
import Post from "../../models/postModel.js";
import AppError from "../../utils/appError.js";

import {
  followUnFollowService,
  getUserPostsService,
  updateMeService,
  updateMyPasswordService,
} from "../../services/user/userService.js";

describe("User Service Unit Tests", () => {
  afterEach(() => sinon.restore());

  describe("followUnFollowService", () => {
    let userId, targetId, userDoc, targetDoc;

    beforeEach(() => {
      userId = new mongoose.Types.ObjectId();
      targetId = new mongoose.Types.ObjectId();
      userDoc = {
        _id: userId,
        following: [],
        equals(o) {
          return this._id.equals(o);
        },
      };
      targetDoc = {
        _id: targetId,
        followers: [],
        equals(o) {
          return this._id.equals(o);
        },
      };
    });

    it("throws if target user not found", async () => {
      sinon.stub(User, "findById").withArgs(targetId).resolves(null);
      await expect(followUnFollowService(userId, targetId)).to.be.rejectedWith(
        AppError,
        /doesnt exist/
      );
    });

    it("throws if trying to follow self", async () => {
      sinon.stub(User, "findById").withArgs(targetId).resolves(targetDoc);
      await expect(
        followUnFollowService(targetId, targetId)
      ).to.be.rejectedWith(AppError, /cant follow\/unfollow yourself/);
    });

    it("follows when not already following", async () => {
      sinon
        .stub(User, "findById")
        .onFirstCall()
        .resolves(targetDoc)
        .onSecondCall()
        .resolves(userDoc);

      // single stub for both updates
      const updateStub = sinon.stub(User, "findByIdAndUpdate").resolves();

      const { to, action } = await followUnFollowService(userId, targetId);

      expect(to).to.equal(targetDoc);
      expect(action).to.equal("followed");

      // first call adds to user's following
      expect(
        updateStub.firstCall.calledWith(userId, {
          $addToSet: { following: { userId: targetId } },
        })
      ).to.be.true;

      // second call adds to target's followers
      expect(
        updateStub.secondCall.calledWith(targetId, {
          $addToSet: { followers: userId },
        })
      ).to.be.true;
    });

    it("unfollows when already following", async () => {
      userDoc.following = [{ userId: targetId }];
      sinon
        .stub(User, "findById")
        .onFirstCall()
        .resolves(targetDoc)
        .onSecondCall()
        .resolves(userDoc);

      const updateStub = sinon.stub(User, "findByIdAndUpdate").resolves();

      const { action } = await followUnFollowService(userId, targetId);
      expect(action).to.equal("unfollowed");

      // first call pulls from user's following
      expect(
        updateStub.firstCall.calledWith(userId, {
          $pull: { following: { userId: targetId } },
        })
      ).to.be.true;

      // second call pulls from target's followers
      expect(
        updateStub.secondCall.calledWith(targetId, {
          $pull: { followers: userId },
        })
      ).to.be.true;
    });
  });

  describe("getUserPostsService", () => {
    const userId = new mongoose.Types.ObjectId();

    it("throws if user not found", async () => {
      sinon.stub(User, "findById").resolves(null);
      await expect(getUserPostsService(userId, 1)).to.be.rejectedWith(
        AppError,
        /User not found/
      );
    });

    it("returns paginated posts", async () => {
      const fakeUser = { _id: userId };
      const fakePosts = [{}, {}, {}];

      sinon.stub(User, "findById").resolves(fakeUser);
      const findStub = sinon.stub(Post, "find").returns({
        sort: () => ({
          skip: () => ({ limit: () => Promise.resolve(fakePosts) }),
        }),
      });

      const { posts, results, page } = await getUserPostsService(userId, 2);

      expect(page).to.equal(2);
      expect(results).to.equal(3);
      expect(posts).to.equal(fakePosts);
      expect(findStub.calledWith({ creator: userId })).to.be.true;
    });
  });

  describe("updateMeService", () => {
    const userId = new mongoose.Types.ObjectId();

    it("throws if user not found", async () => {
      sinon.stub(User, "findByIdAndUpdate").returns({
        select: sinon.stub().resolves(null),
      });
      await expect(updateMeService(userId, { bio: "x" })).to.be.rejectedWith(
        AppError,
        /User not found/
      );
    });

    it("updates and returns user", async () => {
      const updatedUser = { _id: userId, bio: "new" };
      const selectStub = sinon.stub().resolves(updatedUser);
      sinon.stub(User, "findByIdAndUpdate").returns({ select: selectStub });

      const result = await updateMeService(userId, { bio: "new" });

      expect(selectStub.calledOnceWith("-password")).to.be.true;
      expect(result).to.equal(updatedUser);
    });
  });

  describe("updateMyPasswordService", () => {
    const userId = new mongoose.Types.ObjectId();
    const currentHash = bcrypt.hashSync("oldPass", 1);

    it("throws if user not found", async () => {
      sinon.stub(User, "findById").returns({
        select: sinon.stub().resolves(null),
      });
      await expect(
        updateMyPasswordService(userId, "old", "new", "new")
      ).to.be.rejectedWith(AppError, /User not found/);
    });

    it("throws if current password wrong", async () => {
      const fakeUser = { password: currentHash };
      sinon.stub(User, "findById").returns({
        select: sinon.stub().resolves(fakeUser),
      });
      await expect(
        updateMyPasswordService(userId, "wrong", "new", "new")
      ).to.be.rejectedWith(AppError, /current password is incorrect/);
    });

    it("throws if new passwords mismatch", async () => {
      const fakeUser = { password: currentHash, save: sinon.stub().resolves() };
      sinon.stub(User, "findById").returns({
        select: sinon.stub().resolves(fakeUser),
      });
      await expect(
        updateMyPasswordService(userId, "oldPass", "a", "b")
      ).to.be.rejectedWith(AppError, /do not match/);
    });

    it("updates password when data valid", async () => {
      const fakeUser = {
        _id: userId,
        password: currentHash,
        save: sinon.stub().resolves(),
      };
      sinon.stub(User, "findById").returns({
        select: sinon.stub().resolves(fakeUser),
      });

      const result = await updateMyPasswordService(
        userId,
        "oldPass",
        "newPass",
        "newPass"
      );

      expect(fakeUser.password).to.equal("newPass");
      expect(fakeUser.passwordConfirm).to.equal("newPass");
      expect(fakeUser.save.calledOnce).to.be.true;
      expect(result).to.equal(fakeUser);
    });
  });
});
