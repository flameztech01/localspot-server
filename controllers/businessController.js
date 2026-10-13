// src/controllers/businessController.js
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import ActivityLog from "../models/activityLogModel.js";
import { logActivity } from "../utils/logActivity.js";
import {
  sendApplicationSubmitted,
  sendApplicationApproved,
  sendApplicationRejected,
  sendKYCSubmitted,
  sendKYCApproved,
  sendKYCRejected,
  sendBusinessFeatured,
} from "../utils/resendMail.js";

const MIN_BUSINESS_IMAGES = 10;
const MAX_BUSINESS_IMAGES = 20;

const VALID_BUSINESS_KINDS = [
  "hotels",
  "dining",
  "things_to_do",
  "shops",
  "others",
];

const VALID_REPRESENTATIVE_TYPES = ["owner", "director", "agent"];
const VALID_ID_TYPES = ["nin", "passport", "drivers_license", "voters_card"];
const VALID_REGISTRATION_TYPES = ["llc", "bn", "partnership", "corp"];

// ──────────────────────────────────────────────────────────────
// Projections
// ──────────────────────────────────────────────────────────────
const PUBLIC_BUSINESS_PROJECTION =
  "businessName description businessKind businessKindOther businessType " +
  "categorySlug tags logo coverImage images location openingHours priceRange " +
  "rating numReviews viewCount isFeatured featuredUntil featuredPlan " +
  "isPopular isVerified businessVerified kycStatus createdAt";

const PUBLIC_BUSINESS_DETAIL_PROJECTION =
  PUBLIC_BUSINESS_PROJECTION + " phone website email";

// ──────────────────────────────────────────────────────────────
// Serializer
// ──────────────────────────────────────────────────────────────
const publicUser = (user) => {
  if (!user) return null;
  const u = user.toObject ? user.toObject() : { ...user };

  delete u.password;
  delete u.otp;
  delete u.otpExpire;
  delete u.otpPurpose;
  delete u.__v;

  if (!Array.isArray(u.images)) u.images = [];
  if (!Array.isArray(u.tags)) u.tags = [];
  if (!Array.isArray(u.openingHours)) u.openingHours = [];

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

  u.isEmailVerified = !!u.isVerified;
  u.isBusinessApproved = !!u.businessVerified;
  u.businessApplicationStatus = u.businessApplicationStatus || "none";
  u.kycStatus = u.kycStatus || "none";

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
// Helpers
// ──────────────────────────────────────────────────────────────
const toDateOrUndefined = (value) => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const parseJSONMaybe = (value) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

// Fire-and-forget mail — never blocks the response
const fireMail = (promise) => {
  Promise.resolve(promise).catch((err) =>
    console.error("[mail]", err?.message || err),
  );
};

const applyBusinessProfileFields = (user, body) => {
  const stringFields = [
    "businessName",
    "description",
    "businessType",
    "website",
    "phone",
    "address",
    "cacNumber",
  ];
  stringFields.forEach((f) => {
    if (body[f] !== undefined) user[f] = body[f];
  });

  if (body.businessKind !== undefined) {
    const kind = String(body.businessKind).trim().toLowerCase();
    if (VALID_BUSINESS_KINDS.includes(kind)) {
      user.businessKind = kind;
      if (kind === "others") {
        const other = (body.businessKindOther || "").trim();
        user.businessKindOther = other ? other.slice(0, 100) : undefined;
      } else {
        user.businessKindOther = undefined;
      }
    }
  }

  if (body.priceRange !== undefined) {
    const pr = Number(body.priceRange);
    if ([1, 2, 3, 4].includes(pr)) user.priceRange = pr;
  }

  if (body.tags !== undefined) {
    let tags = parseJSONMaybe(body.tags);
    if (typeof tags === "string") {
      tags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (Array.isArray(tags)) {
      user.tags = tags.map((t) => String(t).trim()).filter(Boolean);
    }
  }

  if (body.location !== undefined) {
    const loc = parseJSONMaybe(body.location);
    if (loc && typeof loc === "object") {
      const existing = user.location?.toObject?.() || user.location || {};
      user.location = { ...existing, ...loc };
    }
  }

  if (body.openingHours !== undefined) {
    const hours = parseJSONMaybe(body.openingHours);
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
};

const applyKYCFields = (user, body) => {
  if (body.representativeType !== undefined) {
    const v = String(body.representativeType);
    if (VALID_REPRESENTATIVE_TYPES.includes(v)) user.representativeType = v;
  }
  if (body.ownerLegalName !== undefined)
    user.ownerLegalName = String(body.ownerLegalName).trim();
  const dob = toDateOrUndefined(body.ownerDob);
  if (dob) user.ownerDob = dob;

  if (body.idType !== undefined) {
    const v = String(body.idType);
    if (VALID_ID_TYPES.includes(v)) user.idType = v;
  }
  if (body.idNumber !== undefined)
    user.idNumber = String(body.idNumber).trim();

  if (body.registeredBusinessName !== undefined)
    user.registeredBusinessName = String(body.registeredBusinessName).trim();
  if (body.registrationType !== undefined) {
    const v = String(body.registrationType);
    if (VALID_REGISTRATION_TYPES.includes(v)) user.registrationType = v;
  }
  if (body.cacNumber !== undefined)
    user.cacNumber = String(body.cacNumber).trim();
  if (body.cacStatus !== undefined)
    user.cacStatus = String(body.cacStatus).trim();

  if (body.operatingAddress !== undefined)
    user.operatingAddress = String(body.operatingAddress).trim();

  if (body.riskCategory !== undefined)
    user.riskCategory = String(body.riskCategory).trim();
  if (body.foodLicenceNumber !== undefined)
    user.foodLicenceNumber = String(body.foodLicenceNumber).trim();
  const foodExpiry = toDateOrUndefined(body.foodLicenceExpiry);
  if (foodExpiry) user.foodLicenceExpiry = foodExpiry;
  if (body.liquorLicenceNumber !== undefined)
    user.liquorLicenceNumber = String(body.liquorLicenceNumber).trim();
};

// ══════════════════════════════════════════════════════════════
// USER-SIDE — business APPLICATION
// ══════════════════════════════════════════════════════════════

const submitBusinessApplication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  if (!user.isVerified) {
    res.status(403);
    throw new Error("Verify your email before applying to become a business");
  }

  if (user.role === "business" && user.businessVerified) {
    res.status(400);
    throw new Error("You already have an approved business account");
  }

  if (user.businessApplicationStatus === "pending") {
    res.status(400);
    throw new Error(
      "You already have a pending application. Update it instead of resubmitting."
    );
  }

  const {
    businessName,
    businessType,
    businessKind,
    address,
    cacNumber,
  } = req.body;

  if (!businessName || !businessType || !businessKind || !address || !cacNumber) {
    res.status(400);
    throw new Error(
      "businessName, businessType, businessKind, address and cacNumber are required"
    );
  }

  const kind = String(businessKind).trim().toLowerCase();
  if (!VALID_BUSINESS_KINDS.includes(kind)) {
    res.status(400);
    throw new Error(
      `businessKind must be one of: ${VALID_BUSINESS_KINDS.join(", ")}`
    );
  }
  if (kind === "others") {
    const other = (req.body.businessKindOther || "").trim();
    if (!other) {
      res.status(400);
      throw new Error(
        'businessKindOther is required when businessKind is "others"'
      );
    }
  }

  const uploadedImages = (req.files?.images || []).map((f) => f.path);
  if (uploadedImages.length < MIN_BUSINESS_IMAGES) {
    res.status(400);
    throw new Error(
      `At least ${MIN_BUSINESS_IMAGES} business images are required (got ${uploadedImages.length})`
    );
  }
  if (uploadedImages.length > MAX_BUSINESS_IMAGES) {
    res.status(400);
    throw new Error(
      `At most ${MAX_BUSINESS_IMAGES} business images are allowed`
    );
  }

  applyBusinessProfileFields(user, req.body);

  if (req.files?.logo?.[0]?.path) user.logo = req.files.logo[0].path;
  if (req.files?.coverImage?.[0]?.path)
    user.coverImage = req.files.coverImage[0].path;
  if (req.files?.cacDocument?.[0]?.path)
    user.cacDocument = req.files.cacDocument[0].path;

  user.images = uploadedImages;

  user.businessApplicationStatus = "pending";
  user.businessApplicationSubmittedAt = new Date();
  user.businessApplicationReviewedAt = undefined;
  user.businessApplicationReviewedBy = undefined;
  user.businessRejectionReason = undefined;

  await user.save();

  // Log + mail
  await logActivity({
    userId: user._id,
    action: "Business application submitted",
    category: "Verification",
    detail: `Application submitted for "${businessName}". Awaiting admin review.`,
    status: "pending",
    req,
  });

  fireMail(
    sendApplicationSubmitted({
      to: user.email,
      businessName: user.businessName || businessName,
      submittedAt: user.businessApplicationSubmittedAt,
    })
  );

  res.status(201).json({
    success: true,
    message: "Business application submitted. Awaiting admin review.",
    data: publicUser(user),
  });
});

const getMyBusinessApplication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({
    success: true,
    data: {
      status: user.businessApplicationStatus || "none",
      submittedAt: user.businessApplicationSubmittedAt || null,
      reviewedAt: user.businessApplicationReviewedAt || null,
      rejectionReason: user.businessRejectionReason || null,
      application: publicUser(user),
    },
  });
});

const updateBusinessApplication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const status = user.businessApplicationStatus || "none";

  if (status === "none") {
    res.status(400);
    throw new Error("You have not submitted a business application yet");
  }
  if (status === "approved") {
    res.status(400);
    throw new Error("Your application is already approved");
  }

  applyBusinessProfileFields(user, req.body);

  if (req.files?.logo?.[0]?.path) user.logo = req.files.logo[0].path;
  if (req.files?.coverImage?.[0]?.path)
    user.coverImage = req.files.coverImage[0].path;
  if (req.files?.cacDocument?.[0]?.path)
    user.cacDocument = req.files.cacDocument[0].path;

  let currentImages = Array.isArray(user.images) ? [...user.images] : [];
  let removedCount = 0;

  if (req.body.removeImages !== undefined) {
    const toRemove = parseJSONMaybe(req.body.removeImages);
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

  if (isTouchingImages && currentImages.length < MIN_BUSINESS_IMAGES) {
    res.status(400);
    throw new Error(
      `At least ${MIN_BUSINESS_IMAGES} business images are required (currently ${currentImages.length})`
    );
  }

  user.images = currentImages;

  const wasRejected = status === "rejected";

  if (wasRejected) {
    user.businessApplicationStatus = "pending";
    user.businessApplicationSubmittedAt = new Date();
    user.businessApplicationReviewedAt = undefined;
    user.businessApplicationReviewedBy = undefined;
    user.businessRejectionReason = undefined;
  }

  await user.save();

  await logActivity({
    userId: user._id,
    action: wasRejected
      ? "Application updated and resubmitted"
      : "Application details updated",
    category: "Verification",
    detail: wasRejected
      ? "Rejected application was corrected and resubmitted for review."
      : "Business application information was updated.",
    status: wasRejected ? "pending" : "info",
    req,
  });

  if (wasRejected) {
    fireMail(
      sendApplicationSubmitted({
        to: user.email,
        businessName: user.businessName,
        submittedAt: user.businessApplicationSubmittedAt,
      })
    );
  }

  res.status(200).json({
    success: true,
    message: wasRejected
      ? "Application updated and resubmitted for review"
      : "Application updated",
    data: publicUser(user),
  });
});

const withdrawBusinessApplication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  if (user.businessApplicationStatus !== "pending") {
    res.status(400);
    throw new Error("Only a pending application can be withdrawn");
  }

  user.businessApplicationStatus = "none";
  user.businessApplicationSubmittedAt = undefined;
  user.businessApplicationReviewedAt = undefined;
  user.businessApplicationReviewedBy = undefined;
  user.businessRejectionReason = undefined;

  await user.save();

  await logActivity({
    userId: user._id,
    action: "Application withdrawn",
    category: "Verification",
    detail: "The pending business application was withdrawn.",
    status: "info",
    req,
  });

  res.status(200).json({
    success: true,
    message: "Application withdrawn",
    data: publicUser(user),
  });
});

// ══════════════════════════════════════════════════════════════
// USER-SIDE — KYC
// ══════════════════════════════════════════════════════════════

const submitBusinessKYC = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  if (!user.isVerified) {
    res.status(403);
    throw new Error(
      "Verify your email before submitting business verification"
    );
  }

  if (user.kycStatus === "pending") {
    res.status(400);
    throw new Error(
      "You already have a KYC submission pending review. Update it instead."
    );
  }

  if (user.kycStatus === "approved") {
    res.status(400);
    throw new Error("Your KYC is already approved");
  }

  const { ownerLegalName, idNumber, operatingAddress } = req.body;

  if (!ownerLegalName || !idNumber || !operatingAddress) {
    res.status(400);
    throw new Error(
      "ownerLegalName, idNumber and operatingAddress are required"
    );
  }

  const accepted =
    req.body.kycDeclarationAccepted === true ||
    req.body.kycDeclarationAccepted === "true";
  if (!accepted) {
    res.status(400);
    throw new Error(
      "You must accept the compliance declaration before submitting"
    );
  }
  user.kycDeclarationAccepted = true;

  applyBusinessProfileFields(user, req.body);

  if (req.body.businessKind !== undefined) {
    const kind = String(req.body.businessKind).trim().toLowerCase();
    if (!VALID_BUSINESS_KINDS.includes(kind)) {
      res.status(400);
      throw new Error(
        `businessKind must be one of: ${VALID_BUSINESS_KINDS.join(", ")}`
      );
    }
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
    }
  }

  applyKYCFields(user, req.body);

  if (req.files?.idDocument?.[0]?.path)
    user.idDocument = req.files.idDocument[0].path;
  if (req.files?.cacDocument?.[0]?.path)
    user.cacDocument = req.files.cacDocument[0].path;
  if (req.files?.activityProof?.[0]?.path)
    user.activityProofFile = req.files.activityProof[0].path;
  if (req.files?.utilityBill?.[0]?.path)
    user.utilityBillFile = req.files.utilityBill[0].path;
  if (req.files?.regulatoryLicence?.[0]?.path)
    user.regulatoryLicenceFile = req.files.regulatoryLicence[0].path;

  if (req.files?.logo?.[0]?.path) user.logo = req.files.logo[0].path;
  if (req.files?.coverImage?.[0]?.path)
    user.coverImage = req.files.coverImage[0].path;

  const newGallery = (req.files?.images || []).map((f) => f.path);
  if (newGallery.length > 0) {
    let currentImages = Array.isArray(user.images) ? [...user.images] : [];
    if (req.body.removeImages !== undefined) {
      const toRemove = parseJSONMaybe(req.body.removeImages);
      if (Array.isArray(toRemove) && toRemove.length) {
        const removeSet = new Set(toRemove);
        currentImages = currentImages.filter((url) => !removeSet.has(url));
      }
    }
    const next = [...currentImages, ...newGallery];
    if (next.length > MAX_BUSINESS_IMAGES) {
      res.status(400);
      throw new Error(
        `A business can have at most ${MAX_BUSINESS_IMAGES} images`
      );
    }
    user.images = next;
  }

  user.kycStatus = "pending";
  user.kycSubmittedAt = new Date();
  user.kycReviewedAt = undefined;
  user.kycReviewedBy = undefined;
  user.kycRejectionReason = undefined;
  user.duplicateListingChecked = true;

  if (
    user.businessApplicationStatus === "none" ||
    user.businessApplicationStatus === "rejected"
  ) {
    user.businessApplicationStatus = "pending";
    user.businessApplicationSubmittedAt = new Date();
    user.businessApplicationReviewedAt = undefined;
    user.businessApplicationReviewedBy = undefined;
    user.businessRejectionReason = undefined;
  }

  await user.save();

  await logActivity({
    userId: user._id,
    action: "KYC verification submitted",
    category: "Verification",
    detail:
      "Corporate documents, identity, and licences submitted for compliance review.",
    status: "pending",
    req,
  });

  fireMail(
    sendKYCSubmitted({
      to: user.email,
      businessName: user.businessName || user.fullName,
      submittedAt: user.kycSubmittedAt,
    })
  );

  res.status(201).json({
    success: true,
    message:
      "Verification submission received. Our compliance team will review your credentials within 24–48 hours.",
    data: publicUser(user),
  });
});

const getMyBusinessKYC = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({
    success: true,
    data: {
      status: user.kycStatus || "none",
      submittedAt: user.kycSubmittedAt || null,
      reviewedAt: user.kycReviewedAt || null,
      rejectionReason: user.kycRejectionReason || null,
      kyc: publicUser(user),
    },
  });
});

const updateBusinessKYC = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const status = user.kycStatus || "none";

  if (status === "none") {
    res.status(400);
    throw new Error("You have not submitted KYC yet");
  }
  if (status === "approved") {
    res.status(400);
    throw new Error("Your KYC is already approved");
  }

  applyKYCFields(user, req.body);

  if (req.files?.idDocument?.[0]?.path)
    user.idDocument = req.files.idDocument[0].path;
  if (req.files?.cacDocument?.[0]?.path)
    user.cacDocument = req.files.cacDocument[0].path;
  if (req.files?.activityProof?.[0]?.path)
    user.activityProofFile = req.files.activityProof[0].path;
  if (req.files?.utilityBill?.[0]?.path)
    user.utilityBillFile = req.files.utilityBill[0].path;
  if (req.files?.regulatoryLicence?.[0]?.path)
    user.regulatoryLicenceFile = req.files.regulatoryLicence[0].path;

  const wasRejected = status === "rejected";

  if (wasRejected) {
    user.kycStatus = "pending";
    user.kycSubmittedAt = new Date();
    user.kycReviewedAt = undefined;
    user.kycReviewedBy = undefined;
    user.kycRejectionReason = undefined;
  }

  await user.save();

  await logActivity({
    userId: user._id,
    action: wasRejected
      ? "KYC resubmitted after rejection"
      : "KYC submission updated",
    category: "Verification",
    detail: wasRejected
      ? "Corrected KYC documents were resubmitted for review."
      : "KYC details were updated. Review continues.",
    status: wasRejected ? "pending" : "info",
    req,
  });

  if (wasRejected) {
    fireMail(
      sendKYCSubmitted({
        to: user.email,
        businessName: user.businessName || user.fullName,
        submittedAt: user.kycSubmittedAt,
      })
    );
  }

  res.status(200).json({
    success: true,
    message: wasRejected
      ? "KYC updated and resubmitted for review"
      : "KYC updated",
    data: publicUser(user),
  });
});

// ══════════════════════════════════════════════════════════════
// USER-SIDE — activity log
// ══════════════════════════════════════════════════════════════

const getMyActivityLog = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit, 10) || 50)
  );
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id };

  if (req.query.category && req.query.category !== "all") {
    filter.category = req.query.category;
  }

  if (req.query.q) {
    const q = String(req.query.q).trim();
    filter.$or = [
      { action: { $regex: q, $options: "i" } },
      { detail: { $regex: q, $options: "i" } },
    ];
  }

  const [logs, total] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ActivityLog.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: logs,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + logs.length < total,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// PUBLIC
// ══════════════════════════════════════════════════════════════

const getPublicBusinesses = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
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
    if (VALID_BUSINESS_KINDS.includes(k)) filter.businessKind = k;
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
    if (!Number.isNaN(r) && r >= 0 && r <= 5) filter.rating = { $gte: r };
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

  if (req.query.kycVerified === "true" || req.query.kycVerified === true) {
    filter.kycStatus = "approved";
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

  if (andClauses.length) filter.$and = andClauses;

  const SORTS = {
    rating: { rating: -1, numReviews: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: { businessName: 1 },
    views: { viewCount: -1 },
    popular: { numReviews: -1, rating: -1 },
    featured: { isFeatured: -1, rating: -1 },
    trust: { kycStatus: -1, rating: -1 },
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

  User.updateOne({ _id: business._id }, { $inc: { viewCount: 1 } }).catch(
    () => {}
  );

  res.status(200).json({ success: true, data: business });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — business application review
// ══════════════════════════════════════════════════════════════

const listBusinessApplications = asyncHandler(async (req, res) => {
  const { status = "pending", page = 1, limit = 20 } = req.query;

  const filter = {};

  switch (status) {
    case "pending":
      filter.businessApplicationStatus = "pending";
      break;
    case "approved":
      filter.role = "business";
      filter.businessVerified = true;
      break;
    case "rejected":
      filter.businessApplicationStatus = "rejected";
      break;
    case "featured":
      filter.role = "business";
      filter.isFeatured = true;
      break;
    case "all":
      break;
    default:
      filter.businessApplicationStatus = status;
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [applications, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: applications.map(publicUser),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

const getBusinessApplicationById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Application not found");
  }
  res.status(200).json({ success: true, data: publicUser(user) });
});

const approveBusinessApplication = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Application not found");
  }

  if (user.businessApplicationStatus !== "pending") {
    res.status(400);
    throw new Error("Only pending applications can be approved");
  }

  if (!user.isVerified) {
    res.status(400);
    throw new Error("Applicant has not verified their email yet");
  }

  user.role = "business";
  user.businessVerified = true;
  user.businessVerifiedAt = new Date();
  user.businessVerifiedBy = req.user._id;
  user.businessRejectionReason = undefined;

  user.businessApplicationStatus = "approved";
  user.businessApplicationReviewedAt = new Date();
  user.businessApplicationReviewedBy = req.user._id;

  await user.save();

  await logActivity({
    userId: user._id,
    action: "Business account approved",
    category: "Verification",
    detail: "Your business account has been approved. Welcome aboard!",
    status: "success",
    req,
  });

  fireMail(
    sendApplicationApproved({
      to: user.email,
      businessName: user.businessName || user.fullName,
    })
  );

  res.status(200).json({
    success: true,
    message: "Business application approved",
    data: publicUser(user),
  });
});

const rejectBusinessApplication = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("Application not found");
  }

  if (user.businessApplicationStatus !== "pending") {
    res.status(400);
    throw new Error("Only pending applications can be rejected");
  }

  user.businessApplicationStatus = "rejected";
  user.businessApplicationReviewedAt = new Date();
  user.businessApplicationReviewedBy = req.user._id;
  user.businessRejectionReason = reason;

  user.role = user.role === "business" ? "user" : user.role;
  user.businessVerified = false;
  user.businessVerifiedAt = undefined;
  user.businessVerifiedBy = undefined;

  await user.save();

  await logActivity({
    userId: user._id,
    action: "Business application rejected",
    category: "Verification",
    detail: `Reason: ${reason}`,
    status: "error",
    req,
  });

  fireMail(
    sendApplicationRejected({
      to: user.email,
      businessName: user.businessName || user.fullName,
      reason,
    })
  );

  res.status(200).json({
    success: true,
    message: "Business application rejected",
    data: publicUser(user),
  });
});

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

  await logActivity({
    userId: business._id,
    action: featured
      ? "Business marked as featured"
      : "Business removed from featured",
    category: "Advertising",
    detail: featured
      ? `Featured plan: ${business.featuredPlan || "basic"}.`
      : "Featured status was removed by admin.",
    status: featured ? "success" : "info",
    req,
  });

  // Only mail on the positive action
  if (featured) {
    fireMail(
      sendBusinessFeatured({
        to: business.email,
        businessName: business.businessName || business.fullName,
        plan: business.featuredPlan,
        until: business.featuredUntil,
      })
    );
  }

  res.status(200).json({
    success: true,
    message: featured
      ? "Business marked as featured"
      : "Business removed from featured",
    data: publicUser(business),
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — KYC review
// ══════════════════════════════════════════════════════════════

const listBusinessKYC = asyncHandler(async (req, res) => {
  const { status = "pending", page = 1, limit = 20 } = req.query;

  const filter = {};

  switch (status) {
    case "pending":
      filter.kycStatus = "pending";
      break;
    case "approved":
      filter.kycStatus = "approved";
      break;
    case "rejected":
      filter.kycStatus = "rejected";
      break;
    case "all":
      filter.kycStatus = { $in: ["pending", "approved", "rejected"] };
      break;
    default:
      filter.kycStatus = status;
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [submissions, total] = await Promise.all([
    User.find(filter)
      .sort({ kycSubmittedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: submissions.map(publicUser),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / Number(limit)),
    },
  });
});

const getBusinessKYCById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("KYC submission not found");
  }
  res.status(200).json({ success: true, data: publicUser(user) });
});

const approveBusinessKYC = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("KYC submission not found");
  }

  if (user.kycStatus !== "pending") {
    res.status(400);
    throw new Error("Only pending KYC submissions can be approved");
  }

  user.kycStatus = "approved";
  user.kycReviewedAt = new Date();
  user.kycReviewedBy = req.user._id;
  user.kycRejectionReason = undefined;

  if (!user.businessVerified) {
    user.role = "business";
    user.businessVerified = true;
    user.businessVerifiedAt = new Date();
    user.businessVerifiedBy = req.user._id;
  }

  if (user.businessApplicationStatus !== "approved") {
    user.businessApplicationStatus = "approved";
    user.businessApplicationReviewedAt = new Date();
    user.businessApplicationReviewedBy = req.user._id;
    user.businessRejectionReason = undefined;
  }

  await user.save();

  await logActivity({
    userId: user._id,
    action: "KYC approved — Trust Badge issued",
    category: "Verification",
    detail:
      "Your account passed compliance review. The Verified Trust Badge is now live on your public listing.",
    status: "success",
    req,
  });

  fireMail(
    sendKYCApproved({
      to: user.email,
      businessName: user.businessName || user.fullName,
    })
  );

  res.status(200).json({
    success: true,
    message: "KYC approved — Trust Badge issued",
    data: publicUser(user),
  });
});

const rejectBusinessKYC = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) {
    res.status(400);
    throw new Error("Rejection reason is required");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("KYC submission not found");
  }

  if (user.kycStatus !== "pending") {
    res.status(400);
    throw new Error("Only pending KYC submissions can be rejected");
  }

  user.kycStatus = "rejected";
  user.kycReviewedAt = new Date();
  user.kycReviewedBy = req.user._id;
  user.kycRejectionReason = reason;

  await user.save();

  await logActivity({
    userId: user._id,
    action: "KYC rejected",
    category: "Verification",
    detail: `Reason: ${reason}`,
    status: "error",
    req,
  });

  fireMail(
    sendKYCRejected({
      to: user.email,
      businessName: user.businessName || user.fullName,
      reason,
    })
  );

  res.status(200).json({
    success: true,
    message: "KYC rejected",
    data: publicUser(user),
  });
});

// ══════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════
export {
  submitBusinessApplication,
  getMyBusinessApplication,
  updateBusinessApplication,
  withdrawBusinessApplication,
  submitBusinessKYC,
  getMyBusinessKYC,
  updateBusinessKYC,
  getMyActivityLog,
  getPublicBusinesses,
  getPublicBusinessById,
  listBusinessApplications,
  getBusinessApplicationById,
  approveBusinessApplication,
  rejectBusinessApplication,
  toggleBusinessFeatured,
  listBusinessKYC,
  getBusinessKYCById,
  approveBusinessKYC,
  rejectBusinessKYC,
};