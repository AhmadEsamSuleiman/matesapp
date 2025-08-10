import express from "express";
import * as authController from "../controllers/authController.js";
import generateFeed from "../controllers/feedController.js";

const router = express.Router();

router.get("/", authController.protect, generateFeed);

export default router;
