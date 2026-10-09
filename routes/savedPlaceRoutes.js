import express from "express";
import {
  listSavedPlaces,
  listSavedPlaceIds,
  savePlace,
  unsavePlace,
  toggleSavedPlace,
} from "../controllers/savedPlaceController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every route requires login
router.use(protect);

router.get("/", listSavedPlaces);
router.get("/ids", listSavedPlaceIds);
router.post("/:businessId", savePlace);
router.post("/:businessId/toggle", toggleSavedPlace);
router.delete("/:businessId", unsavePlace);

export default router;