// src/models/activityLogModel.js
import mongoose from "mongoose";

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        "Profile",
        "Verification",
        "Advertising",
        "Reviews",
        "Security",
        "Account",
        "Billing",
        "System",
      ],
      default: "System",
      index: true,
    },
    detail: { type: String, trim: true },
    status: {
      type: String,
      enum: ["info", "pending", "success", "error"],
      default: "info",
      index: true,
    },
    meta: { type: mongoose.Schema.Types.Mixed },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: true }
);

activityLogSchema.index({ user: 1, createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
export default ActivityLog;