import express from "express";
import * as authController from "../controllers/authController.js";
import * as userController from "../controllers/userController.js";

const router = express.Router();

router.post("/signup", authController.signUp);
router.post("/login", authController.login);
router.get("/logout", authController.protect, authController.logout);

router.get("/me", authController.protect, userController.getMe);

router.get("/:id/posts", userController.getUserPosts);

router.patch("/updateMe", authController.protect, userController.updateMe);
router.patch("/updatePassword", authController.protect, userController.updateMyPassword);

router.post("/:id/follow", authController.protect, userController.followUnFollow);

export default router;
