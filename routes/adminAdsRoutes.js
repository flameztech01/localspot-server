import express from "express";
import {
  adminAdvertisementStats,
  adminListAdvertisementTypes,
  adminCreateAdvertisementType,
  adminUpdateAdvertisementType,
  adminListAdvertisementSlots,
  adminCreateAdvertisementSlot,
  adminUpdateAdvertisementSlot,
  adminListAdvertisements,
  adminGetAdvertisement,
  adminApproveAdvertisement,
  adminRejectAdvertisement,
  adminSetAdvertisementStatus,
  adminDeleteAdvertisement,
} from "../controllers/adsController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Inline admin gate — assumes protect already set req.user
const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

router.use(protect, isAdmin);

// Stats — before /:id so it doesn't get swallowed
router.get("/stats", adminAdvertisementStats);

// Types
router.get("/types", adminListAdvertisementTypes);
router.post("/types", adminCreateAdvertisementType);
router.put("/types/:id", adminUpdateAdvertisementType);

// Slots
router.get("/slots", adminListAdvertisementSlots);
router.post("/slots", adminCreateAdvertisementSlot);
router.put("/slots/:id", adminUpdateAdvertisementSlot);

// Advertisements — list & :id actions
router.get("/", adminListAdvertisements);
router.get("/:id", adminGetAdvertisement);
router.post("/:id/approve", adminApproveAdvertisement);
router.post("/:id/reject", adminRejectAdvertisement);
router.patch("/:id/status", adminSetAdvertisementStatus);
router.delete("/:id", adminDeleteAdvertisement);

export default router;