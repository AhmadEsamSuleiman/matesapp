import express from "express";
import * as authController from "./../controllers/authController.js";
import * as feedController from "./../controllers/feedController.js";

const router = express.Router();

router.get("/", authController.protect, feedController.generateFeed);

export default router;
