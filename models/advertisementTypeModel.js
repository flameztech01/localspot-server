import mongoose from "mongoose";

const advertisementTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    // "banner", "native", "sidebar", "video" etc — free-form for you
    category: { type: String, trim: true },
    dimensions: {
      width: Number,
      height: Number,
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const AdvertisementType = mongoose.model("AdvertisementType", advertisementTypeSchema);
export default AdvertisementType;