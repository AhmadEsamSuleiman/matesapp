import express from "express";
import * as authController from "../controllers/authController.js";
import * as postController from "../controllers/postController.js";

const router = express.Router();

router.post("/", authController.protect, postController.createPost);

router.get("/:postId", authController.protect, postController.getPost);

router.get("/:postId/comments", postController.getPostComments);

router.patch("/:postId/like", authController.protect, postController.toggleLike);

router.delete("/:postId", authController.protect, postController.deletePost);

export default router;
