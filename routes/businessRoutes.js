import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import {
  // public
  getPublicBusinesses,
  getPublicBusinessById,
  // auth
  registerBusinessAccount,
  verifyBusinessAccount,
  resendBusinessOTP,
  loginBusinessAccount,
  logoutBusinessAccount,
  getCurrentBusinessAccount,
  updateBusinessProfile,
  forgotBusinessPassword,
  resetBusinessPassword,
  // admin
  listBusinesses,
  getBusinessById,
  approveBusiness,
  rejectBusiness,
  toggleBusinessFeatured,
} from "../controllers/businessController.js";
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
    folder: "BusinessProfiles",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [{ width: 1600, height: 1200, crop: "limit" }],
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 21,
  },
});

// Inline admin gate
const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

// ──────────────────────────────────────────────────────────────
// Public — no auth required
// ──────────────────────────────────────────────────────────────
router.get("/public", getPublicBusinesses);
router.get("/public/:id", getPublicBusinessById);

// ──────────────────────────────────────────────────────────────
// Auth flows (public)
// ──────────────────────────────────────────────────────────────
router.post("/register", registerBusinessAccount);
router.post("/verify-otp", verifyBusinessAccount);
router.post("/resend-otp", resendBusinessOTP);
router.post("/login", loginBusinessAccount);
router.post("/forgot-password", forgotBusinessPassword);
router.post("/reset-password", resetBusinessPassword);

// ──────────────────────────────────────────────────────────────
// Private — business owner
// ──────────────────────────────────────────────────────────────
router.post("/logout", protect, logoutBusinessAccount);
router.get("/me", protect, getCurrentBusinessAccount);

router.put(
  "/profile",
  protect,
  upload.fields([
    { name: "images", maxCount: 20 },
    { name: "coverImage", maxCount: 1 },
  ]),
  updateBusinessProfile
);

// ──────────────────────────────────────────────────────────────
// Admin only — approval management
// ──────────────────────────────────────────────────────────────
router.get("/all", protect, isAdmin, listBusinesses);
router.get("/all/:id", protect, isAdmin, getBusinessById);
router.patch("/all/:id/approve", protect, isAdmin, approveBusiness);
router.patch("/all/:id/reject", protect, isAdmin, rejectBusiness);
router.patch("/all/:id/feature", protect, isAdmin, toggleBusinessFeatured);

export default router;