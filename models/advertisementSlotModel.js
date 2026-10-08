import mongoose from "mongoose";

const advertisementSlotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    // e.g. "home_top", "category_sidebar", "search_inline"
    position: { type: String, trim: true, index: true },
    dimensions: {
      width: Number,
      height: Number,
    },
    // How many ads can run simultaneously in this slot
    maxActiveAds: { type: Number, default: 3, min: 1 },
    basePrice: { type: Number, default: 0 }, // per day, informational
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const AdvertisementSlot = mongoose.model("AdvertisementSlot", advertisementSlotSchema);
export default AdvertisementSlot;