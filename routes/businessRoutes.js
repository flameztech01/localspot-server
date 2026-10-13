// src/routes/businessRoutes.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import {
  // user-side application
  submitBusinessApplication,
  getMyBusinessApplication,
  updateBusinessApplication,
  withdrawBusinessApplication,
  // user-side KYC
  submitBusinessKYC,
  getMyBusinessKYC,
  updateBusinessKYC,
  // user-side activity
  getMyActivityLog,
  // public
  getPublicBusinesses,
  getPublicBusinessById,
  // admin — application
  listBusinessApplications,
  getBusinessApplicationById,
  approveBusinessApplication,
  rejectBusinessApplication,
  toggleBusinessFeatured,
  // admin — KYC
  listBusinessKYC,
  getBusinessKYCById,
  approveBusinessKYC,
  rejectBusinessKYC,
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

// Per-field storage:
//   logo              → square avatar
//   coverImage        → wide hero banner
//   images            → gallery (4:3 limit)
//   cacDocument       → raw file (image or pdf)
//   idDocument        → raw file (image or pdf)
//   activityProof     → storefront photo
//   utilityBill       → raw file (image or pdf)
//   regulatoryLicence → raw file (image or pdf)
const storage = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => {
    // Raw documents → store as-is in a documents folder
    const rawDocFields = [
      "cacDocument",
      "idDocument",
      "utilityBill",
      "regulatoryLicence",
    ];
    if (rawDocFields.includes(file.fieldname)) {
      return {
        folder: "BusinessApplications/Documents",
        resource_type: "auto",
        allowed_formats: ["jpg", "png", "jpeg", "webp", "pdf"],
      };
    }

    // Storefront / activity proof → image, moderate crop
    if (file.fieldname === "activityProof") {
      return {
        folder: "BusinessApplications/Activity",
        allowed_formats: ["jpg", "png", "jpeg", "webp"],
        resource_type: "image",
        transformation: [{ width: 1600, height: 1200, crop: "limit" }],
      };
    }

    const base = {
      folder: "BusinessApplications",
      allowed_formats: ["jpg", "png", "jpeg", "webp"],
      resource_type: "image",
    };

    if (file.fieldname === "logo") {
      return {
        ...base,
        transformation: [
          { width: 600, height: 600, crop: "fill", gravity: "auto" },
        ],
      };
    }

    if (file.fieldname === "coverImage") {
      return {
        ...base,
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
    files: 23, // 20 gallery + 1 cover + 1 logo + 1 CAC document
  },
});

// ──────────────────────────────────────────────────────────────
// Field maps
// ──────────────────────────────────────────────────────────────

// Application upload: full profile submission
const businessApplicationUpload = upload.fields([
  { name: "images", maxCount: 20 },
  { name: "logo", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
  { name: "cacDocument", maxCount: 1 },
]);

// KYC upload: verification documents.
// Also accepts optional logo / cover / gallery so a fresh signup
// can send everything through /kyc if they never hit /apply.
const businessKYCUpload = upload.fields([
  { name: "idDocument", maxCount: 1 },
  { name: "cacDocument", maxCount: 1 },
  { name: "activityProof", maxCount: 1 },
  { name: "utilityBill", maxCount: 1 },
  { name: "regulatoryLicence", maxCount: 1 },
  { name: "logo", maxCount: 1 },
  { name: "coverImage", maxCount: 1 },
  { name: "images", maxCount: 20 },
]);

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
// Signed-in user — business application
// ──────────────────────────────────────────────────────────────
router.post(
  "/apply",
  protect,
  businessApplicationUpload,
  submitBusinessApplication
);

router.get("/application", protect, getMyBusinessApplication);

router.put(
  "/application",
  protect,
  businessApplicationUpload,
  updateBusinessApplication
);

router.delete("/application", protect, withdrawBusinessApplication);

// ──────────────────────────────────────────────────────────────
// Signed-in user — KYC / Trust Badge
// ──────────────────────────────────────────────────────────────
router.post("/kyc", protect, businessKYCUpload, submitBusinessKYC);

router.get("/kyc", protect, getMyBusinessKYC);

router.put("/kyc", protect, businessKYCUpload, updateBusinessKYC);

// ──────────────────────────────────────────────────────────────
// Signed-in user — activity log
// ──────────────────────────────────────────────────────────────
router.get("/activity", protect, getMyActivityLog);

// ──────────────────────────────────────────────────────────────
// Admin only — review & manage business applications
// ──────────────────────────────────────────────────────────────
router.get("/applications", protect, isAdmin, listBusinessApplications);

router.get(
  "/applications/:id",
  protect,
  isAdmin,
  getBusinessApplicationById
);

router.patch(
  "/applications/:id/approve",
  protect,
  isAdmin,
  approveBusinessApplication
);

router.patch(
  "/applications/:id/reject",
  protect,
  isAdmin,
  rejectBusinessApplication
);

router.patch(
  "/applications/:id/feature",
  protect,
  isAdmin,
  toggleBusinessFeatured
);

// ──────────────────────────────────────────────────────────────
// Admin only — review & manage KYC submissions
// ──────────────────────────────────────────────────────────────
router.get("/kyc-submissions", protect, isAdmin, listBusinessKYC);

router.get(
  "/kyc-submissions/:id",
  protect,
  isAdmin,
  getBusinessKYCById
);

router.patch(
  "/kyc-submissions/:id/approve",
  protect,
  isAdmin,
  approveBusinessKYC
);

router.patch(
  "/kyc-submissions/:id/reject",
  protect,
  isAdmin,
  rejectBusinessKYC
);

export default router;