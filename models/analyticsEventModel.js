import mongoose from "mongoose";

const analyticsEventSchema = new mongoose.Schema(
  {
    // The business this event relates to (nullable for platform-wide events)
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    // The logged-in user who triggered the event (nullable for anonymous)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: [
        "page_view",
        "search",
        "business_view",
        "promotion_view",
        "ad_impression",
        "ad_click",
      ],
      required: true,
      index: true,
    },
    path: { type: String, trim: true },
    referrer: { type: String, trim: true },
    // "direct", "search", "social", "referral", "email"
    source: { type: String, trim: true, index: true },
    sessionId: { type: String, index: true },
    userAgent: String,
    ip: String,
    // Geo (populated from IP or frontend)
    city: { type: String, trim: true, index: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

analyticsEventSchema.index({ createdAt: -1 });
analyticsEventSchema.index({ type: 1, createdAt: -1 });

const AnalyticsEvent = mongoose.model("AnalyticsEvent", analyticsEventSchema);
export default AnalyticsEvent;