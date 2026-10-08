// routes/reviewRoutes.js
import express from "express";
import {
  createReview,
  listBusinessReviewsPublic,
  getBusinessReviewStatsPublic,
  getMyReviewForBusiness,
  updateMyReview,
  deleteMyReview,
} from "../controllers/reviewController.js";
import { protect, optionalProtect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ──────────────────────────────────────────────────────────────
// Public — anyone can browse a business's reviews
// ──────────────────────────────────────────────────────────────

// GET /api/v1/reviews/business/:businessId?rating=&page=&limit=
// List all visible reviews for a given business
router.get("/business/:businessId", listBusinessReviewsPublic);

// GET /api/v1/reviews/business/:businessId/stats
// Distribution + average for a given business
router.get("/business/:businessId/stats", getBusinessReviewStatsPublic);

// ──────────────────────────────────────────────────────────────
// Private — the logged-in user's own review
// ──────────────────────────────────────────────────────────────

// GET /api/v1/reviews/mine/:businessId
// Returns the current user's review for a business (404 if none)
router.get("/mine/:businessId", protect, getMyReviewForBusiness);

// POST /api/v1/reviews
// Body: { businessId, rating, comment?, images? }
router.post("/", protect, createReview);

// PUT /api/v1/reviews/:id
// Body: { rating?, comment?, images? }  — owner only
router.put("/:id", protect, updateMyReview);

// DELETE /api/v1/reviews/:id  — owner or admin
router.delete("/:id", protect, deleteMyReview);

export default router;