import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Category from "../models/categoryModel.js";
import Review from "../models/reviewModel.js";
import Promotion from "../models/promotionModel.js";
import Advertisement from "../models/advertisementModel.js";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const generateTempPassword = (len = 12) => {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
};

const isObjectId = (v) => mongoose.Types.ObjectId.isValid(v);

const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(query.limit, 10) || 20)
  );
  return { page, limit, skip: (page - 1) * limit };
};

// Serializer that never leaks secrets
const publicUser = (user) => {
  if (!user) return null;
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.password;
  delete u.otp;
  delete u.otpExpire;
  delete u.otpPurpose;
  delete u.__v;
  return u;
};

// ══════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List all users
// @route   GET /api/v1/admin/users
// @access  Private (admin)
// Query: role, status, q, page, limit
// ──────────────────────────────────────────────────────────────
const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};

  if (req.query.role && ["business", "admin"].includes(req.query.role)) {
    filter.role = req.query.role;
  }

  if (req.query.status === "active") filter.isActive = true;
  if (req.query.status === "suspended") filter.isActive = false;
  if (req.query.status === "verified") filter.isVerified = true;
  if (req.query.status === "unverified") filter.isVerified = false;

  if (req.query.q) {
    const q = new RegExp(req.query.q.trim(), "i");
    filter.$or = [
      { fullName: q },
      { businessName: q },
      { email: q },
      { phone: q },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: users.map(publicUser),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get one user by id
// @route   GET /api/v1/admin/users/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getUserById = asyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid user id");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({
    success: true,
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update a user's role
// @route   PATCH /api/v1/admin/users/:id/role
// @access  Private (admin)
// Body: { role: "business" | "admin" }
// ──────────────────────────────────────────────────────────────
const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!["business", "admin"].includes(role)) {
    res.status(400);
    throw new Error("role must be business or admin");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  // Prevent self-demotion
  if (user._id.toString() === req.user._id.toString() && role !== "admin") {
    res.status(400);
    throw new Error("You cannot change your own admin role");
  }

  user.role = role;
  await user.save();

  res.status(200).json({
    success: true,
    message: `Role updated to ${role}`,
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Toggle a user's active status (suspend / activate)
// @route   PATCH /api/v1/admin/users/:id/toggle-active
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const toggleUserActive = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error("You cannot suspend your own account");
  }

  user.isActive = !user.isActive;
  await user.save();

  res.status(200).json({
    success: true,
    message: user.isActive
      ? "Account reactivated"
      : "Account suspended",
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete a user and cascade-delete their data
// @route   DELETE /api/v1/admin/users/:id
// @access  Private (admin)
// Query: cascade=true to also remove reviews/promotions/ads
// ──────────────────────────────────────────────────────────────
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  if (user._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error("You cannot delete your own account");
  }

  const cascade = String(req.query.cascade).toLowerCase() === "true";
  const userId = user._id;

  if (cascade) {
    // Business-side data
    await Promise.all([
      Review.deleteMany({
        $or: [{ user: userId }, { business: userId }],
      }),
      Promotion.deleteMany({ business: userId }),
      Advertisement.deleteMany({ business: userId }),
    ]);
  }

  await user.deleteOne();

  res.status(200).json({
    success: true,
    message: cascade
      ? "User and related data deleted"
      : "User deleted",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Send a password-reset OTP to a user (admin-triggered)
// @route   POST /api/v1/admin/users/:id/send-password-reset
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const adminSendPasswordReset = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  user.otp = otp;
  user.otpExpire = Date.now() + 10 * 60 * 1000;
  user.otpPurpose = "password-reset";
  await user.save({ validateBeforeSave: false });

  // Reuse existing OTP email util
  try {
    const { sendOTPEmail } = await import("../utils/resendOTP.js");
    await sendOTPEmail({
      to: user.email,
      otp,
      purpose: "password-reset",
    });
  } catch (err) {
    console.error("[adminSendPasswordReset] mail failed:", err.message);
    // Don't fail the request just because email bounces
  }

  res.status(200).json({
    success: true,
    message: "Password reset code sent to user's email",
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS ADMIN — CREATE DIRECTLY
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Admin creates a business directly (pre-verified)
// @route   POST /api/v1/admin/businesses
// @access  Private (admin)
// Body: businessName, email, password?, phone, businessType,
//       businessKind, businessKindOther, address, description,
//       website, categorySlug, tags, priceRange, location,
//       openingHours, markVerified?
// ──────────────────────────────────────────────────────────────
const adminCreateBusiness = asyncHandler(async (req, res) => {
  const {
    businessName,
    email,
    password,
    phone,
    businessType,
    businessKind,
    businessKindOther,
    address,
    description,
    website,
    categorySlug,
    tags,
    priceRange,
    location,
    openingHours,
    markVerified = true,
  } = req.body;

  if (!businessName || !email) {
    res.status(400);
    throw new Error("businessName and email are required");
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409);
    throw new Error("An account with this email already exists");
  }

  const rawPassword = password && password.length >= 8
    ? password
    : generateTempPassword(12);

  const VALID_KINDS = [
    "hotels",
    "dining",
    "things_to_do",
    "shops",
    "others",
  ];
  if (businessKind && !VALID_KINDS.includes(businessKind)) {
    res.status(400);
    throw new Error(`Invalid businessKind`);
  }

  const user = new User({
    businessName,
    email: email.toLowerCase(),
    password: rawPassword,
    phone,
    businessType: businessType || "other",
    businessKind: businessKind || null,
    businessKindOther:
      businessKind === "others" ? businessKindOther || "" : undefined,
    address,
    description,
    website,
    categorySlug: categorySlug ? slugify(categorySlug) : undefined,
    tags: Array.isArray(tags) ? tags : [],
    priceRange: [1, 2, 3, 4].includes(Number(priceRange))
      ? Number(priceRange)
      : 2,
    location: location && typeof location === "object" ? location : undefined,
    openingHours: Array.isArray(openingHours) ? openingHours : [],
    role: "business",
    isVerified: true,
    businessVerified: !!markVerified,
    businessVerifiedAt: markVerified ? new Date() : undefined,
    businessVerifiedBy: markVerified ? req.user._id : undefined,
    isActive: true,
  });

  await user.save();

  res.status(201).json({
    success: true,
    message: markVerified
      ? "Business created and approved"
      : "Business created (pending approval)",
    data: publicUser(user),
    // Only returned when we generated the password, so admin can share it
    ...(password ? {} : { temporaryPassword: rawPassword }),
  });
});

// ══════════════════════════════════════════════════════════════
// FEATURED LISTINGS
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List all featured businesses
// @route   GET /api/v1/admin/featured
// @access  Private (admin)
// Query: activeOnly=true, page, limit
// ──────────────────────────────────────────────────────────────
const listFeaturedBusinesses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { role: "business", isFeatured: true };

  if (String(req.query.activeOnly).toLowerCase() === "true") {
    filter.$and = [
      {
        $or: [
          { featuredUntil: null },
          { featuredUntil: { $exists: false } },
          { featuredUntil: { $gt: new Date() } },
        ],
      },
    ];
  }

  const [businesses, total] = await Promise.all([
    User.find(filter)
      .sort({ featuredAt: -1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: businesses.map(publicUser),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Toggle featured for a business
// @route   PATCH /api/v1/admin/featured/:id
// @access  Private (admin)
// Body: { featured: bool, plan?, until?, notes? }
// ──────────────────────────────────────────────────────────────
const toggleBusinessFeatured = asyncHandler(async (req, res) => {
  const { featured, plan = null, until = null, notes = "" } = req.body;

  if (typeof featured !== "boolean") {
    res.status(400);
    throw new Error("`featured` must be a boolean");
  }

  if (plan && !["basic", "standard", "premium"].includes(plan)) {
    res.status(400);
    throw new Error("`plan` must be basic, standard, premium or null");
  }

  const business = await User.findOne({
    _id: req.params.id,
    role: "business",
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (featured && !business.businessVerified) {
    res.status(400);
    throw new Error("Only approved businesses can be featured");
  }

  if (featured) {
    business.isFeatured = true;
    business.featuredAt = new Date();
    business.featuredBy = req.user._id;
    business.featuredPlan = plan || business.featuredPlan || "basic";
    business.featuredNotes = notes || business.featuredNotes || "";
    if (until) {
      const d = new Date(until);
      if (Number.isNaN(d.getTime())) {
        res.status(400);
        throw new Error("Invalid `until` date");
      }
      business.featuredUntil = d;
    }
  } else {
    business.isFeatured = false;
    business.featuredAt = undefined;
    business.featuredBy = undefined;
    business.featuredUntil = undefined;
    business.featuredPlan = null;
    business.featuredNotes = undefined;
  }

  await business.save();

  res.status(200).json({
    success: true,
    message: featured
      ? "Business marked as featured"
      : "Business removed from featured",
    data: publicUser(business),
  });
});

// ══════════════════════════════════════════════════════════════
// CATEGORY MANAGEMENT
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List all categories (including inactive)
// @route   GET /api/v1/admin/categories
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const listAllCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({
    order: 1,
    name: 1,
  });

  // Attach business counts per category slug
  const counts = await User.aggregate([
    {
      $match: {
        role: "business",
        categorySlug: { $nin: [null, ""] },
      },
    },
    { $group: { _id: "$categorySlug", count: { $sum: 1 } } },
  ]);
  const countMap = counts.reduce((acc, c) => {
    acc[c._id] = c.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: categories.map((c) => ({
      ...c.toObject(),
      businessCount: countMap[c.slug] || 0,
    })),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Create a category
// @route   POST /api/v1/admin/categories
// @access  Private (admin)
// Body: { name, slug?, description?, icon?, image?, order?, isActive? }
// ──────────────────────────────────────────────────────────────
const createCategory = asyncHandler(async (req, res) => {
  const { name, slug, description, icon, image, order, isActive } = req.body;

  if (!name) {
    res.status(400);
    throw new Error("name is required");
  }

  const finalSlug = slug ? slugify(slug) : slugify(name);

  const existing = await Category.findOne({
    $or: [{ name }, { slug: finalSlug }],
  });
  if (existing) {
    res.status(409);
    throw new Error("A category with this name or slug already exists");
  }

  const category = await Category.create({
    name: name.trim(),
    slug: finalSlug,
    description,
    icon,
    image,
    order: Number(order) || 0,
    isActive: isActive !== undefined ? !!isActive : true,
  });

  res.status(201).json({
    success: true,
    message: "Category created",
    data: category,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update a category
// @route   PUT /api/v1/admin/categories/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const fields = [
    "name",
    "description",
    "icon",
    "image",
    "order",
    "isActive",
  ];
  fields.forEach((f) => {
    if (req.body[f] !== undefined) category[f] = req.body[f];
  });

  if (req.body.slug !== undefined) {
    category.slug = slugify(req.body.slug);
  }

  await category.save();

  res.status(200).json({
    success: true,
    message: "Category updated",
    data: category,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Delete a category
// @route   DELETE /api/v1/admin/categories/:id
// @access  Private (admin)
// Query: force=true to delete even if businesses use it
// ──────────────────────────────────────────────────────────────
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const force = String(req.query.force).toLowerCase() === "true";

  if (!force) {
    const inUse = await User.countDocuments({
      categorySlug: category.slug,
    });
    if (inUse > 0) {
      res.status(400);
      throw new Error(
        `Category is in use by ${inUse} business${
          inUse === 1 ? "" : "es"
        }. Pass ?force=true to delete anyway.`
      );
    }
  }

  await category.deleteOne();

  res.status(200).json({
    success: true,
    message: "Category deleted",
  });
});

export {
  // users
  listUsers,
  getUserById,
  updateUserRole,
  toggleUserActive,
  deleteUser,
  adminSendPasswordReset,
  // business admin create
  adminCreateBusiness,
  // featured
  listFeaturedBusinesses,
  toggleBusinessFeatured,
  // categories
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};