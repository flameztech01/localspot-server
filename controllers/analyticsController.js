import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Category from "../models/categoryModel.js";
import Promotion from "../models/promotionModel.js";
import Advertisement from "../models/advertisementModel.js";
import AnalyticsEvent from "../models/analyticsEventModel.js";

// ──────────────────────────────────────────────────────────────
// Date helpers
// ──────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

const parseRange = (query) => {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * DAY_MS);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    const err = new Error("Invalid from/to date");
    err.statusCode = 400;
    throw err;
  }
  if (from > to) {
    const err = new Error("`from` must be before `to`");
    err.statusCode = 400;
    throw err;
  }
  return { from, to };
};

const dateFormat = (granularity) => {
  switch (granularity) {
    case "month":
      return "%Y-%m";
    case "week":
      return "%G-W%V";
    case "year":
      return "%Y";
    case "day":
    default:
      return "%Y-%m-%d";
  }
};

const bucketExpr = (granularity, field = "$createdAt") => ({
  $dateToString: { format: dateFormat(granularity), date: field },
});

// Pagination
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

// Shared date-range match stage
const rangeMatch = (from, to, extra = {}) => ({
  createdAt: { $gte: from, $lte: to },
  ...extra,
});

// ══════════════════════════════════════════════════════════════
// BUSINESS
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Analytics for the logged-in business
// @route   GET /api/v1/analytics/business
// @access  Private
// ──────────────────────────────────────────────────────────────
const getBusinessAnalytics = asyncHandler(async (req, res) => {
  const businessId = new mongoose.Types.ObjectId(req.user._id);
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const bucket = bucketExpr(granularity);

  const [
    profile,
    overviewEvents,
    trafficSourceAgg,
    viewSeries,
    promotionViewSeries,
    adImpressionSeries,
    adClickSeries,
    promotionsByStatus,
    topPromotions,
    adAgg,
    adsByStatus,
  ] = await Promise.all([
    // Profile snapshot
    User.findById(businessId).select(
      "businessName viewCount rating numReviews isVerified businessVerified createdAt"
    ),

    // High-level event counts
    AnalyticsEvent.aggregate([
      { $match: rangeMatch(from, to, { business: businessId }) },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]),

    // Traffic sources
    AnalyticsEvent.aggregate([
      {
        $match: rangeMatch(from, to, {
          business: businessId,
          source: { $ne: null },
        }),
      },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),

    // Time series — profile views
    AnalyticsEvent.aggregate([
      {
        $match: rangeMatch(from, to, {
          business: businessId,
          type: "business_view",
        }),
      },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Time series — promotion views
    AnalyticsEvent.aggregate([
      {
        $match: rangeMatch(from, to, {
          business: businessId,
          type: "promotion_view",
        }),
      },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Time series — ad impressions
    AnalyticsEvent.aggregate([
      {
        $match: rangeMatch(from, to, {
          business: businessId,
          type: "ad_impression",
        }),
      },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Time series — ad clicks
    AnalyticsEvent.aggregate([
      {
        $match: rangeMatch(from, to, {
          business: businessId,
          type: "ad_click",
        }),
      },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Promotions by status
    Promotion.aggregate([
      { $match: { business: businessId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // Top promotions by views
    Promotion.find({ business: businessId })
      .sort({ viewCount: -1, createdAt: -1 })
      .limit(5)
      .select("title image viewCount clickCount status startDate endDate"),

    // Ad totals
    Advertisement.aggregate([
      { $match: { business: businessId } },
      {
        $group: {
          _id: null,
          impressions: { $sum: "$impressions" },
          clicks: { $sum: "$clicks" },
          conversions: { $sum: "$conversions" },
          total: { $sum: 1 },
        },
      },
    ]),

    // Ads by status
    Advertisement.aggregate([
      { $match: { business: businessId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  // Reshape
  const eventMap = overviewEvents.reduce((acc, e) => {
    acc[e._id] = e.count;
    return acc;
  }, {});

  const adTotals = adAgg[0] || {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    total: 0,
  };
  const adCtr =
    adTotals.impressions > 0
      ? Number(((adTotals.clicks / adTotals.impressions) * 100).toFixed(2))
      : 0;

  const promotionMap = promotionsByStatus.reduce((acc, p) => {
    acc[p._id] = p.count;
    return acc;
  }, {});

  const adsMap = adsByStatus.reduce((acc, a) => {
    acc[a._id] = a.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      profile,
      overview: {
        profileViews: eventMap.business_view || 0,
        promotionViews: eventMap.promotion_view || 0,
        adImpressions: eventMap.ad_impression || 0,
        adClicks: eventMap.ad_click || 0,
        searches: eventMap.search || 0,
        pageViews: eventMap.page_view || 0,
      },
      series: {
        views: viewSeries.map((d) => ({ date: d._id, count: d.count })),
        promotionViews: promotionViewSeries.map((d) => ({
          date: d._id,
          count: d.count,
        })),
        adImpressions: adImpressionSeries.map((d) => ({
          date: d._id,
          count: d.count,
        })),
        adClicks: adClickSeries.map((d) => ({
          date: d._id,
          count: d.count,
        })),
      },
      trafficSources: trafficSourceAgg.map((s) => ({
        source: s._id,
        count: s.count,
      })),
      promotions: {
        total: Object.values(promotionMap).reduce((a, b) => a + b, 0),
        byStatus: promotionMap,
        top: topPromotions,
      },
      advertisements: {
        total: adTotals.total,
        byStatus: adsMap,
        performance: {
          impressions: adTotals.impressions,
          clicks: adTotals.clicks,
          conversions: adTotals.conversions,
          ctr: adCtr,
        },
      },
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — OVERVIEW
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    High-level platform analytics
// @route   GET /api/v1/analytics/admin/overview
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsOverview = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const bucket = bucketExpr(granularity);

  const [
    businessesTotals,
    promotionsTotals,
    adsTotals,
    eventsTotals,
    categoryCount,
    businessesSeries,
    eventsSeries,
    adsSeries,
    promotionsSeries,
    recent,
  ] = await Promise.all([
    // Business statuses (all-time)
    User.aggregate([
      { $match: { role: "business" } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          emailVerified: { $sum: { $cond: ["$isVerified", 1, 0] } },
          businessVerified: { $sum: { $cond: ["$businessVerified", 1, 0] } },
          active: { $sum: { $cond: ["$isActive", 1, 0] } },
          rejected: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isVerified", true] },
                    { $eq: ["$businessVerified", false] },
                    { $ne: ["$businessRejectionReason", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),

    // Promotions
    Promotion.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // Ads
    Advertisement.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),

    // Traffic events in range
    AnalyticsEvent.aggregate([
      { $match: rangeMatch(from, to) },
      { $group: { _id: "$type", count: { $sum: 1 } } },
    ]),

    Category.countDocuments({ isActive: true }),

    // Business growth over time
    User.aggregate([
      { $match: rangeMatch(from, to, { role: "business" }) },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Events over time
    AnalyticsEvent.aggregate([
      { $match: rangeMatch(from, to) },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Ads created over time
    Advertisement.aggregate([
      { $match: rangeMatch(from, to) },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Promotions created over time
    Promotion.aggregate([
      { $match: rangeMatch(from, to) },
      { $group: { _id: bucket, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),

    // Recent counts (last 7 days)
    Promise.all([
      User.countDocuments({
        role: "business",
        createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      }),
      Promotion.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      }),
      Advertisement.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      }),
    ]),
  ]);

  const bTotals = businessesTotals[0] || {
    total: 0,
    emailVerified: 0,
    businessVerified: 0,
    active: 0,
    rejected: 0,
  };

  const promoMap = promotionsTotals.reduce((acc, p) => {
    acc[p._id] = p.count;
    return acc;
  }, {});
  const adsMap = adsTotals.reduce((acc, a) => {
    acc[a._id] = a.count;
    return acc;
  }, {});
  const eventMap = eventsTotals.reduce((acc, e) => {
    acc[e._id] = e.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      totals: {
        businesses: {
          total: bTotals.total,
          emailVerified: bTotals.emailVerified,
          businessVerified: bTotals.businessVerified,
          pendingApproval: bTotals.emailVerified - bTotals.businessVerified - bTotals.rejected,
          rejected: bTotals.rejected,
          active: bTotals.active,
        },
        promotions: {
          total: Object.values(promoMap).reduce((a, b) => a + b, 0),
          byStatus: promoMap,
        },
        advertisements: {
          total: Object.values(adsMap).reduce((a, b) => a + b, 0),
          byStatus: adsMap,
        },
        categories: categoryCount,
        events: {
          total: Object.values(eventMap).reduce((a, b) => a + b, 0),
          byType: eventMap,
        },
      },
      series: {
        businesses: businessesSeries.map((d) => ({ date: d._id, count: d.count })),
        events: eventsSeries.map((d) => ({ date: d._id, count: d.count })),
        advertisements: adsSeries.map((d) => ({ date: d._id, count: d.count })),
        promotions: promotionsSeries.map((d) => ({ date: d._id, count: d.count })),
      },
      recent: {
        newBusinesses: recent[0],
        newPromotions: recent[1],
        newAdvertisements: recent[2],
      },
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — TRAFFIC
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Platform traffic analytics
// @route   GET /api/v1/analytics/admin/traffic
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsTraffic = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const bucket = bucketExpr(granularity);

  const [totals, series, topPaths, sources, devices, topBusinesses] =
    await Promise.all([
      // Totals by type
      AnalyticsEvent.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            uniqueSessions: { $addToSet: "$sessionId" },
          },
        },
        {
          $project: {
            count: 1,
            uniqueSessions: { $size: { $ifNull: ["$uniqueSessions", []] } },
          },
        },
      ]),

      // Overall series
      AnalyticsEvent.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: bucket,
            total: { $sum: 1 },
            sessions: { $addToSet: "$sessionId" },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            date: "$_id",
            total: 1,
            sessions: { $size: { $ifNull: ["$sessions", []] } },
          },
        },
      ]),

      // Top visited paths
      AnalyticsEvent.aggregate([
        { $match: rangeMatch(from, to, { path: { $ne: null } }) },
        { $group: { _id: "$path", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      // Traffic sources
      AnalyticsEvent.aggregate([
        { $match: rangeMatch(from, to, { source: { $ne: null } }) },
        { $group: { _id: "$source", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // Simple device detection from userAgent
      AnalyticsEvent.aggregate([
        { $match: rangeMatch(from, to, { userAgent: { $ne: null } }) },
        {
          $project: {
            device: {
              $switch: {
                branches: [
                  {
                    case: { $regexMatch: { input: "$userAgent", regex: /Mobile|Android|iPhone|iPad/i } },
                    then: "mobile",
                  },
                  {
                    case: { $regexMatch: { input: "$userAgent", regex: /Tablet|iPad/i } },
                    then: "tablet",
                  },
                ],
                default: "desktop",
              },
            },
          },
        },
        { $group: { _id: "$device", count: { $sum: 1 } } },
      ]),

      // Most-viewed businesses
      AnalyticsEvent.aggregate([
        {
          $match: rangeMatch(from, to, {
            type: "business_view",
            business: { $ne: null },
          }),
        },
        { $group: { _id: "$business", views: { $sum: 1 } } },
        { $sort: { views: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "business",
          },
        },
        { $unwind: "$business" },
        {
          $project: {
            _id: 0,
            businessId: "$_id",
            businessName: "$business.businessName",
            coverImage: "$business.coverImage",
            views: 1,
          },
        },
      ]),
    ]);

  const totalsMap = totals.reduce((acc, t) => {
    acc[t._id] = { count: t.count, uniqueSessions: t.uniqueSessions };
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      totals: totalsMap,
      series,
      topPaths: topPaths.map((p) => ({ path: p._id, count: p.count })),
      sources: sources.map((s) => ({ source: s._id, count: s.count })),
      devices: devices.map((d) => ({ device: d._id, count: d.count })),
      topBusinesses,
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — BUSINESSES
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Business-level analytics
// @route   GET /api/v1/analytics/admin/businesses
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsBusinesses = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const { page, limit, skip } = getPagination(req.query);
  const bucket = bucketExpr(granularity);

  const [byStatus, growth, topByViews, topByRating, sortable, total] =
    await Promise.all([
      // Status breakdown
      User.aggregate([
        { $match: { role: "business" } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            emailVerified: { $sum: { $cond: ["$isVerified", 1, 0] } },
            businessVerified: { $sum: { $cond: ["$businessVerified", 1, 0] } },
            active: { $sum: { $cond: ["$isActive", 1, 0] } },
          },
        },
      ]),

      // Growth
      User.aggregate([
        { $match: rangeMatch(from, to, { role: "business" }) },
        { $group: { _id: bucket, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),

      // Top by views
      User.find({ role: "business", businessVerified: true })
        .sort({ viewCount: -1 })
        .limit(10)
        .select("businessName coverImage viewCount rating numReviews categorySlug"),

      // Top by rating
      User.find({ role: "business", businessVerified: true })
        .sort({ rating: -1, numReviews: -1 })
        .limit(10)
        .select("businessName coverImage viewCount rating numReviews categorySlug"),

      // Paginated list — sort configurable
      (() => {
        const allowedSorts = {
          newest: { createdAt: -1 },
          oldest: { createdAt: 1 },
          rating: { rating: -1, numReviews: -1 },
          views: { viewCount: -1 },
          name: { businessName: 1 },
        };
        const sortSpec = allowedSorts[req.query.sort] || allowedSorts.newest;

        const filter = { role: "business" };
        if (req.query.status === "pending") {
          filter.isVerified = true;
          filter.businessVerified = false;
        } else if (req.query.status === "approved") {
          filter.businessVerified = true;
        } else if (req.query.status === "unverified") {
          filter.isVerified = false;
        }

        return User.find(filter)
          .sort(sortSpec)
          .skip(skip)
          .limit(limit)
          .select(
            "businessName email coverImage categorySlug location viewCount rating numReviews isVerified businessVerified isActive createdAt"
          );
      })(),

      User.countDocuments({ role: "business" }),
    ]);

  const status = byStatus[0] || {
    total: 0,
    emailVerified: 0,
    businessVerified: 0,
    active: 0,
  };

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      status,
      series: {
        growth: growth.map((d) => ({ date: d._id, count: d.count })),
      },
      topByViews,
      topByRating,
      businesses: sortable,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — CATEGORIES
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Category analytics
// @route   GET /api/v1/analytics/admin/categories
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsCategories = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);

  const [distribution, growth, topCategories, categories] = await Promise.all([
    // Distribution of businesses by category slug
    User.aggregate([
      { $match: { role: "business", businessVerified: true, categorySlug: { $ne: null } } },
      { $group: { _id: "$categorySlug", count: { $sum: 1 }, views: { $sum: "$viewCount" } } },
      { $sort: { count: -1 } },
    ]),

    // Growth of category-tagged businesses over time
    User.aggregate([
      {
        $match: rangeMatch(from, to, {
          role: "business",
          businessVerified: true,
          categorySlug: { $ne: null },
        }),
      },
      {
        $group: {
          _id: { date: bucketExpr("day"), category: "$categorySlug" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": 1 } },
    ]),

    // Top categories by business activity
    User.aggregate([
      { $match: { role: "business", businessVerified: true, categorySlug: { $ne: null } } },
      {
        $group: {
          _id: "$categorySlug",
          businesses: { $sum: 1 },
          totalViews: { $sum: "$viewCount" },
          avgRating: { $avg: "$rating" },
        },
      },
      { $sort: { totalViews: -1 } },
      { $limit: 10 },
    ]),

    Category.find({ isActive: true }).select("name slug icon order"),
  ]);

  res.status(200).json({
    success: true,
    data: {
      range: { from, to },
      categories,
      distribution: distribution.map((d) => ({
        categorySlug: d._id,
        businesses: d.count,
        views: d.views,
      })),
      growth: growth.map((g) => ({
        date: g._id.date,
        categorySlug: g._id.category,
        count: g.count,
      })),
      topCategories: topCategories.map((c) => ({
        categorySlug: c._id,
        businesses: c.businesses,
        totalViews: c.totalViews,
        avgRating: c.avgRating ? Number(c.avgRating.toFixed(2)) : 0,
      })),
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — LOCATIONS
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Location analytics
// @route   GET /api/v1/analytics/admin/locations
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsLocations = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);

  const baseMatch = { role: "business", businessVerified: true };

  const [byCity, byState, byCountry, eventCities] = await Promise.all([
    User.aggregate([
      { $match: { ...baseMatch, "location.city": { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$location.city",
          count: { $sum: 1 },
          views: { $sum: "$viewCount" },
          avgRating: { $avg: "$rating" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),

    User.aggregate([
      { $match: { ...baseMatch, "location.state": { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$location.state",
          count: { $sum: 1 },
          views: { $sum: "$viewCount" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),

    User.aggregate([
      { $match: { ...baseMatch, "location.country": { $nin: [null, ""] } } },
      {
        $group: {
          _id: "$location.country",
          count: { $sum: 1 },
          views: { $sum: "$viewCount" },
        },
      },
      { $sort: { count: -1 } },
    ]),

    // Visitor geography from events
    AnalyticsEvent.aggregate([
      { $match: rangeMatch(from, to, { country: { $ne: null } }) },
      {
        $group: {
          _id: { country: "$country", city: "$city" },
          visitors: { $sum: 1 },
        },
      },
      { $sort: { visitors: -1 } },
      { $limit: 50 },
    ]),
  ]);

  res.status(200).json({
    success: true,
    data: {
      range: { from, to },
      byCity: byCity.map((c) => ({
        city: c._id,
        businesses: c.count,
        views: c.views,
        avgRating: c.avgRating ? Number(c.avgRating.toFixed(2)) : 0,
      })),
      byState: byState.map((s) => ({
        state: s._id,
        businesses: s.count,
        views: s.views,
      })),
      byCountry: byCountry.map((c) => ({
        country: c._id,
        businesses: c.count,
        views: c.views,
      })),
      visitorGeographies: eventCities.map((e) => ({
        country: e._id.country,
        city: e._id.city,
        visitors: e.visitors,
      })),
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — ADVERTISING
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Advertising analytics
// @route   GET /api/v1/analytics/admin/advertising
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsAdvertising = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const bucket = bucketExpr(granularity);

  const [totals, byStatus, bySlot, byType, series, topAds, ctrBySlot] =
    await Promise.all([
      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: null,
            impressions: { $sum: "$impressions" },
            clicks: { $sum: "$clicks" },
            conversions: { $sum: "$conversions" },
            total: { $sum: 1 },
            budget: { $sum: "$budget" },
          },
        },
      ]),

      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),

      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: "$slot",
            count: { $sum: 1 },
            impressions: { $sum: "$impressions" },
            clicks: { $sum: "$clicks" },
          },
        },
        { $sort: { count: -1 } },
        {
          $lookup: {
            from: "advertisementslots",
            localField: "_id",
            foreignField: "_id",
            as: "slot",
          },
        },
        { $unwind: { path: "$slot", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            slotId: "$_id",
            slotName: "$slot.name",
            position: "$slot.position",
            count: 1,
            impressions: 1,
            clicks: 1,
          },
        },
      ]),

      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            impressions: { $sum: "$impressions" },
            clicks: { $sum: "$clicks" },
          },
        },
        { $sort: { count: -1 } },
        {
          $lookup: {
            from: "advertisementtypes",
            localField: "_id",
            foreignField: "_id",
            as: "type",
          },
        },
        { $unwind: { path: "$type", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            typeId: "$_id",
            typeName: "$type.name",
            category: "$type.category",
            count: 1,
            impressions: 1,
            clicks: 1,
          },
        },
      ]),

      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: bucket,
            impressions: { $sum: "$impressions" },
            clicks: { $sum: "$clicks" },
            conversions: { $sum: "$conversions" },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      Advertisement.find(rangeMatch(from, to))
        .sort({ impressions: -1 })
        .limit(10)
        .populate("business", "businessName")
        .populate("slot", "name")
        .select("title impressions clicks conversions status business slot"),

      // CTR by slot
      Advertisement.aggregate([
        { $match: rangeMatch(from, to) },
        {
          $group: {
            _id: "$slot",
            impressions: { $sum: "$impressions" },
            clicks: { $sum: "$clicks" },
          },
        },
        {
          $project: {
            impressions: 1,
            clicks: 1,
            ctr: {
              $cond: [
                { $gt: ["$impressions", 0] },
                {
                  $multiply: [
                    { $divide: ["$clicks", "$impressions"] },
                    100,
                  ],
                },
                0,
              ],
            },
          },
        },
        { $sort: { ctr: -1 } },
      ]),
    ]);

  const t = totals[0] || {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    total: 0,
    budget: 0,
  };
  const overallCtr =
    t.impressions > 0 ? Number(((t.clicks / t.impressions) * 100).toFixed(2)) : 0;

  const statusMap = byStatus.reduce((acc, s) => {
    acc[s._id] = s.count;
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      totals: {
        total: t.total,
        impressions: t.impressions,
        clicks: t.clicks,
        conversions: t.conversions,
        budget: t.budget,
        ctr: overallCtr,
      },
      byStatus: statusMap,
      bySlot: bySlot.map((s) => ({
        slotId: s.slotId,
        slotName: s.slotName,
        position: s.position,
        count: s.count,
        impressions: s.impressions,
        clicks: s.clicks,
        ctr:
          s.impressions > 0
            ? Number(((s.clicks / s.impressions) * 100).toFixed(2))
            : 0,
      })),
      byType: byType.map((t) => ({
        typeId: t.typeId,
        typeName: t.typeName,
        category: t.category,
        count: t.count,
        impressions: t.impressions,
        clicks: t.clicks,
        ctr:
          t.impressions > 0
            ? Number(((t.clicks / t.impressions) * 100).toFixed(2))
            : 0,
      })),
      series: series.map((d) => ({
        date: d._id,
        impressions: d.impressions,
        clicks: d.clicks,
        conversions: d.conversions,
      })),
      topAdvertisements: topAds,
      ctrBySlot: ctrBySlot.map((c) => ({
        slotId: c._id,
        ctr: Number(c.ctr.toFixed(2)),
      })),
    },
  });
});

// ══════════════════════════════════════════════════════════════
// ADMIN — REVENUE
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// @desc    Revenue analytics (derived from ad budgets)
// @route   GET /api/v1/analytics/admin/revenue
// @access  Private (admin)
// ──────────────────────────────────────────────────────────────
const getAdminAnalyticsRevenue = asyncHandler(async (req, res) => {
  const { from, to } = parseRange(req.query);
  const granularity = req.query.granularity || "day";
  const bucket = bucketExpr(granularity);

  // Revenue is derived from approved advertisement budgets.
  // If you later add a Transaction model, swap these pipelines.
  const [totals, series, byStatus, topSpenders, bySlot] = await Promise.all([
    Advertisement.aggregate([
      { $match: rangeMatch(from, to) },
      {
        $group: {
          _id: null,
          totalBudget: { $sum: "$budget" },
          approvedBudget: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, "$budget", 0] },
          },
          pendingBudget: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, "$budget", 0] },
          },
          adCount: { $sum: 1 },
        },
      },
    ]),

    Advertisement.aggregate([
      { $match: rangeMatch(from, to, { status: "approved" }) },
      {
        $group: {
          _id: bucket,
          revenue: { $sum: "$budget" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    Advertisement.aggregate([
      { $match: rangeMatch(from, to) },
      {
        $group: {
          _id: "$status",
          budget: { $sum: "$budget" },
          count: { $sum: 1 },
        },
      },
    ]),

    Advertisement.aggregate([
      { $match: rangeMatch(from, to, { status: "approved" }) },
      {
        $group: {
          _id: "$business",
          totalSpent: { $sum: "$budget" },
          adCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "business",
        },
      },
      { $unwind: "$business" },
      {
        $project: {
          _id: 0,
          businessId: "$_id",
          businessName: "$business.businessName",
          email: "$business.email",
          totalSpent: 1,
          adCount: 1,
        },
      },
    ]),

    Advertisement.aggregate([
      { $match: rangeMatch(from, to, { status: "approved" }) },
      { $group: { _id: "$slot", revenue: { $sum: "$budget" }, count: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      {
        $lookup: {
          from: "advertisementslots",
          localField: "_id",
          foreignField: "_id",
          as: "slot",
        },
      },
      { $unwind: { path: "$slot", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          slotId: "$_id",
          slotName: "$slot.name",
          revenue: 1,
          count: 1,
        },
      },
    ]),
  ]);

  const t = totals[0] || {
    totalBudget: 0,
    approvedBudget: 0,
    pendingBudget: 0,
    adCount: 0,
  };

  const statusMap = byStatus.reduce((acc, s) => {
    acc[s._id] = { budget: s.budget, count: s.count };
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      range: { from, to, granularity },
      totals: t,
      byStatus: statusMap,
      series: series.map((d) => ({
        date: d._id,
        revenue: d.revenue,
        count: d.count,
      })),
      topSpenders,
      bySlot: bySlot.map((s) => ({
        slotId: s.slotId,
        slotName: s.slotName,
        revenue: s.revenue,
        count: s.count,
      })),
    },
  });
});

export {
  getBusinessAnalytics,
  getAdminAnalyticsOverview,
  getAdminAnalyticsTraffic,
  getAdminAnalyticsBusinesses,
  getAdminAnalyticsCategories,
  getAdminAnalyticsLocations,
  getAdminAnalyticsAdvertising,
  getAdminAnalyticsRevenue,
};