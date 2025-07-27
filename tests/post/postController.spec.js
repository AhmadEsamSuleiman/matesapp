import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import app from "../../app.js";
import { insertUser, insertPost } from "../utils/mockData.js";
import Post from "../../models/postModel.js";

describe("Post Controller Integration", () => {
  let token, user, post;

  beforeEach(async () => {
    ({ user } = await insertUser());
    token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret");

    post = await insertPost(user._id);
  });

  describe("POST /api/v1/post", () => {
    it("creates a post with valid data", async () => {
      const payload = {
        text: "New Post Text",
        image: "http://img.url/pic.png",
        category: "News",
        subCategory: "Tech",
      };

      const res = await request(app)
        .post("/api/v1/post")
        .set("Authorization", `Bearer ${token}`)
        .send(payload)
        .expect(201);

      expect(res.body.data).to.have.property("message", "post created");
      expect(res.body.data.post).to.include({
        text: payload.text,
        category: payload.category,
        subCategory: payload.subCategory,
      });

      const saved = await Post.findById(res.body.data.post._id);
      expect(saved).to.exist;
      expect(saved.text).to.equal(payload.text);
      expect(saved.category).to.equal(payload.category);
    });

    it("rejects missing required fields", async () => {
      await request(app)
        .post("/api/v1/post")
        .set("Authorization", `Bearer ${token}`)
        .send({ image: "", subCategory: "X" })
        .expect(400);
    });
  });

  describe("GET /api/v1/posts/:postId", () => {
    it("returns a post by ID", async () => {
      const res = await request(app)
        .get(`/api/v1/post/${post._id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).to.have.property("_id", post._id.toString());
      expect(res.body.data).to.have.property("text", post.text);
    });

    it("400 on invalid ID format", async () => {
      await request(app)
        .get("/api/v1/post/invalidId")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
    });

    it("404 if post not found", async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`/api/v1/post/${fakeId}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("PATCH /api/v1/posts/:postId/like", () => {
    it("likes then unlikes a post", async () => {
      let res = await request(app)
        .patch(`/api/v1/post/${post._id}/like`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.liked).to.be.true;
      expect(res.body.likes).to.include(user._id.toString());

      res = await request(app)
        .patch(`/api/v1/post/${post._id}/like`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.liked).to.be.false;
      expect(res.body.likes).to.not.include(user._id.toString());
    });

    it("404 on non-existent post", async () => {
      await request(app)
        .patch(`/api/v1/post/${new mongoose.Types.ObjectId()}/like`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("DELETE /api/v1/posts/:postId", () => {
    it("deletes own post", async () => {
      await request(app)
        .delete(`/api/v1/post/${post._id}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(204);

      const found = await Post.findById(post._id);
      expect(found).to.be.null;
    });

    it("rejects deleting someone else's post", async () => {
      const { user: other } = await insertUser({
        email: "x@x.com",
        userName: "x",
      });
      const otherToken = jwt.sign(
        { id: other._id },
        process.env.JWT_SECRET || "secret"
      );

      await request(app)
        .delete(`/api/v1/post/${post._id}`)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(401);
    });

    it("404 on non-existent post", async () => {
      await request(app)
        .delete(`/api/v1/post/${new mongoose.Types.ObjectId()}`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });
});
