import request from "supertest";
import jwt from "jsonwebtoken";
// import mongoose from "mongoose";

import app from "../../app.js";
import { insertUser, insertPost } from "../utils/mockData.js";
import Comment from "../../models/commentModel.js";
import Post from "../../models/postModel.js";

describe("Comment Controller Integration", () => {
  let token;
  let user;
  let post;

  beforeEach(async () => {
    ({ user } = await insertUser());
    post = await insertPost(user._id);
    token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret");
  });

  describe("POST /api/v1/comment/:postId/comments", () => {
    it("adds a comment when data is valid", async () => {
      const res = await request(app)
        .post(`/api/v1/comment/${post._id}/comments`)
        .set("Authorization", `Bearer ${token}`)
        .send({ text: "Nice post!" })
        .expect(201);

      expect(res.body).to.have.property("comment");
      expect(res.body.comment).to.have.property("text", "Nice post!");

      const saved = await Comment.findById(res.body.comment._id);
      expect(saved).to.exist;
      const updatedPost = await Post.findById(post._id);
      expect(updatedPost.comments.map(String)).to.include(String(saved._id));
    });

    it("rejects invalid payload", async () => {
      await request(app).post(`/api/v1/comment/${post._id}/comments`).set("Authorization", `Bearer ${token}`).send({}).expect(400);
    });

    it("rejects when unauthenticated", async () => {
      await request(app).post(`/api/v1/comment/${post._id}/comments`).send({ text: "Hi" }).expect(401);
    });
  });

  describe("DELETE /api/v1/comment/:postId/comments/:commentId", () => {
    let comment;

    beforeEach(async () => {
      comment = await Comment.create({
        author: user._id,
        post: post._id,
        text: "To be deleted",
      });

      await Post.findByIdAndUpdate(post._id, {
        $push: { comments: comment._id },
      });
    });

    it("deletes own comment", async () => {
      await request(app).delete(`/api/v1/comment/${post._id}/comments/${comment._id}`).set("Authorization", `Bearer ${token}`).expect(204);

      const exists = await Comment.findById(comment._id);
      expect(exists).to.be.null;
      const updatedPost = await Post.findById(post._id);
      expect(updatedPost.comments.map(String)).to.not.include(String(comment._id));
    });

    it("rejects deleting someone else's comment", async () => {
      const otherUser = await insertUser({ email: "x@x.com", userName: "x" });
      const otherToken = jwt.sign({ id: otherUser.user._id }, process.env.JWT_SECRET || "secret");

      await request(app)
        .delete(`/api/v1/comment/${post._id}/comments/${comment._id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(401);
    });

    it("rejects if comment or post not found", async () => {
      await request(app)
        .delete(`/api/v1/comment/${post._id}/comments/0123456789abcdef01234567`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });
});
