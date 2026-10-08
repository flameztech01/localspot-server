import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Review from "../models/reviewModel.js";
import User from "../models/userModel.js";
import { updateBusinessRating } from "../utils/updateBusinessRating.js";

// ══════════════════════════════════════════════════════════════
// CUSTOMER SIDE — /api/v1/reviews
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Create a review for a business
// @route   POST /api/v1/reviews
// @access  Private
// ──────────────────────────────────────────────────────────────
const createReview = asyncHandler(async (req, res) => {
  const { businessId, rating, comment, images } = req.body;

  if (!businessId || rating === undefined) {
    res.status(400);
    throw new Error("businessId and rating are required");
  }

  const r = Number(rating);
  if (Number.isNaN(r) || r < 1 || r > 5) {
    res.status(400);
    throw new Error("Rating must be between 1 and 5");
  }

  const business = await User.findOne({ _id: businessId, role: "business" });
  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const existing = await Review.findOne({
    business: businessId,
    user: req.user._id,
  });
  if (existing) {
    res.status(409);
    throw new Error("You already reviewed this business");
  }

  const review = await Review.create({
    business: businessId,
    user: req.user._id,
    rating: r,
    comment: comment || "",
    images: Array.isArray(images) ? images : [],
  });

  await updateBusinessRating(business._id);

  res.status(201).json({
    success: true,
    message: "Review submitted",
    data: review,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    List a business's visible reviews (public)
// @route   GET /api/v1/reviews/business/:businessId
// @access  Public
// ──────────────────────────────────────────────────────────────
const listBusinessReviewsPublic = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const filter = { business: businessId, isVisible: true };
  if (req.query.rating) {
    const r = Number(req.query.rating);
    if (r >= 1 && r <= 5) filter.rating = r;
  }

  const [data, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "fullName profilePhoto"),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Public rating distribution for a business
// @route   GET /api/v1/reviews/business/:businessId/stats
// @access  Public
// ──────────────────────────────────────────────────────────────
const getBusinessReviewStatsPublic = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    res.status(400);
    throw new Error("Invalid business id");
  }

  const id = new mongoose.Types.ObjectId(businessId);

  const [agg, distribution] = await Promise.all([
    Review.aggregate([
      { $match: { business: id, isVisible: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          total: { $sum: 1 },
        },
      },
    ]),
    Review.aggregate([
      { $match: { business: id, isVisible: true } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const base = agg[0] || { avgRating: 0, total: 0 };
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach((d) => {
    if (dist[d._id] !== undefined) dist[d._id] = d.count;
  });

  res.status(200).json({
    success: true,
    data: {
      averageRating: Number(base.avgRating.toFixed(2)),
      totalReviews: base.total,
      distribution: dist,
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get my review for a specific business
// @route   GET /api/v1/reviews/mine/:businessId
// @access  Private
// ──────────────────────────────────────────────────────────────
const getMyReviewForBusiness = asyncHandler(async (req, res) => {
  const review = await Review.findOne({
    business: req.params.businessId,
    user: req.user._id,
  });

  if (!review) {
    res.status(404);
    throw new Error("You haven't reviewed this business yet");
  }

  res.status(200).json({
    success: true,
    data: review,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update my review
// @route   PUT /api/v1/reviews/:id
// @access  Private
// ──────────────────────────────────────────────────────────────
const updateMyReview = asyncHandler(async (req, res) => {
  const { rating, comment, images } = req.body;

  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }

  if (review.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to update this review");
  }

  if (rating !== undefined) {
    const r = Number(rating);
    if (Number.isNaN(r) || r < 1 || r > 5) {
      res.status(400);
      throw new Error("Rating must be between 1 and 5");
    }
    review.rating = r;
  }

  if (comment !== undefined) review.comment = comment;
  if (Array.isArray(images)) review.images = images;

  await review.save();
  await updateBusinessRating(review.business);

  res.status(200).json({
    success: true,
    message: "Review updated",
    data: review,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete my review (owner or admin)
// @route   DELETE /api/v1/reviews/:id
// @access  Private
// ──────────────────────────────────────────────────────────────
const deleteMyReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }

  const isOwner = review.user.toString() === req.user._id.toString();
  const isAdmin = req.user.role === "admin";

  if (!isOwner && !isAdmin) {
    res.status(403);
    throw new Error("Not authorized to delete this review");
  }

  const businessId = review.business;
  await review.deleteOne();
  await updateBusinessRating(businessId);

  res.status(200).json({
    success: true,
    message: "Review deleted",
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS SIDE — /api/v1/business/reviews
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List reviews for the logged-in business
// @route   GET /api/v1/business/reviews
// @access  Private (business owner)
// ──────────────────────────────────────────────────────────────
const listBusinessReviews = asyncHandler(async (req, res) => {
  const businessId = req.user._id;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { business: businessId, isVisible: true };

  if (req.query.rating) {
    const r = Number(req.query.rating);
    if (r >= 1 && r <= 5) filter.rating = r;
  }

  if (req.query.replied === "true") {
    filter["reply.text"] = { $nin: [null, undefined, ""] };
  } else if (req.query.replied === "false") {
    filter["reply.text"] = { $in: [null, undefined, ""] };
  }

  if (req.query.q) {
    const q = new RegExp(req.query.q, "i");
    filter.$or = [{ comment: q }];
  }

  const [data, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "fullName profilePhoto email"),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Stats for the logged-in business's reviews
// @route   GET /api/v1/business/reviews/stats
// @access  Private (business owner)
// ──────────────────────────────────────────────────────────────
const getBusinessReviewStats = asyncHandler(async (req, res) => {
  const businessId = new mongoose.Types.ObjectId(req.user._id);

  const [agg, distribution, repliedCount] = await Promise.all([
    Review.aggregate([
      { $match: { business: businessId, isVisible: true } },
      {
        $group: {
          _id: null,
          avgRating: { $avg: "$rating" },
          total: { $sum: 1 },
        },
      },
    ]),
    Review.aggregate([
      { $match: { business: businessId, isVisible: true } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
    Review.countDocuments({
      business: businessId,
      isVisible: true,
      "reply.text": { $nin: [null, undefined, ""] },
    }),
  ]);

  const base = agg[0] || { avgRating: 0, total: 0 };
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  distribution.forEach((d) => {
    if (dist[d._id] !== undefined) dist[d._id] = d.count;
  });

  res.status(200).json({
    success: true,
    data: {
      averageRating: Number(base.avgRating.toFixed(2)),
      totalReviews: base.total,
      distribution: dist,
      repliedCount,
      unrepliedCount: base.total - repliedCount,
      responseRate:
        base.total > 0 ? Math.round((repliedCount / base.total) * 100) : 0,
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Reply to a review
// @route   POST /api/v1/business/reviews/:id/reply
// @access  Private (business owner)
// ──────────────────────────────────────────────────────────────
const replyToReview = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text?.trim()) {
    res.status(400);
    throw new Error("Reply text is required");
  }
  if (text.length > 500) {
    res.status(400);
    throw new Error("Reply is too long (max 500 characters)");
  }

  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }
  if (review.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to reply to this review");
  }
  if (review.reply?.text) {
    res.status(400);
    throw new Error("You have already replied. Use PUT to update.");
  }

  review.reply = {
    text: text.trim(),
    repliedAt: new Date(),
    repliedBy: req.user._id,
  };
  await review.save();

  res.status(200).json({
    success: true,
    message: "Reply posted",
    data: review,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update a reply
// @route   PUT /api/v1/business/reviews/:id/reply
// @access  Private (business owner)
// ──────────────────────────────────────────────────────────────
const updateReviewReply = asyncHandler(async (req, res) => {
  const { text } = req.body;

  if (!text?.trim()) {
    res.status(400);
    throw new Error("Reply text is required");
  }
  if (text.length > 500) {
    res.status(400);
    throw new Error("Reply is too long (max 500 characters)");
  }

  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }
  if (review.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to edit this reply");
  }
  if (!review.reply?.text) {
    res.status(400);
    throw new Error("No reply to update");
  }

  review.reply.text = text.trim();
  review.reply.repliedAt = new Date();
  review.reply.repliedBy = req.user._id;
  await review.save();

  res.status(200).json({
    success: true,
    message: "Reply updated",
    data: review,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete a reply
// @route   DELETE /api/v1/business/reviews/:id/reply
// @access  Private (business owner)
// ──────────────────────────────────────────────────────────────
const deleteReviewReply = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) {
    res.status(404);
    throw new Error("Review not found");
  }
  if (review.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to delete this reply");
  }

  review.reply = undefined;
  await review.save();

  res.status(200).json({
    success: true,
    message: "Reply deleted",
    data: review,
  });
});

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════
export {
  // customer side
  createReview,
  listBusinessReviewsPublic,
  getBusinessReviewStatsPublic,
  getMyReviewForBusiness,
  updateMyReview,
  deleteMyReview,
  // business side
  listBusinessReviews,
  getBusinessReviewStats,
  replyToReview,
  updateReviewReply,
  deleteReviewReply,
};