import asyncHandler from "express-async-handler";
import User from "../models/userModel.js";
import Category from "../models/categoryModel.js";
import Promotion from "../models/promotionModel.js";
import Advertisement from "../models/advertisementModel.js";

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

// Only fully approved, publicly-visible businesses appear in discovery
const PUBLIC_BUSINESS_FILTER = {
  role: "business",
  isActive: true,
  isVerified: true,
  businessVerified: true,
};

// Fields shown in lists (skip password + OTP fields)
const LIST_PROJECTION =
  "businessName description categorySlug tags coverImage images location rating numReviews priceRange isFeatured isPopular openingHours";

const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 12));
  return { page, limit, skip: (page - 1) * limit };
};

const SORT_MAP = {
  rating: { rating: -1, numReviews: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { businessName: 1 },
  popular: { numReviews: -1, rating: -1 },
  featured: { isFeatured: -1, rating: -1 },
};
const resolveSort = (sort) => SORT_MAP[sort] || SORT_MAP.rating;

const toMinutes = (s) => {
  if (!s || typeof s !== "string") return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const isOpenNow = (openingHours) => {
  if (!Array.isArray(openingHours) || openingHours.length === 0) return false;
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = openingHours.find((h) => h.day === day);
  if (!today || today.closed) return false;
  const open = toMinutes(today.open);
  const close = toMinutes(today.close);
  if (open === null || close === null) return false;
  // Handle overnight hours (e.g. 22:00 → 02:00)
  if (close < open) return minutes >= open || minutes <= close;
  return minutes >= open && minutes <= close;
};

const buildBusinessFilter = (query) => {
  const filter = { ...PUBLIC_BUSINESS_FILTER };
  const and = [];

  if (query.q) {
    and.push({
      $or: [
        { businessName: { $regex: query.q, $options: "i" } },
        { description: { $regex: query.q, $options: "i" } },
        { tags: { $in: [new RegExp(query.q, "i")] } },
      ],
    });
  }

  if (query.location) {
    and.push({
      $or: [
        { "location.city": { $regex: query.location, $options: "i" } },
        { "location.state": { $regex: query.location, $options: "i" } },
        { "location.country": { $regex: query.location, $options: "i" } },
      ],
    });
  }

  if (and.length) filter.$and = and;

  if (query.category) filter.categorySlug = String(query.category).toLowerCase();

  if (query.rating) {
    const r = Number(query.rating);
    if (!Number.isNaN(r)) filter.rating = { $gte: r };
  }

  if (query.priceRange) {
    const prices = String(query.priceRange)
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 4);
    if (prices.length) filter.priceRange = { $in: prices };
  }

  return filter;
};

// Paginate a business query, optionally post-filtering for openNow
const paginateBusinesses = async (query, { filter, sort, page, limit, skip, openNow }) => {
  const sortSpec = resolveSort(sort);

  // When openNow is requested we post-filter in memory, so we take the whole
  // result set (capped) and slice manually. Fine for discovery-sized data.
  if (openNow) {
    const all = await User.find(filter)
      .sort(sortSpec)
      .limit(500)
      .select(LIST_PROJECTION);

    const filtered = all.filter((b) => isOpenNow(b.openingHours));
    const total = filtered.length;
    const results = filtered.slice(skip, skip + limit);

    return {
      businesses: results,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  const [businesses, total] = await Promise.all([
    User.find(filter).sort(sortSpec).skip(skip).limit(limit).select(LIST_PROJECTION),
    User.countDocuments(filter),
  ]);

  return {
    businesses,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// ──────────────────────────────────────────────────────────────
// @desc    Aggregated homepage payload
// @route   GET /api/v1/discovery/home
// @access  Public
// ──────────────────────────────────────────────────────────────
const getHomeData = asyncHandler(async (req, res) => {
  const now = new Date();

  const [categories, featured, popular, promotions, advertisements] = await Promise.all([
    Category.find({ isActive: true }).sort({ order: 1, name: 1 }).limit(12),
    User.find({ ...PUBLIC_BUSINESS_FILTER, isFeatured: true })
      .sort({ rating: -1, numReviews: -1 })
      .limit(8)
      .select(LIST_PROJECTION),
    User.find({ ...PUBLIC_BUSINESS_FILTER, isPopular: true })
      .sort({ numReviews: -1, rating: -1 })
      .limit(8)
      .select(LIST_PROJECTION),
    Promotion.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate("business", "businessName coverImage categorySlug location"),
    Advertisement.find({
      isActive: true,
      placement: "home_banner",
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .sort({ createdAt: -1 })
      .limit(5),
  ]);

  res.status(200).json({
    success: true,
    data: {
      categories,
      featured,
      popular,
      promotions,
      advertisements,
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Search businesses
// @route   GET /api/v1/discovery/search
// @access  Public
// ──────────────────────────────────────────────────────────────
const searchBusinesses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = buildBusinessFilter(req.query);
  const openNow = String(req.query.openNow).toLowerCase() === "true";

  const result = await paginateBusinesses(req, {
    filter,
    sort: req.query.sort,
    page,
    limit,
    skip,
    openNow,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    List all active categories
// @route   GET /api/v1/discovery/categories
// @access  Public
// ──────────────────────────────────────────────────────────────
const listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({
    order: 1,
    name: 1,
  });

  res.status(200).json({
    success: true,
    data: categories,
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Businesses in a given category
// @route   GET /api/v1/discovery/category/:slug
// @access  Public
// ──────────────────────────────────────────────────────────────
const getBusinessesByCategory = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page, limit, skip } = getPagination(req.query);
  const openNow = String(req.query.openNow).toLowerCase() === "true";

  // Confirm the category exists (nice for 404s and metadata)
  const category = await Category.findOne({
    slug: slug.toLowerCase(),
    isActive: true,
  });

  if (!category) {
    res.status(404);
    throw new Error("Category not found");
  }

  const filter = buildBusinessFilter({ ...req.query, category: slug });

  const result = await paginateBusinesses(req, {
    filter,
    sort: req.query.sort,
    page,
    limit,
    skip,
    openNow,
  });

  res.status(200).json({
    success: true,
    data: {
      category,
      ...result,
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Featured businesses
// @route   GET /api/v1/discovery/featured
// @access  Public
// ──────────────────────────────────────────────────────────────
const getFeaturedBusinesses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { ...PUBLIC_BUSINESS_FILTER, isFeatured: true };
  const sort = { rating: -1, numReviews: -1 };

  const [businesses, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).select(LIST_PROJECTION),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      businesses,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Popular businesses
// @route   GET /api/v1/discovery/popular
// @access  Public
// ──────────────────────────────────────────────────────────────
const getPopularBusinesses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { ...PUBLIC_BUSINESS_FILTER, isPopular: true };
  const sort = { numReviews: -1, rating: -1, viewCount: -1 };

  const [businesses, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).select(LIST_PROJECTION),
    User.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      businesses,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Currently active promotions
// @route   GET /api/v1/discovery/promotions
// @access  Public
// ──────────────────────────────────────────────────────────────
const getActivePromotions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const now = new Date();

  const filter = {
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  const [promotions, total] = await Promise.all([
    Promotion.find(filter)
      .sort({ endDate: 1 })
      .skip(skip)
      .limit(limit)
      .populate(
        "business",
        "businessName coverImage categorySlug location rating"
      ),
    Promotion.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      promotions,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────
// @desc    Currently active advertisements
// @route   GET /api/v1/discovery/advertisements
// @access  Public
// ──────────────────────────────────────────────────────────────
const getActiveAdvertisements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const now = new Date();

  const filter = {
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (req.query.placement) {
    filter.placement = req.query.placement;
  }

  const [advertisements, total] = await Promise.all([
    Advertisement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Advertisement.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      advertisements,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

export {
  getHomeData,
  searchBusinesses,
  listCategories,
  getBusinessesByCategory,
  getFeaturedBusinesses,
  getPopularBusinesses,
  getActivePromotions,
  getActiveAdvertisements,
};