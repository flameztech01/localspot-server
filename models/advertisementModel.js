import mongoose from "mongoose";

// Daily bucket for performance reporting
const dailyStatSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
  },
  { _id: false }
);

const advertisementSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdvertisementType",
      required: true,
    },
    slot: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdvertisementSlot",
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String, required: true, trim: true },
    link: { type: String, trim: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    budget: { type: Number, default: 0 },

    // draft → pending → approved → paused / rejected / disabled / expired
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "paused", "disabled", "expired"],
      default: "draft",
      index: true,
    },
    // Reason for pause (auto or manual)
    pauseReason: { type: String, trim: true },

    // Review trail
    submittedAt: Date,
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectionReason: { type: String, trim: true },

    // Running totals (fast reads)
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },

    // Per-day breakdown (used by the performance endpoint)
    dailyStats: { type: [dailyStatSchema], default: [] },
  },
  { timestamps: true }
);

advertisementSchema.index({ status: 1, startDate: 1, endDate: 1 });
advertisementSchema.index({ business: 1, status: 1 });

const Advertisement = mongoose.model("Advertisement", advertisementSchema);
export default Advertisement;