import asyncHandler from "express-async-handler";
import Advertisement from "../models/advertisementModel.js";
import AdvertisementType from "../models/advertisementTypeModel.js";
import AdvertisementSlot from "../models/advertisementSlotModel.js";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  // slice uses `offset`, so honor it if present
  const offset = query.offset !== undefined
    ? Math.max(0, parseInt(query.offset, 10) || 0)
    : (page - 1) * limit;
  return { page, limit, skip: offset };
};

const isOwnerOrAdmin = (ad, user) => {
  if (!user) return false;
  if (user.role === "admin") return true;
  return ad.business?.toString() === user._id.toString();
};

const BUSINESS_POPULATE = "businessName email coverImage categorySlug";

// Utility: lazily flip approved ads past their endDate to "expired"
const autoExpire = async (filter = {}) => {
  await Advertisement.updateMany(
    {
      ...filter,
      status: "approved",
      endDate: { $lt: new Date() },
    },
    { $set: { status: "expired" } }
  );
};

// ══════════════════════════════════════════════════════════════
// PUBLIC — types & slots
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List active advertisement types
// @route   GET /api/advertisements/types
// @access  Public
// ──────────────────────────────────────────────────────────────
const listAdvertisementTypes = asyncHandler(async (req, res) => {
  const types = await AdvertisementType.find({ isActive: true }).sort({ name: 1 });

  res.status(200).json({
    success: true,
    data: types,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    List active advertisement slots
// @route   GET /api/advertisements/slots
// @access  Public
// ──────────────────────────────────────────────────────────────
const listAdvertisementSlots = asyncHandler(async (req, res) => {
  const slots = await AdvertisementSlot.find({ isActive: true }).sort({ name: 1 });

  res.status(200).json({
    success: true,
    data: slots,
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Create a new advertisement (starts as draft)
// @route   POST /api/advertisements/business
// @access  Private
// ──────────────────────────────────────────────────────────────
const createAdvertisement = asyncHandler(async (req, res) => {
  const {
    type,
    slot,
    title,
    description,
    link,
    startDate,
    endDate,
    budget,
  } = req.body;

  if (!type || !slot || !title || !startDate || !endDate) {
    res.status(400);
    throw new Error("type, slot, title, startDate and endDate are required");
  }

  if (new Date(startDate) >= new Date(endDate)) {
    res.status(400);
    throw new Error("endDate must be after startDate");
  }

  const [typeDoc, slotDoc] = await Promise.all([
    AdvertisementType.findById(type),
    AdvertisementSlot.findById(slot),
  ]);

  if (!typeDoc || !typeDoc.isActive) {
    res.status(400);
    throw new Error("Invalid or inactive advertisement type");
  }
  if (!slotDoc || !slotDoc.isActive) {
    res.status(400);
    throw new Error("Invalid or inactive advertisement slot");
  }

  // multer-storage-cloudinary puts the uploaded URL on req.file.path
  const image = req.file?.path;

  const advertisement = await Advertisement.create({
    business: req.user._id,
    type,
    slot,
    title,
    description,
    image,
    link,
    startDate,
    endDate,
    budget: budget || 0,
    status: "draft",
  });

  res.status(201).json({
    success: true,
    message: "Advertisement created as draft",
    data: advertisement,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    List the logged-in business's advertisements
// @route   GET /api/advertisements/business
// @access  Private
// ──────────────────────────────────────────────────────────────
const listMyAdvertisements = asyncHandler(async (req, res) => {
  await autoExpire({ business: req.user._id });

  const data = await Advertisement.find({ business: req.user._id })
    .sort({ createdAt: -1 })
    .populate("type", "name slug category dimensions")
    .populate("slot", "name slug position dimensions");

  res.status(200).json({
    success: true,
    data,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get one of my advertisements
// @route   GET /api/advertisements/business/:id
// @access  Private
// ──────────────────────────────────────────────────────────────
const getMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id)
    .populate("type", "name slug category dimensions")
    .populate("slot", "name slug position dimensions");

  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (!isOwnerOrAdmin(ad, req.user)) {
    res.status(403);
    throw new Error("Not authorized to view this advertisement");
  }

  res.status(200).json({
    success: true,
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update my advertisement
// @route   PUT /api/advertisements/business/:id
// @access  Private
// ──────────────────────────────────────────────────────────────
const updateMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not authorized to update this advertisement");
  }

  // Only draft, paused, or rejected ads can be edited (admins exempt)
  if (
    req.user.role !== "admin" &&
    !["draft", "rejected", "paused"].includes(ad.status)
  ) {
    res.status(400);
    throw new Error("Only draft, paused or rejected advertisements can be edited");
  }

  const editable = [
    "type",
    "slot",
    "title",
    "description",
    "link",
    "startDate",
    "endDate",
    "budget",
  ];

  editable.forEach((field) => {
    if (req.body[field] !== undefined) ad[field] = req.body[field];
  });

  if (req.file?.path) ad.image = req.file.path;

  if (new Date(ad.startDate) >= new Date(ad.endDate)) {
    res.status(400);
    throw new Error("endDate must be after startDate");
  }

  // Editing a rejected ad → back to draft for resubmission
  if (req.user.role !== "admin" && ad.status === "rejected") {
    ad.status = "draft";
    ad.rejectionReason = undefined;
    ad.rejectedAt = undefined;
    ad.rejectedBy = undefined;
  }

  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement updated",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Submit my advertisement for admin review
// @route   POST /api/advertisements/business/:id/submit
// @access  Private
// ──────────────────────────────────────────────────────────────
const submitMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to submit this advertisement");
  }

  if (!["draft", "rejected"].includes(ad.status)) {
    res.status(400);
    throw new Error("Only draft or rejected advertisements can be submitted");
  }

  if (!ad.image) {
    res.status(400);
    throw new Error("Advertisement image is required before submission");
  }

  if (new Date(ad.endDate) <= new Date()) {
    res.status(400);
    throw new Error("Advertisement end date is already in the past");
  }

  ad.status = "pending";
  ad.submittedAt = new Date();
  ad.rejectionReason = undefined;
  ad.rejectedAt = undefined;
  ad.rejectedBy = undefined;
  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement submitted for review",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Pause an approved advertisement
// @route   POST /api/advertisements/business/:id/pause
// @access  Private
// ──────────────────────────────────────────────────────────────
const pauseMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to pause this advertisement");
  }

  if (ad.status !== "approved") {
    res.status(400);
    throw new Error("Only approved advertisements can be paused");
  }

  ad.status = "paused";
  ad.pauseReason = req.body?.reason || "Paused by owner";
  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement paused",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Resume a paused advertisement
// @route   POST /api/advertisements/business/:id/resume
// @access  Private
// ──────────────────────────────────────────────────────────────
const resumeMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Not authorized to resume this advertisement");
  }

  if (ad.status !== "paused") {
    res.status(400);
    throw new Error("Only paused advertisements can be resumed");
  }

  if (new Date(ad.endDate) <= new Date()) {
    ad.status = "expired";
    await ad.save();
    res.status(400);
    throw new Error("Advertisement has already expired");
  }

  ad.status = "approved";
  ad.pauseReason = undefined;
  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement resumed",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete my advertisement
// @route   DELETE /api/advertisements/business/:id
// @access  Private
// ──────────────────────────────────────────────────────────────
const deleteMyAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not authorized to delete this advertisement");
  }

  await ad.deleteOne();

  res.status(200).json({
    success: true,
    message: "Advertisement deleted successfully",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Performance report for one advertisement
// @route   GET /api/advertisements/business/:id/performance?from=&to=
// @access  Private
// ──────────────────────────────────────────────────────────────
const getMyAdvertisementPerformance = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id).select(
    "business title status impressions clicks conversions dailyStats"
  );

  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.business.toString() !== req.user._id.toString() && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Not authorized to view this advertisement");
  }

  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    res.status(400);
    throw new Error("Invalid from/to date");
  }

  const series = (ad.dailyStats || [])
    .filter((d) => d.date >= from && d.date <= to)
    .sort((a, b) => a.date - b.date);

  const totals = series.reduce(
    (acc, d) => {
      acc.impressions += d.impressions || 0;
      acc.clicks += d.clicks || 0;
      acc.conversions += d.conversions || 0;
      return acc;
    },
    { impressions: 0, clicks: 0, conversions: 0 }
  );

  const ctr =
    totals.impressions > 0
      ? Number(((totals.clicks / totals.impressions) * 100).toFixed(2))
      : 0;

  res.status(200).json({
    success: true,
    data: {
      advertisement: {
        _id: ad._id,
        title: ad.title,
        status: ad.status,
      },
      range: { from, to },
      totals: { ...totals, ctr },
      series,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — stats
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Global advertisement stats
// @route   GET /api/advertisements/admin/stats?from=
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminAdvertisementStats = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : null;

  const match = {};
  if (from && !Number.isNaN(from.getTime())) {
    match.createdAt = { $gte: from };
  }

  const [byStatus, totals, topAds] = await Promise.all([
    Advertisement.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Advertisement.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          impressions: { $sum: "$impressions" },
          clicks: { $sum: "$clicks" },
          conversions: { $sum: "$conversions" },
          totalAds: { $sum: 1 },
        },
      },
    ]),
    Advertisement.find(match)
      .sort({ impressions: -1 })
      .limit(5)
      .populate("business", "businessName")
      .select("title impressions clicks status business"),
  ]);

  const totalsObj = totals[0] || {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    totalAds: 0,
  };
  const ctr =
    totalsObj.impressions > 0
      ? Number(((totalsObj.clicks / totalsObj.impressions) * 100).toFixed(2))
      : 0;

  const statusMap = byStatus.reduce((acc, s) => {
    acc[s._id] = s.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      totals: { ...totalsObj, ctr },
      byStatus: statusMap,
      topAdvertisements: topAds,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — types
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Admin list all advertisement types
// @route   GET /api/advertisements/admin/types
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminListAdvertisementTypes = asyncHandler(async (req, res) => {
  const types = await AdvertisementType.find().sort({ name: 1 });
  res.status(200).json({ success: true, data: types });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin create an advertisement type
// @route   POST /api/advertisements/admin/types
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminCreateAdvertisementType = asyncHandler(async (req, res) => {
  const { name, slug, description, category, dimensions, isActive } = req.body;

  if (!name || !slug) {
    res.status(400);
    throw new Error("name and slug are required");
  }

  const exists = await AdvertisementType.findOne({
    $or: [{ name }, { slug: slug.toLowerCase() }],
  });
  if (exists) {
    res.status(409);
    throw new Error("Advertisement type with this name or slug already exists");
  }

  const type = await AdvertisementType.create({
    name,
    slug,
    description,
    category,
    dimensions,
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    success: true,
    message: "Advertisement type created",
    data: type,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin update an advertisement type
// @route   PUT /api/advertisements/admin/types/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminUpdateAdvertisementType = asyncHandler(async (req, res) => {
  const type = await AdvertisementType.findById(req.params.id);
  if (!type) {
    res.status(404);
    throw new Error("Advertisement type not found");
  }

  ["name", "slug", "description", "category", "dimensions", "isActive"].forEach(
    (field) => {
      if (req.body[field] !== undefined) type[field] = req.body[field];
    }
  );

  await type.save();

  res.status(200).json({
    success: true,
    message: "Advertisement type updated",
    data: type,
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — slots
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Admin list all advertisement slots
// @route   GET /api/advertisements/admin/slots
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminListAdvertisementSlots = asyncHandler(async (req, res) => {
  const slots = await AdvertisementSlot.find().sort({ name: 1 });

  // Attach count of currently active ads per slot (useful for admin UI)
  const counts = await Advertisement.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: "$slot", count: { $sum: 1 } } },
  ]);
  const countMap = counts.reduce((acc, c) => {
    acc[c._id.toString()] = c.count;
    return acc;
  }, {});

  const data = slots.map((s) => ({
    ...s.toObject(),
    activeAdsCount: countMap[s._id.toString()] || 0,
  }));

  res.status(200).json({ success: true, data });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin create an advertisement slot
// @route   POST /api/advertisements/admin/slots
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminCreateAdvertisementSlot = asyncHandler(async (req, res) => {
  const {
    name,
    slug,
    description,
    position,
    dimensions,
    maxActiveAds,
    basePrice,
    isActive,
  } = req.body;

  if (!name || !slug) {
    res.status(400);
    throw new Error("name and slug are required");
  }

  const exists = await AdvertisementSlot.findOne({
    $or: [{ name }, { slug: slug.toLowerCase() }],
  });
  if (exists) {
    res.status(409);
    throw new Error("Advertisement slot with this name or slug already exists");
  }

  const slot = await AdvertisementSlot.create({
    name,
    slug,
    description,
    position,
    dimensions,
    maxActiveAds,
    basePrice,
    isActive: isActive !== undefined ? isActive : true,
  });

  res.status(201).json({
    success: true,
    message: "Advertisement slot created",
    data: slot,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin update an advertisement slot
// @route   PUT /api/advertisements/admin/slots/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminUpdateAdvertisementSlot = asyncHandler(async (req, res) => {
  const slot = await AdvertisementSlot.findById(req.params.id);
  if (!slot) {
    res.status(404);
    throw new Error("Advertisement slot not found");
  }

  [
    "name",
    "slug",
    "description",
    "position",
    "dimensions",
    "maxActiveAds",
    "basePrice",
    "isActive",
  ].forEach((field) => {
    if (req.body[field] !== undefined) slot[field] = req.body[field];
  });

  await slot.save();

  res.status(200).json({
    success: true,
    message: "Advertisement slot updated",
    data: slot,
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — advertisements
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Admin list advertisements with filters
// @route   GET /api/advertisements/admin
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminListAdvertisements = asyncHandler(async (req, res) => {
  await autoExpire();

  const { limit, skip } = getPagination(req.query);

  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.business_id) filter.business = req.query.business_id;
  if (req.query.slot_id) filter.slot = req.query.slot_id;
  if (req.query.type_id) filter.type = req.query.type_id;

  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to);
  }

  if (req.query.search) {
    filter.$or = [
      { title: { $regex: req.query.search, $options: "i" } },
      { description: { $regex: req.query.search, $options: "i" } },
    ];
  }

  const [items, total] = await Promise.all([
    Advertisement.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("business", BUSINESS_POPULATE)
      .populate("type", "name slug category")
      .populate("slot", "name slug position"),
    Advertisement.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        total,
        limit,
        offset: skip,
        hasMore: skip + items.length < total,
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin get advertisement by id
// @route   GET /api/advertisements/admin/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminGetAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id)
    .populate("business", BUSINESS_POPULATE)
    .populate("type", "name slug category dimensions")
    .populate("slot", "name slug position dimensions");

  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  res.status(200).json({ success: true, data: ad });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin approve advertisement
// @route   POST /api/advertisements/admin/:id/approve
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminApproveAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  if (ad.status === "approved") {
    res.status(400);
    throw new Error("Advertisement is already approved");
  }

  // Enforce slot capacity
  const slot = await AdvertisementSlot.findById(ad.slot);
  if (slot) {
    const activeCount = await Advertisement.countDocuments({
      slot: slot._id,
      status: "approved",
      _id: { $ne: ad._id },
    });
    if (activeCount >= slot.maxActiveAds) {
      res.status(400);
      throw new Error(
        `Slot capacity reached (${slot.maxActiveAds} max). Disable another ad first.`
      );
    }
  }

  ad.status = "approved";
  ad.approvedAt = new Date();
  ad.approvedBy = req.user._id;
  ad.rejectionReason = undefined;
  ad.rejectedAt = undefined;
  ad.rejectedBy = undefined;
  ad.pauseReason = undefined;
  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement approved",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin reject advertisement
// @route   POST /api/advertisements/admin/:id/reject
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminRejectAdvertisement = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  ad.status = "rejected";
  ad.rejectedAt = new Date();
  ad.rejectedBy = req.user._id;
  ad.rejectionReason = reason;
  await ad.save();

  res.status(200).json({
    success: true,
    message: "Advertisement rejected",
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin set advertisement status (approve/pause/disable etc)
// @route   PATCH /api/advertisements/admin/:id/status
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminSetAdvertisementStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  const allowed = ["approved", "paused", "disabled", "expired"];
  if (!status || !allowed.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${allowed.join(", ")}`);
  }

  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  // When approving via status endpoint, reuse the approve handler logic
  if (status === "approved" && ad.status !== "approved") {
    const slot = await AdvertisementSlot.findById(ad.slot);
    if (slot) {
      const activeCount = await Advertisement.countDocuments({
        slot: slot._id,
        status: "approved",
        _id: { $ne: ad._id },
      });
      if (activeCount >= slot.maxActiveAds) {
        res.status(400);
        throw new Error(`Slot capacity reached (${slot.maxActiveAds} max)`);
      }
    }
    ad.approvedAt = new Date();
    ad.approvedBy = req.user._id;
  }

  ad.status = status;
  if (status !== "paused") ad.pauseReason = undefined;
  await ad.save();

  res.status(200).json({
    success: true,
    message: `Advertisement status set to ${status}`,
    data: ad,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Admin delete advertisement
// @route   DELETE /api/advertisements/admin/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminDeleteAdvertisement = asyncHandler(async (req, res) => {
  const ad = await Advertisement.findById(req.params.id);
  if (!ad) {
    res.status(404);
    throw new Error("Advertisement not found");
  }

  await ad.deleteOne();

  res.status(200).json({
    success: true,
    message: "Advertisement deleted successfully",
  });
});

export {
  // public
  listAdvertisementTypes,
  listAdvertisementSlots,
  // business
  createAdvertisement,
  listMyAdvertisements,
  getMyAdvertisement,
  updateMyAdvertisement,
  submitMyAdvertisement,
  pauseMyAdvertisement,
  resumeMyAdvertisement,
  deleteMyAdvertisement,
  getMyAdvertisementPerformance,
  // admin — stats
  adminAdvertisementStats,
  // admin — types
  adminListAdvertisementTypes,
  adminCreateAdvertisementType,
  adminUpdateAdvertisementType,
  // admin — slots
  adminListAdvertisementSlots,
  adminCreateAdvertisementSlot,
  adminUpdateAdvertisementSlot,
  // admin — ads
  adminListAdvertisements,
  adminGetAdvertisement,
  adminApproveAdvertisement,
  adminRejectAdvertisement,
  adminSetAdvertisementStatus,
  adminDeleteAdvertisement,
};