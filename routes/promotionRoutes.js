import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import {
  listPublicPromotions,
  getPromotion,
  listMyPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  submitPromotionForReview,
} from "../controllers/promotionController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// Cloudinary
// ──────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "Promotions",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 1200, height: 800, crop: "fill" }],
  },
});
const upload = multer({ storage });

// ──────────────────────────────────────────────────────────────
// Public
// ──────────────────────────────────────────────────────────────
router.get("/", listPublicPromotions);

// ──────────────────────────────────────────────────────────────
// Private — order matters: /mine/all must come before /:id
// ──────────────────────────────────────────────────────────────
router.get("/mine/all", protect, listMyPromotions);

// Public with optional auth — owner/admin see non-active promotions
router.get("/:id", optionalProtect, getPromotion);

router.post("/", protect, upload.single("image"), createPromotion);
router.put("/:id", protect, upload.single("image"), updatePromotion);
router.delete("/:id", protect, deletePromotion);
router.post("/:id/submit", protect, submitPromotionForReview);

export default router;