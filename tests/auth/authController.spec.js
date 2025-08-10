import request from "supertest";
import jwt from "jsonwebtoken";
import sinon from "sinon";
import app from "../../app.js";
import { insertUser } from "../utils/mockData.js";
// import * as redisFlag from "../../utils/isRedisEnabled.js";

describe("Auth Controller Integration", () => {
  describe("POST /api/v1/user/signup", () => {
    it("signs up a new user and returns token + cookie", async () => {
      const res = await request(app)
        .post("/api/v1/user/signup")
        .send({
          firstName: "test",
          lastName: "user",
          userName: "testuser",
          email: "test@email.com",
          password: "password123",
          passwordConfirm: "password123",
        })
        .expect(201);

      expect(res.body).to.have.property("token");
      expect(res.headers["set-cookie"]).to.satisfy((cookies) => cookies.some((c) => c.startsWith("jwt=")));
    });

    it("rejects invalid payload", async () => {
      const res = await request(app).post("/api/v1/user/signup").send({ email: "no-name" }).expect(400);

      expect(res.body.message).to.match(/required/);
    });
  });

  describe("POST /api/v1/user/login", () => {
    let user;
    let passwordPlain;
    beforeEach(async () => {
      ({ user, passwordPlain } = await insertUser());
    });

    it("logs in and sets JWT cookie", async () => {
      const res = await request(app).post("/api/v1/user/login").send({ email: user.email, password: passwordPlain }).expect(200);

      expect(res.body).to.have.property("token");
      expect(res.headers["set-cookie"]).to.satisfy((cookies) => cookies.some((c) => c.startsWith("jwt=")));
    });

    it("rejects wrong password", async () => {
      await request(app).post("/api/v1/user/login").send({ email: user.email, password: "wrong" }).expect(400);
    });
  });

  describe("POST /api/v1/user/logout", () => {
    it("clears cookies and returns success", async () => {
      const { user, passwordPlain } = await insertUser();
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret");

      const res = await request(app).get("/api/v1/user/logout").set("Authorization", `Bearer ${token}`).expect(200);

      expect(res.headers["set-cookie"]).to.satisfy((cookies) => cookies.some((c) => c.includes("loggedout")));
    });
  });

  describe("Protect Middleware", () => {
    let token;
    beforeEach(async () => {
      const { user, passwordPlain } = await insertUser();
      token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "secret", {
        expiresIn: "30d",
      });
    });

    it("allows access with valid token", async () => {
      const res = await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${token}`).expect(200);
      expect(res.body.data.user).to.have.property("email");
    });

    it("rejects without token", async () => {
      await request(app).get("/api/v1/user/me").expect(401);
    });

    it("rejects with expired token", async () => {
      const expiredToken = jwt.sign({ id: "any" }, process.env.JWT_SECRET || "secret", { expiresIn: -60 });
      await request(app).get("/api/v1/user/me").set("Authorization", `Bearer ${expiredToken}`).expect(401);
    });

    it("rejects with malformed token", async () => {
      await request(app).get("/api/v1/user/me").set("Authorization", "Bearer not.a.valid.token").expect(401);
    });
  });
});
