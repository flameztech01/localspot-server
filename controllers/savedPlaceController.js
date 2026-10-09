import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";

// Public-safe projection — same fields as public business listing
const BUSINESS_PROJECTION =
  "businessName description businessKind businessKindOther businessType " +
  "categorySlug tags logo coverImage images location openingHours priceRange " +
  "rating numReviews viewCount isFeatured isPopular isVerified businessVerified " +
  "createdAt";

// ──────────────────────────────────────────────────────────────
// @desc    List the current user's saved businesses
// @route   GET /api/v1/saved-places
// @access  Private
// ──────────────────────────────────────────────────────────────
const listSavedPlaces = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: "savedPlaces",
    match: { isActive: true },
    select: BUSINESS_PROJECTION,
  });

  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  // Filter out any saved IDs that point to deleted businesses
  const saved = (user.savedPlaces || []).filter(Boolean);

  res.status(200).json({
    success: true,
    data: saved,
    count: saved.length,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Save a business to my saved list
// @route   POST /api/v1/saved-places/:businessId
// @access  Private
// ──────────────────────────────────────────────────────────────
const savePlace = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    res.status(400);
    throw new Error("Invalid business id");
  }

  // Confirm the business exists and is a public-visible business
  const business = await User.findOne({
    _id: businessId,
    role: "business",
    isActive: true,
    isVerified: true,
    businessVerified: true,
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (business._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error("You cannot save your own business");
  }

  await User.updateOne(
    { _id: req.user._id, savedPlaces: { $ne: business._id } },
    { $addToSet: { savedPlaces: business._id } }
  );

  res.status(200).json({
    success: true,
    message: "Saved to your places",
    data: { businessId: business._id },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Remove a business from my saved list
// @route   DELETE /api/v1/saved-places/:businessId
// @access  Private
// ──────────────────────────────────────────────────────────────
const unsavePlace = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    res.status(400);
    throw new Error("Invalid business id");
  }

  await User.updateOne(
    { _id: req.user._id },
    { $pull: { savedPlaces: businessId } }
  );

  res.status(200).json({
    success: true,
    message: "Removed from saved",
    data: { businessId },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Toggle saved state for a business
// @route   POST /api/v1/saved-places/:businessId/toggle
// @access  Private
// ──────────────────────────────────────────────────────────────
const toggleSavedPlace = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    res.status(400);
    throw new Error("Invalid business id");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const alreadySaved = (user.savedPlaces || []).some(
    (id) => id.toString() === businessId
  );

  if (alreadySaved) {
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { savedPlaces: businessId } }
    );
    return res.status(200).json({
      success: true,
      message: "Removed from saved",
      data: { businessId, saved: false },
    });
  }

  const business = await User.findOne({
    _id: businessId,
    role: "business",
    isActive: true,
    isVerified: true,
    businessVerified: true,
  });

  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  if (business._id.toString() === req.user._id.toString()) {
    res.status(400);
    throw new Error("You cannot save your own business");
  }

  await User.updateOne(
    { _id: req.user._id },
    { $addToSet: { savedPlaces: business._id } }
  );

  res.status(200).json({
    success: true,
    message: "Saved to your places",
    data: { businessId: business._id, saved: true },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get just the IDs of saved businesses (lightweight —
//          used by PopularSpots to know which cards to mark saved)
// @route   GET /api/v1/saved-places/ids
// @access  Private
// ──────────────────────────────────────────────────────────────
const listSavedPlaceIds = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("savedPlaces");
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({
    success: true,
    data: (user.savedPlaces || []).map((id) => id.toString()),
  });
});

export {
  listSavedPlaces,
  listSavedPlaceIds,
  savePlace,
  unsavePlace,
  toggleSavedPlace,
};