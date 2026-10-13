// src/routes/authRoutes.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import {
  // auth
  registerUser,
  verifyUserOTP,
  resendOTP,
  loginUser,
  logoutUser,
  // profile
  getCurrentUser,
  updateUserProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  // saved places
  savePlace,
  unsavePlace,
  getSavedPlaces,
} from "../controllers/userController.js";
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

// User avatar storage — square crop, own folder
const storage = new CloudinaryStorage({
  cloudinary,
  params: () => ({
    folder: "UserAvatars",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    resource_type: "image",
    transformation: [
      { width: 600, height: 600, crop: "fill", gravity: "auto" },
    ],
  }),
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
    files: 1,
  },
});

// ──────────────────────────────────────────────────────────────
// Public — auth flows
// ──────────────────────────────────────────────────────────────
router.post("/register", registerUser);
router.post("/verify-otp", verifyUserOTP);
router.post("/resend-otp", resendOTP);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// ──────────────────────────────────────────────────────────────
// Private — profile (requires login)
// ──────────────────────────────────────────────────────────────
router.post("/logout", protect, logoutUser);
router.get("/me", protect, getCurrentUser);

router.put(
  "/profile",
  protect,
  upload.single("logo"),
  updateUserProfile
);

router.put("/change-password", protect, changePassword);

// ──────────────────────────────────────────────────────────────
// Private — saved places (bookmarked businesses)
// ──────────────────────────────────────────────────────────────
router.get("/saved-places", protect, getSavedPlaces);
router.post("/saved-places/:businessId", protect, savePlace);
router.delete("/saved-places/:businessId", protect, unsavePlace);

export default router;