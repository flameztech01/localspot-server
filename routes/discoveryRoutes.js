import express from "express";
import {
  getHomeData,
  searchBusinesses,
  listCategories,
  getBusinessesByCategory,
  getFeaturedBusinesses,
  getPopularBusinesses,
  getActivePromotions,
  getActiveAdvertisements,
} from "../controllers/featuredController.js";

const router = express.Router();

// All public — no auth needed
router.get("/home", getHomeData);
router.get("/search", searchBusinesses);
router.get("/categories", listCategories);
router.get("/category/:slug", getBusinessesByCategory);
router.get("/featured", getFeaturedBusinesses);
router.get("/popular", getPopularBusinesses);
router.get("/promotions", getActivePromotions);
router.get("/advertisements", getActiveAdvertisements);

export default router;