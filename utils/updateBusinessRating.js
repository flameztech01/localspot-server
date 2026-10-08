import Review from "../models/reviewModel.js";
import User from "../models/userModel.js";

export const updateBusinessRating = async (businessId) => {
  const result = await Review.aggregate([
    { $match: { business: businessId, isVisible: true } },
    {
      $group: {
        _id: "$business",
        avgRating: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = result[0] || { avgRating: 0, count: 0 };

  await User.findByIdAndUpdate(businessId, {
    rating: Number(stats.avgRating.toFixed(2)),
    numReviews: stats.count,
  });
};