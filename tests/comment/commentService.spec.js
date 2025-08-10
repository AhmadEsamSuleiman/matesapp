import sinon from "sinon";
import mongoose from "mongoose";

import Comment from "../../models/commentModel.js";
import Post from "../../models/postModel.js";
import AppError from "../../utils/appError.js";
import { addCommentService, deleteCommentService } from "../../services/comment/commentService.js";

describe("Comment Service Unit Tests", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("addCommentService", () => {
    it("throws if post does not exist", async () => {
      sinon.stub(Post, "findById").resolves(null);

      await expect(addCommentService("user1", "post1", "hello")).to.be.rejectedWith(AppError, /post not found/);
    });

    it("creates comment, pushes to post, and returns it", async () => {
      const fakePost = { _id: "post1", comments: [], save: sinon.stub() };
      const fakeComment = { _id: "c1", author: "user1", text: "hi" };

      sinon.stub(Post, "findById").resolves(fakePost);
      const createStub = sinon.stub(Comment, "create").resolves(fakeComment);
      const updateStub = sinon.stub(Post, "findByIdAndUpdate").resolves({});

      const result = await addCommentService("user1", "post1", "hi");

      expect(
        createStub.calledOnceWith({
          author: "user1",
          post: "post1",
          text: "hi",
        }),
      ).to.be.true;

      expect(
        updateStub.calledOnceWith("post1", {
          $push: { comments: fakeComment._id },
        }),
      ).to.be.true;

      expect(result).to.equal(fakeComment);
    });
  });

  describe("deleteCommentService", () => {
    it("throws if comment not found", async () => {
      sinon.stub(Comment, "findById").resolves(null);

      await expect(deleteCommentService(new mongoose.Types.ObjectId(), "post1", "c1")).to.be.rejectedWith(AppError, /comment not found/);
    });

    it("throws if post not found", async () => {
      const fakeComment = { _id: "c1", author: new mongoose.Types.ObjectId() };

      sinon.stub(Comment, "findById").resolves(fakeComment);
      sinon.stub(Post, "findById").resolves(null);

      await expect(deleteCommentService(fakeComment.author, "post1", "c1")).to.be.rejectedWith(AppError, /Post not found/);
    });

    it("throws if user not author", async () => {
      const fakeComment = {
        _id: "c1",
        author: new mongoose.Types.ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
      };

      sinon.stub(Comment, "findById").resolves(fakeComment);
      sinon.stub(Post, "findById").resolves({ _id: "post1", comments: [], save: sinon.stub() });

      const otherUserId = new mongoose.Types.ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");

      await expect(deleteCommentService(otherUserId, "post1", "c1")).to.be.rejectedWith(AppError, /permission/);
    });

    it("deletes comment and removes from post", async () => {
      const userId = new mongoose.Types.ObjectId();
      const fakeComment = { _id: "c1", author: userId };

      const commentsArr = ["c1", "c2"];
      commentsArr.pull = function (id) {
        const idx = this.indexOf(id);
        if (idx > -1) this.splice(idx, 1);
      };

      const fakePost = {
        _id: "post1",
        comments: commentsArr,
        save: sinon.stub().resolves(),
      };

      sinon.stub(Comment, "findById").resolves(fakeComment);
      sinon.stub(Post, "findById").resolves(fakePost);
      const deleteStub = sinon.stub(Comment, "findByIdAndDelete").resolves();

      await deleteCommentService(userId, "post1", "c1");

      expect(deleteStub.calledOnceWith("c1")).to.be.true;
      expect(fakePost.comments).to.not.include("c1");
      expect(fakePost.save.calledOnce).to.be.true;
    });
  });
});
