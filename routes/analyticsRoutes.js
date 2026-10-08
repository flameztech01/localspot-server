import express from "express";
import {
  getBusinessAnalytics,
  getAdminAnalyticsOverview,
  getAdminAnalyticsTraffic,
  getAdminAnalyticsBusinesses,
  getAdminAnalyticsCategories,
  getAdminAnalyticsLocations,
  getAdminAnalyticsAdvertising,
  getAdminAnalyticsRevenue,
} from "../controllers/analyticsController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Inline admin gate
const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

// Business
router.get("/business", protect, getBusinessAnalytics);

// Admin
router.get("/admin/overview", protect, isAdmin, getAdminAnalyticsOverview);
router.get("/admin/traffic", protect, isAdmin, getAdminAnalyticsTraffic);
router.get("/admin/businesses", protect, isAdmin, getAdminAnalyticsBusinesses);
router.get("/admin/categories", protect, isAdmin, getAdminAnalyticsCategories);
router.get("/admin/locations", protect, isAdmin, getAdminAnalyticsLocations);
router.get("/admin/advertising", protect, isAdmin, getAdminAnalyticsAdvertising);
router.get("/admin/revenue", protect, isAdmin, getAdminAnalyticsRevenue);

export default router;