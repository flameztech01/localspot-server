import mongoose from "mongoose";

const promotionSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    discountType: {
      type: String,
      enum: ["percent", "fixed", "other"],
      default: "percent",
    },
    discountValue: { type: Number },
    promoCode: { type: String, trim: true, uppercase: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    // draft → pending → approved / rejected → disabled
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "disabled"],
      default: "draft",
      index: true,
    },

    // Review trail
    submittedAt: Date,
    approvedAt: Date,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectionReason: { type: String, trim: true },
    disabledAt: Date,
    disabledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    disabledReason: { type: String, trim: true },

    // Light analytics
    viewCount: { type: Number, default: 0 },
    clickCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

promotionSchema.index({ status: 1, startDate: 1, endDate: 1 });
promotionSchema.index({ business: 1, status: 1 });

const Promotion = mongoose.model("Promotion", promotionSchema);
export default Promotion;