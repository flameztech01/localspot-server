// src/routes/businessRoutes.js
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
// Cloudinary config
// ──────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// Per-field storage: logo gets square crop, coverImage gets 16:6,
// images get a general 4:3 limited crop.
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    const base = {
      folder: "BusinessProfiles",
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
      resource_type: "image",
    };

    if (file.fieldname === "logo") {
      return {
        ...base,
        // Square avatar, cropped tightly
        transformation: [
          { width: 600, height: 600, crop: "fill", gravity: "auto" },
        ],
      };
    }

    if (file.fieldname === "coverImage") {
      return {
        ...base,
        // Wide hero banner
        transformation: [
          { width: 1600, height: 600, crop: "fill", gravity: "auto" },
        ],
      };
    }

    // Default for gallery images
    return {
      ...base,
      transformation: [{ width: 1600, height: 1200, crop: "limit" }],
    };
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024, // 8 MB per file
    files: 22, // 20 gallery + 1 cover + 1 logo
  },
});

// Inline admin gate (assumes `protect` ran first and set req.user)
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
    { name: "logo", maxCount: 1 },
    { name: "coverImage", maxCount: 1 },
    { name: "images", maxCount: 20 },
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