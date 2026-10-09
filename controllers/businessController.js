import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import { generateOTP } from "../utils/generateOTP.js";
import { sendOTPEmail } from "../utils/resendOTP.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MIN_BUSINESS_IMAGES = 10;
const MAX_BUSINESS_IMAGES = 20;

const VALID_BUSINESS_KINDS = [
  "hotels",
  "dining",
  "things_to_do",
  "shops",
  "others",
];

// Public-safe projection for listing endpoints (no PII, no secrets)
const PUBLIC_BUSINESS_PROJECTION =
  "businessName description businessKind businessKindOther businessType " +
  "categorySlug tags logo coverImage images location openingHours priceRange " +
  "rating numReviews viewCount isFeatured featuredUntil featuredPlan " +
  "isPopular isVerified businessVerified createdAt";

// Public-safe projection for a single business (adds contact fields)
const PUBLIC_BUSINESS_DETAIL_PROJECTION =
  PUBLIC_BUSINESS_PROJECTION + " phone website email";

// ──────────────────────────────────────────────────────────────
// Serializer — sends EVERYTHING the frontend could possibly need.
// Excludes only secrets (password, otp, otpExpire, otpPurpose).
// ──────────────────────────────────────────────────────────────
const publicUser = (user) => {
  if (!user) return null;
  const u = user.toObject ? user.toObject() : { ...user };

  // Strip secrets defensively (in case a caller forgot .select)
  delete u.password;
  delete u.otp;
  delete u.otpExpire;
  delete u.otpPurpose;
  delete u.__v;

  // Ensure arrays always come out as arrays, not undefined
  if (!Array.isArray(u.images)) u.images = [];
  if (!Array.isArray(u.tags)) u.tags = [];
  if (!Array.isArray(u.openingHours)) u.openingHours = [];

  // Normalise location so the frontend never has to null-check
  u.location = {
    address: u.location?.address || "",
    city: u.location?.city || "",
    state: u.location?.state || "",
    country: u.location?.country || "",
    coordinates: {
      type: "Point",
      coordinates: u.location?.coordinates?.coordinates || [0, 0],
    },
  };

  // Derived flags the frontend UI can rely on without computing
  u.isEmailVerified = !!u.isVerified;
  u.isBusinessApproved = !!u.businessVerified;
  u.isPendingApproval =
    !!u.isVerified && !u.businessVerified && !u.businessRejectionReason;
  u.isRejected =
    !!u.isVerified && !u.businessVerified && !!u.businessRejectionReason;

  // Featured status — computed so "expired" featured items stop showing as featured
  const now = Date.now();
  u.isFeaturedActive =
    !!u.isFeatured &&
    (!u.featuredUntil || new Date(u.featuredUntil).getTime() > now);
  u.isFeaturedExpired =
    !!u.isFeatured &&
    !!u.featuredUntil &&
    new Date(u.featuredUntil).getTime() <= now;

  return u;
};

// ──────────────────────────────────────────────────────────────
// @desc    Register a new business account (sends verification OTP)
// @route   POST /api/v1/auth/business/register
// @access  Public
// ──────────────────────────────────────────────────────────────
const registerBusinessAccount = asyncHandler(async (req, res) => {
  const { businessName, email, password, phone, businessType, address } =
    req.body;

  if (!businessName || !email || !password) {
    res.status(400);
    throw new Error("Business name, email and password are required");
  }

  if (password.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const existing = await User.findOne({ email: email.toLowerCase() });

  if (existing && existing.isVerified) {
    res.status(409);
    throw new Error("An account with this email already exists");
  }

  let user;
  if (existing) {
    existing.businessName = businessName;
    existing.password = password;
    existing.phone = phone;
    existing.businessType = businessType;
    existing.address = address;
    user = existing;
  } else {
    user = new User({
      businessName,
      email,
      password,
      phone,
      businessType,
      address,
      role: "business",
    });
  }

  const otp = generateOTP();
  user.otp = otp;
  user.otpExpire = Date.now() + OTP_TTL_MS;
  user.otpPurpose = "verification";
  await user.save();

  await sendOTPEmail({ to: user.email, otp, purpose: "verification" });

  res.status(201).json({
    success: true,
    message:
      "Verification code sent to your email. Please verify to continue.",
    data: { email: user.email },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Verify business account with OTP (auto-logs in on success)
// @route   POST /api/v1/auth/business/verify-otp
// @access  Public
// ──────────────────────────────────────────────────────────────
const verifyBusinessAccount = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    res.status(400);
    throw new Error("Email and OTP are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+otp +otpExpire +otpPurpose"
  );

  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  if (user.isVerified) {
    const token = generateToken(res, user._id);
    return res.status(200).json({
      success: true,
      message: user.businessVerified
        ? "Account already verified"
        : "Email already verified. Awaiting admin approval.",
      data: publicUser(user),
      token,
    });
  }

  if (!user.otp || !user.otpExpire || user.otpPurpose !== "verification") {
    res.status(400);
    throw new Error("No verification code found. Please request a new one.");
  }

  if (user.otpExpire < Date.now()) {
    res.status(400);
    throw new Error(
      "Verification code has expired. Please request a new one."
    );
  }

  if (user.otp !== otp.toString()) {
    res.status(400);
    throw new Error("Invalid verification code");
  }

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpire = undefined;
  user.otpPurpose = undefined;
  await user.save();

  const token = generateToken(res, user._id);

  res.status(200).json({
    success: true,
    message:
      "Email verified successfully. Your business account is pending admin approval.",
    data: publicUser(user),
    token,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Resend OTP (verification or password-reset)
// @route   POST /api/v1/auth/business/resend-otp
// @access  Public
// ──────────────────────────────────────────────────────────────
const resendBusinessOTP = asyncHandler(async (req, res) => {
  const { email, purpose = "verification" } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }

  if (!["verification", "password-reset"].includes(purpose)) {
    res.status(400);
    throw new Error("Invalid OTP purpose");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(200).json({
      success: true,
      message: "If that email exists, a new code has been sent",
    });
  }

  if (purpose === "verification" && user.isVerified) {
    res.status(400);
    throw new Error("Account is already verified");
  }

  const otp = generateOTP();
  user.otp = otp;
  user.otpExpire = Date.now() + OTP_TTL_MS;
  user.otpPurpose = purpose;
  await user.save({ validateBeforeSave: false });

  await sendOTPEmail({ to: user.email, otp, purpose });

  res.status(200).json({
    success: true,
    message: "If that email exists, a new code has been sent",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Authenticate a business account
// @route   POST /api/v1/auth/business/login
// @access  Public
// ──────────────────────────────────────────────────────────────
const loginBusinessAccount = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );
  if (!user) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  if (!user.isActive) {
    res.status(403);
    throw new Error("This account has been deactivated");
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  if (!user.isVerified) {
    const otp = generateOTP();
    user.otp = otp;
    user.otpExpire = Date.now() + OTP_TTL_MS;
    user.otpPurpose = "verification";
    await user.save({ validateBeforeSave: false });

    await sendOTPEmail({ to: user.email, otp, purpose: "verification" });

    res.status(403);
    throw new Error(
      "Account not verified. A new verification code has been sent to your email."
    );
  }

  const token = generateToken(res, user._id);

  res.status(200).json({
    success: true,
    message: user.businessVerified
      ? "Logged in successfully"
      : "Logged in. Your business account is pending admin approval.",
    data: publicUser(user),
    token,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Logout
// @route   POST /api/v1/auth/business/logout
// @access  Private
// ──────────────────────────────────────────────────────────────
const logoutBusinessAccount = asyncHandler(async (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get the currently authenticated account (everything)
// @route   GET /api/v1/auth/business/me
// @access  Private
// ──────────────────────────────────────────────────────────────
const getCurrentBusinessAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({
    success: true,
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update the logged-in business's public profile
// @route   PUT /api/v1/auth/business/profile
// @access  Private
//
// Multipart fields accepted:
//   Text:
//     businessName, description, businessType, website, phone,
//     address, priceRange, businessKind, businessKindOther,
//     tags          (JSON array)
//     location      (JSON object)
//     openingHours  (JSON array)
//     removeImages  (JSON array of URLs to drop from `images`)
//     removeCover   ("true" to clear coverImage)
//     removeLogo    ("true" to clear logo)
//   Files:
//     images      (multiple, min 10 max 20 total)
//     coverImage  (single, hero banner)
//     logo        (single, profile picture / avatar)
// ──────────────────────────────────────────────────────────────
const updateBusinessProfile = asyncHandler(async (req, res) => {
  if (!req.user.isVerified) {
    res.status(403);
    throw new Error("Verify your email before updating your business profile");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  // ── Simple string fields ─────────────────────────────────
  const stringFields = [
    "businessName",
    "description",
    "businessType",
    "website",
    "phone",
    "address",
  ];
  stringFields.forEach((field) => {
    if (req.body[field] !== undefined) user[field] = req.body[field];
  });

  // ── Business kind ────────────────────────────────────────
  if (req.body.businessKind !== undefined) {
    const kind = String(req.body.businessKind).trim().toLowerCase();

    if (!VALID_BUSINESS_KINDS.includes(kind)) {
      res.status(400);
      throw new Error(
        `businessKind must be one of: ${VALID_BUSINESS_KINDS.join(", ")}`
      );
    }

    user.businessKind = kind;

    if (kind === "others") {
      const other =
        typeof req.body.businessKindOther === "string"
          ? req.body.businessKindOther.trim()
          : "";

      if (!other) {
        res.status(400);
        throw new Error(
          'businessKindOther is required when businessKind is "others"'
        );
      }
      if (other.length > 100) {
        res.status(400);
        throw new Error("businessKindOther must be 100 characters or fewer");
      }

      user.businessKindOther = other;
    } else {
      user.businessKindOther = undefined;
    }
  } else if (
    req.body.businessKindOther !== undefined &&
    user.businessKind === "others"
  ) {
    const other = String(req.body.businessKindOther).trim();
    if (!other) {
      res.status(400);
      throw new Error("businessKindOther cannot be empty");
    }
    if (other.length > 100) {
      res.status(400);
      throw new Error("businessKindOther must be 100 characters or fewer");
    }
    user.businessKindOther = other;
  }

  // ── priceRange ───────────────────────────────────────────
  if (req.body.priceRange !== undefined) {
    const pr = Number(req.body.priceRange);
    if ([1, 2, 3, 4].includes(pr)) user.priceRange = pr;
  }

  // ── tags ─────────────────────────────────────────────────
  if (req.body.tags !== undefined) {
    let tags = req.body.tags;
    if (typeof tags === "string") {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = tags.split(",").map((t) => t.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(tags)) {
      user.tags = tags.map((t) => String(t).trim()).filter(Boolean);
    }
  }

  // ── location ─────────────────────────────────────────────
  if (req.body.location !== undefined) {
    let loc = req.body.location;
    if (typeof loc === "string") {
      try {
        loc = JSON.parse(loc);
      } catch {
        res.status(400);
        throw new Error("Invalid `location` JSON");
      }
    }
    if (loc && typeof loc === "object") {
      const existing = user.location?.toObject?.() || user.location || {};
      user.location = { ...existing, ...loc };
    }
  }

  // ── openingHours ─────────────────────────────────────────
  if (req.body.openingHours !== undefined) {
    let hours = req.body.openingHours;
    if (typeof hours === "string") {
      try {
        hours = JSON.parse(hours);
      } catch {
        res.status(400);
        throw new Error("Invalid `openingHours` JSON");
      }
    }
    if (Array.isArray(hours)) {
      user.openingHours = hours
        .filter((h) => h && typeof h.day === "number")
        .map((h) => ({
          day: h.day,
          open: h.open,
          close: h.close,
          closed: !!h.closed,
        }));
    }
  }

  // ── Logo (profile picture) ───────────────────────────────
  const wantsRemoveLogo =
    req.body.removeLogo === "true" || req.body.removeLogo === true;

  if (wantsRemoveLogo && !req.files?.logo?.[0]) {
    user.logo = undefined;
  }
  if (req.files?.logo?.[0]?.path) {
    user.logo = req.files.logo[0].path;
  }

  // ── Cover banner ─────────────────────────────────────────
  const wantsRemoveCover =
    req.body.removeCover === "true" || req.body.removeCover === true;

  if (wantsRemoveCover && !req.files?.coverImage?.[0]) {
    user.coverImage = undefined;
  }
  if (req.files?.coverImage?.[0]?.path) {
    user.coverImage = req.files.coverImage[0].path;
  }

  // ── Gallery images ───────────────────────────────────────
  let currentImages = Array.isArray(user.images) ? [...user.images] : [];

  let removedCount = 0;
  if (req.body.removeImages !== undefined) {
    let toRemove = req.body.removeImages;
    if (typeof toRemove === "string") {
      try {
        toRemove = JSON.parse(toRemove);
      } catch {
        toRemove = [toRemove];
      }
    }
    if (Array.isArray(toRemove) && toRemove.length) {
      const removeSet = new Set(toRemove);
      const before = currentImages.length;
      currentImages = currentImages.filter((url) => !removeSet.has(url));
      removedCount = before - currentImages.length;
    }
  }

  const newUploads = (req.files?.images || []).map((f) => f.path);

  const projectedTotal = currentImages.length + newUploads.length;
  if (projectedTotal > MAX_BUSINESS_IMAGES) {
    res.status(400);
    throw new Error(
      `A business can have at most ${MAX_BUSINESS_IMAGES} images (this request would result in ${projectedTotal})`
    );
  }

  if (newUploads.length > 0) {
    currentImages = [...currentImages, ...newUploads];
  }

  const isTouchingImages =
    newUploads.length > 0 ||
    removedCount > 0 ||
    req.body.removeImages !== undefined;

  if (isTouchingImages) {
    if (currentImages.length < MIN_BUSINESS_IMAGES) {
      res.status(400);
      throw new Error(
        `At least ${MIN_BUSINESS_IMAGES} business images are required (currently ${currentImages.length})`
      );
    }
    if (currentImages.length > MAX_BUSINESS_IMAGES) {
      res.status(400);
      throw new Error(
        `At most ${MAX_BUSINESS_IMAGES} business images are allowed (currently ${currentImages.length})`
      );
    }
  }

  user.images = currentImages;

  await user.save();

  res.status(200).json({
    success: true,
    message: "Business profile updated",
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Request password reset OTP
// @route   POST /api/v1/auth/business/forgot-password
// @access  Public
// ──────────────────────────────────────────────────────────────
const forgotBusinessPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    res.status(400);
    throw new Error("Email is required");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(200).json({
      success: true,
      message: "If that email exists, a reset code has been sent",
    });
  }

  const otp = generateOTP();
  user.otp = otp;
  user.otpExpire = Date.now() + OTP_TTL_MS;
  user.otpPurpose = "password-reset";
  await user.save({ validateBeforeSave: false });

  await sendOTPEmail({ to: user.email, otp, purpose: "password-reset" });

  res.status(200).json({
    success: true,
    message: "If that email exists, a reset code has been sent",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Reset password using email + OTP
// @route   POST /api/v1/auth/business/reset-password
// @access  Public
// ──────────────────────────────────────────────────────────────
const resetBusinessPassword = asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;

  if (!email || !otp || !password) {
    res.status(400);
    throw new Error("Email, OTP and new password are required");
  }

  if (password.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+otp +otpExpire +otpPurpose +password"
  );

  if (
    !user ||
    !user.otp ||
    !user.otpExpire ||
    user.otpPurpose !== "password-reset"
  ) {
    res.status(400);
    throw new Error("Invalid or expired reset code");
  }

  if (user.otpExpire < Date.now()) {
    res.status(400);
    throw new Error("Reset code has expired. Please request a new one.");
  }

  if (user.otp !== otp.toString()) {
    res.status(400);
    throw new Error("Invalid reset code");
  }

  user.password = password;
  user.otp = undefined;
  user.otpExpire = undefined;
  user.otpPurpose = undefined;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Password reset successfully. You can now log in.",
  });
});

// ══════════════════════════════════════════════════════════════
// PUBLIC — no auth required
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Public list of approved businesses
// @route   GET /api/v1/auth/business/public
// @access  Public
// Query: kind, category, city, country, minRating, featured, q,
//        sort, page, limit
// ──────────────────────────────────────────────────────────────
const getPublicBusinesses = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.query.limit, 10) || 20)
  );
  const skip = (page - 1) * limit;

  const filter = {
    role: "business",
    isActive: true,
    isVerified: true,
    businessVerified: true,
  };

  const andClauses = [];

  if (req.query.kind) {
    const k = String(req.query.kind).trim().toLowerCase();
    if (VALID_BUSINESS_KINDS.includes(k)) {
      filter.businessKind = k;
    }
  }

  if (req.query.category) {
    filter.categorySlug = String(req.query.category).trim().toLowerCase();
  }

  if (req.query.city) {
    filter["location.city"] = {
      $regex: new RegExp(`^${req.query.city.trim()}$`, "i"),
    };
  }

  if (req.query.country) {
    filter["location.country"] = {
      $regex: new RegExp(`^${req.query.country.trim()}$`, "i"),
    };
  }

  if (req.query.minRating) {
    const r = Number(req.query.minRating);
    if (!Number.isNaN(r) && r >= 0 && r <= 5) {
      filter.rating = { $gte: r };
    }
  }

  if (req.query.featured === "true" || req.query.featured === true) {
    filter.isFeatured = true;
    andClauses.push({
      $or: [
        { featuredUntil: null },
        { featuredUntil: { $exists: false } },
        { featuredUntil: { $gt: new Date() } },
      ],
    });
  }

  if (req.query.q) {
    const q = String(req.query.q).trim();
    andClauses.push({
      $or: [
        { businessName: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ],
    });
  }

  if (andClauses.length > 0) {
    filter.$and = andClauses;
  }

  const SORTS = {
    rating: { rating: -1, numReviews: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: { businessName: 1 },
    views: { viewCount: -1 },
    popular: { numReviews: -1, rating: -1 },
    featured: { isFeatured: -1, rating: -1 },
  };
  const sort =
    SORTS[req.query.sort] || { isFeatured: -1, rating: -1, numReviews: -1 };

  const [businesses, total] = await Promise.all([
    User.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .select(PUBLIC_BUSINESS_PROJECTION),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      businesses,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        hasMore: skip + businesses.length < total,
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Public single business by id
// @route   GET /api/v1/auth/business/public/:id
// @access  Public
// ──────────────────────────────────────────────────────────────
const getPublicBusinessById = asyncHandler(async (req, res) => {
  const business = await User.findOne({
    _id: req.params.id,
    role: "business",
    isActive: true,
    isVerified: true,
    businessVerified: true,
  }).select(PUBLIC_BUSINESS_DETAIL_PROJECTION);

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  // Bump view count without blocking the response
  User.updateOne(
    { _id: business._id },
    { $inc: { viewCount: 1 } }
  ).catch(() => {});

  res.status(200).json({
    success: true,
    data: business,
  });
});

// ══════════════════════════════════════════════════════════════
// BUSINESS APPROVAL (called from admin UI)
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    List business accounts
// @route   GET /api/v1/auth/business/all
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const listBusinesses = asyncHandler(async (req, res) => {
  const { status = "pending", page = 1, limit = 20 } = req.query;

  const filter = { role: "business" };

  if (status === "pending") {
    filter.isVerified = true;
    filter.businessVerified = false;
    filter.businessRejectionReason = { $in: [null, undefined, ""] };
  } else if (status === "approved") {
    filter.businessVerified = true;
  } else if (status === "rejected") {
    filter.businessVerified = false;
    filter.businessRejectionReason = { $nin: [null, undefined, ""] };
  } else if (status === "unverified") {
    filter.isVerified = false;
  } else if (status === "featured") {
    filter.isFeatured = true;
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [businesses, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: businesses.map(publicUser),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get one business by id
// @route   GET /api/v1/auth/business/all/:id
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getBusinessById = asyncHandler(async (req, res) => {
  const business = await User.findOne({
    _id: req.params.id,
    role: "business",
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  res.status(200).json({
    success: true,
    data: publicUser(business),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Approve a business account
// @route   PATCH /api/v1/auth/business/all/:id/approve
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const approveBusiness = asyncHandler(async (req, res) => {
  const business = await User.findOne({
    _id: req.params.id,
    role: "business",
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (!business.isVerified) {
    res.status(400);
    throw new Error("Business email is not verified yet");
  }

  if (business.businessVerified) {
    res.status(400);
    throw new Error("Business is already approved");
  }

  business.businessVerified = true;
  business.businessVerifiedAt = new Date();
  business.businessVerifiedBy = req.user._id;
  business.businessRejectionReason = undefined;
  await business.save();

  res.status(200).json({
    success: true,
    message: "Business approved successfully",
    data: publicUser(business),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Reject a business account
// @route   PATCH /api/v1/auth/business/all/:id/reject
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const rejectBusiness = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const business = await User.findOne({
    _id: req.params.id,
    role: "business",
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (business.businessVerified) {
    res.status(400);
    throw new Error("Business is already approved");
  }

  business.businessVerified = false;
  business.businessVerifiedAt = undefined;
  business.businessVerifiedBy = req.user._id;
  business.businessRejectionReason = reason;
  await business.save();

  res.status(200).json({
    success: true,
    message: "Business rejected",
    data: publicUser(business),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Toggle featured status for a business
// @route   PATCH /api/v1/auth/business/all/:id/feature
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

export {
  // public
  getPublicBusinesses,
  getPublicBusinessById,
  // auth
  registerBusinessAccount,
  verifyBusinessAccount,
  resendBusinessOTP,
  loginBusinessAccount,
  logoutBusinessAccount,
  getCurrentBusinessAccount,
  updateBusinessProfile,
  forgotBusinessPassword,
  resetBusinessPassword,
  // admin approval
  listBusinesses,
  getBusinessById,
  approveBusiness,
  rejectBusiness,
  toggleBusinessFeatured,
};