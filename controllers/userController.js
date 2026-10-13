// src/controllers/userController.js
import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import generateToken from "../utils/generateToken.js";
import { generateOTP } from "../utils/generateOTP.js";
import { sendOTPEmail } from "../utils/resendOTP.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ──────────────────────────────────────────────────────────────
// Serializer — public-safe user (no secrets)
// ──────────────────────────────────────────────────────────────
const publicUser = (user) => {
  if (!user) return null;
  const u = user.toObject ? user.toObject() : { ...user };

  delete u.password;
  delete u.otp;
  delete u.otpExpire;
  delete u.otpPurpose;
  delete u.__v;

  if (!Array.isArray(u.savedPlaces)) u.savedPlaces = [];

  u.isEmailVerified = !!u.isVerified;
  u.isBusiness = u.role === "business";
  u.isAdmin = u.role === "admin";

  return u;
};

// ══════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Register a new user (sends verification OTP)
// @route   POST /api/v1/auth/register
// @access  Public
// ──────────────────────────────────────────────────────────────
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password, phone } = req.body;

  if (!fullName || !email || !password) {
    res.status(400);
    throw new Error("Full name, email and password are required");
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
    // unverified signup → allow re-register (overwrite pending record)
    existing.fullName = fullName;
    existing.password = password;
    existing.phone = phone;
    user = existing;
  } else {
    user = new User({
      fullName,
      email,
      password,
      phone,
      role: "user",
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
    message: "Verification code sent to your email.",
    data: { email: user.email },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Verify email with OTP (auto-logs in on success)
// @route   POST /api/v1/auth/verify-otp
// @access  Public
// ──────────────────────────────────────────────────────────────
const verifyUserOTP = asyncHandler(async (req, res) => {
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
      message: "Account already verified",
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
    throw new Error("Verification code has expired. Please request a new one.");
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
    message: "Email verified successfully",
    data: publicUser(user),
    token,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Resend OTP (verification or password-reset)
// @route   POST /api/v1/auth/resend-otp
// @access  Public
// ──────────────────────────────────────────────────────────────
const resendOTP = asyncHandler(async (req, res) => {
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
// @desc    Login
// @route   POST /api/v1/auth/login
// @access  Public
// ──────────────────────────────────────────────────────────────
const loginUser = asyncHandler(async (req, res) => {
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
    message: "Logged in successfully",
    data: publicUser(user),
    token,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Logout
// @route   POST /api/v1/auth/logout
// @access  Private
// ──────────────────────────────────────────────────────────────
const logoutUser = asyncHandler(async (req, res) => {
  res.cookie("jwt", "", { httpOnly: true, expires: new Date(0) });
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// ══════════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Get the currently authenticated user
// @route   GET /api/v1/auth/me
// @access  Private
// ──────────────────────────────────────────────────────────────
const getCurrentUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({ success: true, data: publicUser(user) });
});

// ──────────────────────────────────────────────────────────────
// @desc    Update basic user profile (non-business fields)
// @route   PUT /api/v1/auth/profile
// @access  Private
// ──────────────────────────────────────────────────────────────
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const { fullName, phone } = req.body;
  if (fullName !== undefined) user.fullName = fullName;
  if (phone !== undefined) user.phone = phone;

  // Handle profile picture upload (single file named "logo")
  if (req.files?.logo?.[0]?.path) {
    user.logo = req.files.logo[0].path;
  } else if (req.file?.path) {
    user.logo = req.file.path;
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: "Profile updated",
    data: publicUser(user),
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Change password (signed-in user)
// @route   PUT /api/v1/auth/change-password
// @access  Private
// ──────────────────────────────────────────────────────────────
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error("Current and new password are required");
  }
  if (newPassword.length < 8) {
    res.status(400);
    throw new Error("New password must be at least 8 characters");
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const ok = await user.matchPassword(currentPassword);
  if (!ok) {
    res.status(401);
    throw new Error("Current password is incorrect");
  }

  user.password = newPassword;
  await user.save();

  res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Request password reset OTP
// @route   POST /api/v1/auth/forgot-password
// @access  Public
// ──────────────────────────────────────────────────────────────
const forgotPassword = asyncHandler(async (req, res) => {
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
// @desc    Reset password with email + OTP
// @route   POST /api/v1/auth/reset-password
// @access  Public
// ──────────────────────────────────────────────────────────────
const resetPassword = asyncHandler(async (req, res) => {
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
    "+otp +otpExpire +otpPurpose"
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
// SAVED PLACES
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Save a business to the user's saved places
// @route   POST /api/v1/auth/saved-places/:businessId
// @access  Private
// ──────────────────────────────────────────────────────────────
const savePlace = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const business = await User.findOne({
    _id: businessId,
    role: "business",
    businessVerified: true,
    isActive: true,
  }).select("_id");
  if (!business) {
    res.status(404);
    throw new Error("Business not found");
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  const already = user.savedPlaces.some(
    (id) => id.toString() === businessId.toString()
  );
  if (!already) {
    user.savedPlaces.push(business._id);
    await user.save();
  }

  res.status(200).json({
    success: true,
    message: "Saved",
    data: { savedPlaces: user.savedPlaces },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Remove a business from saved places
// @route   DELETE /api/v1/auth/saved-places/:businessId
// @access  Private
// ──────────────────────────────────────────────────────────────
const unsavePlace = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const user = await User.findById(req.user._id);
  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  user.savedPlaces = user.savedPlaces.filter(
    (id) => id.toString() !== businessId.toString()
  );
  await user.save();

  res.status(200).json({
    success: true,
    message: "Removed from saved places",
    data: { savedPlaces: user.savedPlaces },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Get the signed-in user's saved businesses
// @route   GET /api/v1/auth/saved-places
// @access  Private
// ──────────────────────────────────────────────────────────────
const getSavedPlaces = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate({
    path: "savedPlaces",
    match: { role: "business", businessVerified: true, isActive: true },
    select:
      "businessName description businessKind logo coverImage images " +
      "location rating numReviews priceRange isFeatured",
  });

  if (!user) {
    res.status(404);
    throw new Error("Account not found");
  }

  res.status(200).json({
    success: true,
    data: user.savedPlaces,
  });
});

export {
  // auth
  registerUser,
  verifyUserOTP,
  resendOTP,
  loginUser,
  logoutUser,
  // profile
  getCurrentUser,
  updateUserProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  // saved places
  savePlace,
  unsavePlace,
  getSavedPlaces,
};