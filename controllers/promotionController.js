import asyncHandler from "express-async-handler";
import Promotion from "../models/promotionModel.js";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
};

const isOwnerOrAdmin = (promotion, user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  return promotion.business?.toString() === user._id.toString();
};

const BUSINESS_POPULATE =
  "businessName coverImage categorySlug location rating numReviews";

// ──────────────────────────────────────────────────────────────
// @desc    List public (approved & currently active) promotions
// @route   GET /api/v1/promotions
// @access  Public
// ──────────────────────────────────────────────────────────────
const listPublicPromotions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const now = new Date();

  const filter = {
    status: "approved",
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (req.query.businessId) {
    filter.business = req.query.businessId;
  }

  const [items, total] = await Promise.all([
    Promotion.find(filter)
      .sort({ endDate: 1 })
      .skip(skip)
      .limit(limit)
      .populate("business", BUSINESS_POPULATE),
    Promotion.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get a single promotion (public if active; owner/admin
//          can see any status)
// @route   GET /api/v1/promotions/:id
// @access  Public (optional auth)
// ──────────────────────────────────────────────────────────────
const getPromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id).populate(
    "business",
    BUSINESS_POPULATE
  );

  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  const now = new Date();
  const isActive =
    promotion.status === "approved" &&
    promotion.startDate <= now &&
    promotion.endDate >= now;

  if (!isActive && !isOwnerOrAdmin(promotion, req.user)) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  res.status(200).json({
    success: true,
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    List the logged-in business's own promotions
// @route   GET /api/v1/promotions/mine/all
// @access  Private
// ──────────────────────────────────────────────────────────────
const listMyPromotions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { business: req.user._id };
  if (req.query.status) filter.status = req.query.status;

  const [data, total] = await Promise.all([
    Promotion.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Promotion.countDocuments(filter),
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
// @desc    Create a promotion (starts as draft)
// @route   POST /api/v1/promotions
// @access  Private
// ──────────────────────────────────────────────────────────────
const createPromotion = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    discountType,
    discountValue,
    promoCode,
    startDate,
    endDate,
  } = req.body;

  if (!title || !startDate || !endDate) {
    res.status(400);
    throw new Error("Title, startDate and endDate are required");
  }

  if (new Date(startDate) >= new Date(endDate)) {
    res.status(400);
    throw new Error("endDate must be after startDate");
  }

  // multer-storage-cloudinary puts the uploaded URL on req.file.path
  const image = req.file?.path;

  const promotion = await Promotion.create({
    business: req.user._id,
    title,
    description,
    image,
    discountType: discountType || "percent",
    discountValue,
    promoCode,
    startDate,
    endDate,
    status: "draft",
  });

  res.status(201).json({
    success: true,
    message: "Promotion created as draft",
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update a promotion
// @route   PUT /api/v1/promotions/:id
// @access  Private (owner or admin)
// ──────────────────────────────────────────────────────────────
const updatePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  if (!isOwnerOrAdmin(promotion, req.user)) {
    res.status(403);
    throw new Error("Not authorized to update this promotion");
  }

  // Owners can only touch drafts and rejected promotions.
  // Admins can edit anything.
  if (
    req.user.role !== "admin" &&
    !["draft", "rejected"].includes(promotion.status)
  ) {
    res.status(400);
    throw new Error("Only draft or rejected promotions can be edited");
  }

  const editable = [
    "title",
    "description",
    "discountType",
    "discountValue",
    "promoCode",
    "startDate",
    "endDate",
  ];

  editable.forEach((field) => {
    if (req.body[field] !== undefined) promotion[field] = req.body[field];
  });

  if (req.file?.path) {
    promotion.image = req.file.path;
  }

  if (
    new Date(promotion.startDate) >= new Date(promotion.endDate)
  ) {
    res.status(400);
    throw new Error("endDate must be after startDate");
  }

  // Owner editing a rejected promotion → back to draft for resubmission
  if (req.user.role !== "admin" && promotion.status === "rejected") {
    promotion.status = "draft";
    promotion.rejectionReason = undefined;
    promotion.rejectedAt = undefined;
    promotion.rejectedBy = undefined;
  }

  await promotion.save();

  res.status(200).json({
    success: true,
    message: "Promotion updated",
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete a promotion
// @route   DELETE /api/v1/promotions/:id
// @access  Private (owner or admin)
// ──────────────────────────────────────────────────────────────
const deletePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  if (!isOwnerOrAdmin(promotion, req.user)) {
    res.status(403);
    throw new Error("Not authorized to delete this promotion");
  }

  await promotion.deleteOne();

  res.status(200).json({
    success: true,
    message: "Promotion deleted successfully",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Submit a promotion for admin review
// @route   POST /api/v1/promotions/:id/submit
// @access  Private (owner only)
// ──────────────────────────────────────────────────────────────
const submitPromotionForReview = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  if (promotion.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to submit this promotion");
  }

  if (!["draft", "rejected"].includes(promotion.status)) {
    res.status(400);
    throw new Error("Only draft or rejected promotions can be submitted");
  }

  if (!promotion.image) {
    res.status(400);
    throw new Error("Promotion image is required before submission");
  }

  if (new Date(promotion.endDate) <= new Date()) {
    res.status(400);
    throw new Error("Promotion end date is already in the past");
  }

  promotion.status = "pending";
  promotion.submittedAt = new Date();
  promotion.rejectionReason = undefined;
  promotion.rejectedAt = undefined;
  promotion.rejectedBy = undefined;
  await promotion.save();

  res.status(200).json({
    success: true,
    message: "Promotion submitted for review",
    data: promotion,
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List promotions for admin (any status)
// @route   GET /api/v1/promotions/admin
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminListPromotions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.businessId) filter.business = req.query.businessId;

  const [items, total] = await Promise.all([
    Promotion.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("business", "businessName email coverImage"),
    Promotion.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    items,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get any promotion by id (admin)
// @route   GET /api/v1/promotions/admin/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminGetPromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id).populate(
    "business",
    "businessName email coverImage location rating"
  );

  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  res.status(200).json({
    success: true,
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Approve a pending promotion
// @route   POST /api/v1/promotions/admin/:id/approve
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminApprovePromotion = asyncHandler(async (req, res) => {
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  if (promotion.status === "approved") {
    res.status(400);
    throw new Error("Promotion is already approved");
  }

  promotion.status = "approved";
  promotion.approvedAt = new Date();
  promotion.approvedBy = req.user._id;
  promotion.rejectionReason = undefined;
  promotion.rejectedAt = undefined;
  promotion.rejectedBy = undefined;
  promotion.disabledReason = undefined;
  promotion.disabledAt = undefined;
  promotion.disabledBy = undefined;
  await promotion.save();

  res.status(200).json({
    success: true,
    message: "Promotion approved",
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Reject a pending promotion
// @route   POST /api/v1/promotions/admin/:id/reject
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminRejectPromotion = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  promotion.status = "rejected";
  promotion.rejectedAt = new Date();
  promotion.rejectedBy = req.user._id;
  promotion.rejectionReason = reason;
  await promotion.save();

  res.status(200).json({
    success: true,
    message: "Promotion rejected",
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Disable an approved promotion (admin)
// @route   POST /api/v1/promotions/admin/:id/disable
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminDisablePromotion = asyncHandler(async (req, res) => {
  const { reason } = req.body || {};

  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) {
    res.status(404);
    throw new Error("Promotion not found");
  }

  if (promotion.status === "disabled") {
    res.status(400);
    throw new Error("Promotion is already disabled");
  }

  promotion.status = "disabled";
  promotion.disabledAt = new Date();
  promotion.disabledBy = req.user._id;
  promotion.disabledReason = reason || "Disabled by admin";
  await promotion.save();

  res.status(200).json({
    success: true,
    message: "Promotion disabled",
    data: promotion,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Permanently delete all expired promotions
// @route   DELETE /api/v1/promotions/admin/expired
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminRemoveExpiredPromotions = asyncHandler(async (req, res) => {
  const result = await Promotion.deleteMany({
    endDate: { $lt: new Date() },
  });

  res.status(200).json({
    success: true,
    message: `Removed ${result.deletedCount} expired promotion(s)`,
    deletedCount: result.deletedCount,
  });
});

export {
  listPublicPromotions,
  getPromotion,
  listMyPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  submitPromotionForReview,
  adminListPromotions,
  adminGetPromotion,
  adminApprovePromotion,
  adminRejectPromotion,
  adminDisablePromotion,
  adminRemoveExpiredPromotions,
};