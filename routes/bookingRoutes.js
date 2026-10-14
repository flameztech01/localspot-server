// src/routes/bookingRoutes.js
import express from "express";
import {
  // form schema
  getBookingFormSchema,
  // customer
  createBooking,
  getMyBookings,
  getBookingById,
  cancelBooking,
  // business
  getBusinessBookings,
  getBusinessBookingStats,
  confirmBooking,
  rejectBooking,
  completeBooking,
  markBookingNoShow,
  // admin
  listAllBookings,
  adminCancelBooking,
} from "../controllers/bookingController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// Inline role gates (run after `protect`)
// ──────────────────────────────────────────────────────────────
const isBusiness = (req, res, next) => {
  if (!req.user || (req.user.role !== "business" && !req.user.businessVerified)) {
    res.status(403);
    return next(new Error("Business access only"));
  }
  next();
};

const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

// ──────────────────────────────────────────────────────────────
// Form schema — tells the client which fields to render
// ──────────────────────────────────────────────────────────────
router.get("/form/:businessId", protect, getBookingFormSchema);

// ──────────────────────────────────────────────────────────────
// Customer routes
// ──────────────────────────────────────────────────────────────
router.post("/:businessId", protect, createBooking);
router.get("/my", protect, getMyBookings);
router.get("/:id", protect, getBookingById);
router.patch("/:id/cancel", protect, cancelBooking);

// ──────────────────────────────────────────────────────────────
// Business routes
// ──────────────────────────────────────────────────────────────
router.get("/business", protect, isBusiness, getBusinessBookings);
router.get("/business/stats", protect, isBusiness, getBusinessBookingStats);
router.patch("/:id/confirm", protect, isBusiness, confirmBooking);
router.patch("/:id/reject", protect, isBusiness, rejectBooking);
router.patch("/:id/complete", protect, isBusiness, completeBooking);
router.patch("/:id/no-show", protect, isBusiness, markBookingNoShow);

// ──────────────────────────────────────────────────────────────
// Admin routes
// ──────────────────────────────────────────────────────────────
router.get("/admin", protect, isAdmin, listAllBookings);
router.patch("/admin/:id/cancel", protect, isAdmin, adminCancelBooking);

export default router;