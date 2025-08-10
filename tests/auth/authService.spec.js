import jwt from "jsonwebtoken";
import sinon from "sinon";
import User from "../../models/userModel.js";
import AppError from "../../utils/appError.js";
import { signUpService, loginUserService, verifyTokenService } from "../../services/auth/authService.js";

describe("Auth Service Unit Tests", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("signUpService", () => {
    it("creates a new user and hides password", async () => {
      const fakeUser = {
        _id: "1",
        name: "ahmad",
        email: "ahmad@email.com",
        password: "hashedpassword",
      };

      const stub = sinon.stub(User, "create").resolves(fakeUser);

      const result = await signUpService({
        name: "ahmad",
        email: "ahmad@email.com",
        password: "hashedpassword",
      });

      expect(stub.calledOnce).to.be.true;
      expect(result).to.have.property("_id", "1");
      expect(result).to.have.property("password", undefined);
    });

    it("throws AppError when creation returns falsy", async () => {
      sinon.stub(User, "create").resolves(null);

      await expect(signUpService({})).to.be.rejectedWith(AppError, /User creation failed/);
    });
  });

  describe("loginUserService", () => {
    let fakeUser;

    beforeEach(() => {
      fakeUser = {
        _id: "1",
        comparePassword: sinon.stub(),
      };
    });

    it("logs in by userName", async () => {
      sinon
        .stub(User, "findOne")
        .withArgs({ userName: "u" })
        .returns({ select: () => Promise.resolve(fakeUser) });
      fakeUser.comparePassword.resolves(true);

      const result = await loginUserService({ userName: "u", password: "p" });

      expect(result).to.equal(fakeUser);
      expect(fakeUser.comparePassword.calledOnceWith("p")).to.be.true;
    });

    it("logs in by email", async () => {
      sinon
        .stub(User, "findOne")
        .withArgs({ email: "u@email.com" })
        .returns({ select: () => Promise.resolve(fakeUser) });
      fakeUser.comparePassword.resolves(true);

      const result = await loginUserService({
        email: "u@email.com",
        password: "p",
      });

      expect(result).to.equal(fakeUser);
      expect(fakeUser.comparePassword.calledOnceWith("p")).to.be.true;
    });

    it("throws on missing user", async () => {
      sinon.stub(User, "findOne").returns({ select: () => Promise.resolve(null) });

      await expect(loginUserService({ email: "u", password: "p" })).to.be.rejectedWith(AppError, /user name or email is incorrect/);
    });

    it("throws on wrong password", async () => {
      sinon.stub(User, "findOne").returns({ select: () => Promise.resolve(fakeUser) });
      fakeUser.comparePassword.resolves(false);

      await expect(loginUserService({ email: "u", password: "p" })).to.be.rejectedWith(AppError, /password.*incorrect/);
    });
  });

  describe("verifyTokenService", () => {
    let verifyStub;

    beforeEach(() => {
      verifyStub = sinon.stub(jwt, "verify").callsFake((token, secret, cb) => {
        cb(null, { id: "user", iat: 1 });
      });
    });

    afterEach(() => {
      sinon.restore();
    });

    it("returns a valid user when token is good", async () => {
      const fakeUser = { _id: "user", changedPasswordAfter: () => false };

      sinon.stub(User, "findById").resolves(fakeUser);

      const result = await verifyTokenService("token");

      expect(verifyStub.calledOnce).to.be.true;
      expect(result).to.equal(fakeUser);
    });

    it("throws if user not found", async () => {
      sinon.stub(User, "findById").resolves(null);

      await expect(verifyTokenService("token")).to.be.rejectedWith(AppError, /no longer exists/);
    });

    it("throws if password changed after token issued", async () => {
      const fakeUser = { _id: "u", changedPasswordAfter: () => true };
      sinon.stub(User, "findById").resolves(fakeUser);

      await expect(verifyTokenService("tok")).to.be.rejectedWith(AppError, /changed password/);
    });
  });
});
