import request from "supertest";

import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import app from "../../app.js";
import { insertUser, insertPost } from "../utils/mockData.js";
import User from "../../models/userModel.js";

describe("User Controller Integration", () => {
  let token, user, otherUser, post;

  beforeEach(async () => {
    ({ user } = await insertUser({
      email: "primary@example.com",
      userName: "primaryUser",
    }));
    token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret");

    post = await insertPost(user._id);

    ({ user: otherUser } = await insertUser({
      email: "other@example.com",
      userName: "otherUser",
    }));
  });

  describe("GET /api/v1/user/me", () => {
    it("returns current user profile", async () => {
      const res = await request(app)
        .get("/api/v1/user/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.user.email).to.equal(user.email);
    });

    it("fails if not logged in", async () => {
      await request(app).get("/api/v1/user/me").expect(401);
    });
  });

  describe("POST /api/v1/user/:id/follow", () => {
    it("follows another user and returns message", async () => {
      const res = await request(app)
        .post(`/api/v1/user/${otherUser._id}/follow`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.message).to.match(/You have followed/);
    });

    it("rejects following yourself", async () => {
      await request(app)
        .post(`/api/v1/user/${user._id}/follow`)
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
    });

    it("rejects invalid userId param", async () => {
      await request(app)
        .post(`/api/v1/user/invalidId/follow`)
        .set("Authorization", `Bearer ${token}`)
        .expect(400);
    });
  });

  describe("GET /api/v1/user/:id/posts", () => {
    it("returns user posts paginated", async () => {
      const res = await request(app)
        .get(`/api/v1/user/${user._id}/posts?page=1`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(res.body.results).to.be.a("number");
      expect(Array.isArray(res.body.data.posts)).to.be.true;
    });

    it("404 on nonexistent user", async () => {
      await request(app)
        .get(`/api/v1/user/${new mongoose.Types.ObjectId()}/posts`)
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("PATCH /api/v1/user/updateMe", () => {
    it("updates allowed fields", async () => {
      const res = await request(app)
        .patch("/api/v1/user/updateMe")
        .set("Authorization", `Bearer ${token}`)
        .send({ bio: "new bio", userName: "newusername" })
        .expect(200);

      expect(res.body.data.user.bio).to.equal("new bio");
    });

    it("rejects password field in body", async () => {
      await request(app)
        .patch("/api/v1/user/updateMe")
        .set("Authorization", `Bearer ${token}`)
        .send({ password: "x" })
        .expect(400);
    });
  });

  describe("PATCH /api/v1/user/updatePassword", () => {
    it("changes password and returns new token", async () => {
      const oldPassword = "password123";
      // await User.findByIdAndUpdate(
      //   user._id,
      //   { password: oldPassword },
      //   { new: true }
      // );

      const res = await request(app)
        .patch("/api/v1/user/updatePassword")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: oldPassword,
          newPassword: "newpassword",
          newPasswordConfirm: "newpassword",
        })
        .expect(200);

      expect(res.body).to.have.property("token");
    });

    it("rejects on wrong current password", async () => {
      await request(app)
        .patch("/api/v1/user/updatePassword")
        .set("Authorization", `Bearer ${token}`)
        .send({
          currentPassword: "wrong",
          newPassword: "a",
          newPasswordConfirm: "a",
        })
        .expect(400);
    });
  });
});
