import express from "express";
import {
  listBusinessReviews,
  getBusinessReviewStats,
  replyToReview,
  updateReviewReply,
  deleteReviewReply,
} from "../controllers/reviewController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/", listBusinessReviews);
router.get("/stats", getBusinessReviewStats);
router.post("/:id/reply", replyToReview);
router.put("/:id/reply", updateReviewReply);
router.delete("/:id/reply", deleteReviewReply);

export default router;