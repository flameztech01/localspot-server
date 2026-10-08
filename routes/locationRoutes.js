import express from "express";
import {
  searchLocation,
  reverseGeocode,
} from "../controllers/locationController.js";

const router = express.Router();

// Both public — no auth needed for geocoding
router.get("/search", searchLocation);
router.get("/reverse", reverseGeocode);

export default router;