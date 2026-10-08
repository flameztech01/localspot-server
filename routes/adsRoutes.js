import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import {
  listAdvertisementTypes,
  listAdvertisementSlots,
  createAdvertisement,
  listMyAdvertisements,
  getMyAdvertisement,
  updateMyAdvertisement,
  submitMyAdvertisement,
  pauseMyAdvertisement,
  resumeMyAdvertisement,
  deleteMyAdvertisement,
  getMyAdvertisementPerformance,
} from "../controllers/adsController.js";
import { protect } from "../middleware/authMiddleware.js";

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
    folder: "Advertisements",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 1200, height: 600, crop: "fill" }],
  },
});
const upload = multer({ storage });

// ──────────────────────────────────────────────────────────────
// Public
// ──────────────────────────────────────────────────────────────
router.get("/types", listAdvertisementTypes);
router.get("/slots", listAdvertisementSlots);

// ──────────────────────────────────────────────────────────────
// Business — all under /business, all protected
// Order matters: /business/<specific> before /business/:id
// ──────────────────────────────────────────────────────────────
router.use("/business", protect);

router.post("/business", upload.single("image"), createAdvertisement);
router.get("/business", listMyAdvertisements);
router.get("/business/:id", getMyAdvertisement);
router.put("/business/:id", upload.single("image"), updateMyAdvertisement);
router.post("/business/:id/submit", submitMyAdvertisement);
router.post("/business/:id/pause", pauseMyAdvertisement);
router.post("/business/:id/resume", resumeMyAdvertisement);
router.delete("/business/:id", deleteMyAdvertisement);
router.get("/business/:id/performance", getMyAdvertisementPerformance);

export default router;