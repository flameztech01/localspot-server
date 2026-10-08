import express from "express";
import {
  adminListPromotions,
  adminGetPromotion,
  adminApprovePromotion,
  adminRejectPromotion,
  adminDisablePromotion,
  adminRemoveExpiredPromotions,
} from "../controllers/promotionController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Small inline admin gate — assumes `protect` set req.user
const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

router.use(protect, isAdmin);

router.get("/", adminListPromotions);

// Must come before /:id
router.delete("/expired", adminRemoveExpiredPromotions);

router.get("/:id", adminGetPromotion);
router.post("/:id/approve", adminApprovePromotion);
router.post("/:id/reject", adminRejectPromotion);
router.post("/:id/disable", adminDisablePromotion);

export default router;