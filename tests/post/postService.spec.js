import sinon from "sinon";
import mongoose from "mongoose";

import Post from "../../models/postModel.js";
import Comment from "../../models/commentModel.js";
import AppError from "../../utils/appError.js";
import { createPostService, getPostService, toggleLikeService, deletePostService } from "../../services/post/postService.js";

describe("Post Service Unit Tests", () => {
  afterEach(() => sinon.restore());

  describe("createPostService", () => {
    it("creates a post with given data", async () => {
      const fake = { _id: "p1", creator: "u1", content: "Hello" };
      const stub = sinon.stub(Post, "create").resolves(fake);
      const result = await createPostService("u1", { content: "Hello" });
      expect(stub.calledOnceWith({ creator: "u1", content: "Hello" })).to.be.true;
      expect(result).to.equal(fake);
    });
  });

  describe("getPostService", () => {
    it("throws if post not found", async () => {
      sinon.stub(Post, "findById").resolves(null);
      await expect(getPostService("p1")).to.be.rejectedWith(AppError, /post not found/);
    });

    it("returns post when found", async () => {
      const fake = { _id: "p1", content: "Hi" };
      sinon.stub(Post, "findById").resolves(fake);
      const result = await getPostService("p1");
      expect(result).to.equal(fake);
    });
  });

  describe("toggleLikeService", () => {
    const uid = new mongoose.Types.ObjectId();
    it("throws if post missing", async () => {
      sinon.stub(Post, "findById").resolves(null);
      await expect(toggleLikeService(uid, "p1")).to.be.rejectedWith(AppError, /Post not found/);
    });

    it("likes a post not already liked", async () => {
      const postDoc = { _id: "p1", likes: [], save: () => {} };
      sinon.stub(Post, "findById").withArgs("p1", "likes").resolves(postDoc);
      const updated = { likes: [uid] };
      sinon
        .stub(Post, "findByIdAndUpdate")
        .withArgs("p1", { $addToSet: { likes: uid } }, sinon.match.object)
        .resolves(updated);

      const res = await toggleLikeService(uid, "p1");
      expect(res.liked).to.be.true;
      expect(res.totalLikes).to.equal(1);
      expect(res.likes).to.eql(updated.likes);
    });

    it("unlikes a post already liked", async () => {
      const postDoc = { _id: "p1", likes: [uid] };
      sinon.stub(Post, "findById").withArgs("p1", "likes").resolves(postDoc);
      const updated = { likes: [] };
      sinon
        .stub(Post, "findByIdAndUpdate")
        .withArgs("p1", { $pull: { likes: uid } }, sinon.match.object)
        .resolves(updated);

      const res = await toggleLikeService(uid, "p1");
      expect(res.liked).to.be.false;
      expect(res.totalLikes).to.equal(0);
      expect(res.likes).to.eql(updated.likes);
    });
  });

  describe("deletePostService", () => {
    const uid = new mongoose.Types.ObjectId();
    it("throws if post not found", async () => {
      sinon.stub(Post, "findById").resolves(null);
      await expect(deletePostService(uid, "p1")).to.be.rejectedWith(AppError, /post not found/);
    });

    it("throws if user not creator", async () => {
      const postDoc = { _id: "p1", creator: new mongoose.Types.ObjectId() };
      sinon.stub(Post, "findById").resolves(postDoc);
      await expect(deletePostService(uid, "p1")).to.be.rejectedWith(AppError, /permission/);
    });

    it("deletes when author matches", async () => {
      const postDoc = { _id: "p1", creator: uid };
      sinon.stub(Post, "findById").resolves(postDoc);
      const delPost = sinon.stub(Post, "findByIdAndDelete").resolves();
      const delComment = sinon.stub(Comment, "deleteMany").resolves();
      const res = await deletePostService(uid, "p1");
      expect(delPost.calledOnceWith(postDoc._id)).to.be.true;
      expect(delComment.calledOnceWith({ post: postDoc._id })).to.be.true;
      expect(res).to.be.true;
    });
  });
});
