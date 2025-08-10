import express from "express";
import * as authController from "../controllers/authController.js";
import * as commentController from "../controllers/commentController.js";

const router = express.Router();

router.post("/:postId/comments", authController.protect, commentController.addComment);

router.delete("/:postId/comments/:commentId", authController.protect, commentController.deleteComment);

export default router;
