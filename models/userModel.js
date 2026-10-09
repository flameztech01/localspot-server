// src/models/userModel.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    // ── Identity ─────────────────────────────────────────────
    fullName: { type: String, trim: true },
    businessName: { type: String, trim: true },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false,
    },
    phone: { type: String, trim: true },

    // ── Role ─────────────────────────────────────────────────
    role: {
      type: String,
      enum: ["business", "admin"],
      default: "business",
    },

    // ── Email verification (OTP) ─────────────────────────────
    isVerified: { type: Boolean, default: false },

    // ── Admin approval ───────────────────────────────────────
    businessVerified: { type: Boolean, default: false },
    businessVerifiedAt: { type: Date },
    businessVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    businessRejectionReason: { type: String, trim: true },

    isActive: { type: Boolean, default: true },

    // ── OTP ──────────────────────────────────────────────────
    otp: { type: String, select: false },
    otpExpire: { type: Date, select: false },
    otpPurpose: {
      type: String,
      enum: ["verification", "password-reset"],
      select: false,
    },

    // ── Business kind (high-level classification) ────────────
    businessKind: {
      type: String,
      enum: ["hotels", "dining", "things_to_do", "shops", "others", null],
      default: null,
      index: true,
    },
    businessKindOther: {
      type: String,
      trim: true,
      maxlength: 100,
    },

    // ── Business profile ─────────────────────────────────────
    businessType: {
      type: String,
      enum: [
        "sole_proprietorship",
        "partnership",
        "llc",
        "corporation",
        "other",
      ],
      default: "other",
    },
    description: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },

    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    categorySlug: { type: String, lowercase: true, trim: true, index: true },
    tags: [{ type: String, trim: true }],

    // ── Images ───────────────────────────────────────────────
    // logo        → square profile picture / avatar
    // coverImage  → landscape hero banner
    // images      → gallery photos (10–20)
    logo: { type: String, trim: true },
    coverImage: { type: String, trim: true },
    images: {
      type: [{ type: String, trim: true }],
      validate: {
        validator: (arr) => !arr || arr.length <= 20,
        message: "A business can have at most 20 images",
      },
    },

    // ── Location ─────────────────────────────────────────────
    location: {
      address: { type: String, trim: true },
      city: { type: String, trim: true, index: true },
      state: { type: String, trim: true },
      country: { type: String, trim: true },
      coordinates: {
        type: {
          type: String,
          enum: ["Point"],
          default: "Point",
        },
        coordinates: {
          type: [Number],
          default: [0, 0], // [lng, lat]
        },
      },
    },

    // ── Hours ────────────────────────────────────────────────
    // day: 0 = Sunday ... 6 = Saturday
    openingHours: [
      {
        day: { type: Number, min: 0, max: 6 },
        open: String,
        close: String,
        closed: { type: Boolean, default: false },
      },
    ],

    priceRange: {
      type: Number,
      enum: [1, 2, 3, 4],
      default: 2,
    },

    // ── Discovery signals ────────────────────────────────────
    rating: { type: Number, default: 0, min: 0, max: 5, index: true },
    numReviews: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    isPopular: { type: Boolean, default: false, index: true },

    // ── Featured listing ─────────────────────────────────────
    isFeatured: { type: Boolean, default: false, index: true },
    featuredAt: { type: Date },
    featuredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    featuredUntil: { type: Date, index: true },
    featuredPlan: {
      type: String,
      enum: ["basic", "standard", "premium", null],
      default: null,
    },
    featuredNotes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

// ── Indexes ────────────────────────────────────────────────
userSchema.index({ businessName: "text", description: "text", tags: "text" });
userSchema.index({ "location.coordinates": "2dsphere" });
// Composite index for the discovery "featured, active, verified" query
userSchema.index({
  isFeatured: -1,
  businessVerified: 1,
  isActive: 1,
  rating: -1,
});

// ── Hooks ──────────────────────────────────────────────────
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// ── Methods ────────────────────────────────────────────────
userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;