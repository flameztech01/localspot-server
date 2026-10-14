// src/models/bookingModel.js
import mongoose from "mongoose";

export const BOOKING_KINDS = [
  "hotels",
  "dining",
  "things_to_do",
  "shops",
  "others",
];

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
  "cancelled",
  "completed",
  "no_show",
];

const bookingSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Copied from business at creation time so filtering stays cheap
    kind: { type: String, enum: BOOKING_KINDS, required: true, index: true },
    businessName: { type: String, trim: true },

    status: {
      type: String,
      enum: BOOKING_STATUSES,
      default: "pending",
      index: true,
    },

    referenceCode: { type: String, unique: true, index: true },

    // Contact
    guestName: { type: String, required: true, trim: true, maxlength: 120 },
    guestEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    guestPhone: { type: String, required: true, trim: true, maxlength: 40 },

    // Shared
    specialRequests: { type: String, trim: true, maxlength: 1500 },
    estimatedTotal: { type: Number, min: 0 },
    currency: { type: String, default: "NGN", trim: true },

    // Kind-specific payload (validated in the controller)
    details: { type: mongoose.Schema.Types.Mixed, required: true },

    // Normalised start datetime — used for sorting & cancellation policy
    startAt: { type: Date, index: true },
    endAt: { type: Date },

    // Business side
    businessNotes: { type: String, trim: true, maxlength: 1000 },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    cancellationReason: { type: String, trim: true, maxlength: 1000 },
    cancelledBy: { type: String, enum: ["customer", "business", "admin"] },

    respondedAt: Date,
    confirmedAt: Date,
    rejectedAt: Date,
    cancelledAt: Date,
    completedAt: Date,
  },
  { timestamps: true }
);

bookingSchema.index({ business: 1, status: 1, createdAt: -1 });
bookingSchema.index({ customer: 1, status: 1, createdAt: -1 });
bookingSchema.index({ business: 1, startAt: 1 });

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;