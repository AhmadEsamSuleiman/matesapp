import express from "express";
import * as authController from "../controllers/authController.js";
import * as engagementController from "../controllers/engagementController.js";

const router = express.Router();

router.post("/positive", authController.protect, engagementController.calculateEngagement);
router.post("/negative", authController.protect, engagementController.calculateSkips);

export default router;
