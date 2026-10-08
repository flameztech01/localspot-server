import express from "express";
import {
  listUsers,
  getUserById,
  updateUserRole,
  toggleUserActive,
  deleteUser,
  adminSendPasswordReset,
  adminCreateBusiness,
  listFeaturedBusinesses,
  toggleBusinessFeatured,
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../controllers/adminController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin gate
const isAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    res.status(403);
    return next(new Error("Admin access only"));
  }
  next();
};

// Every route here requires a logged-in admin
router.use(protect, isAdmin);

// ──────────────────────────────────────────────────────────────
// Users
// ──────────────────────────────────────────────────────────────
router.get("/users", listUsers);
router.get("/users/:id", getUserById);
router.patch("/users/:id/role", updateUserRole);
router.patch("/users/:id/toggle-active", toggleUserActive);
router.delete("/users/:id", deleteUser);
router.post("/users/:id/send-password-reset", adminSendPasswordReset);

// ──────────────────────────────────────────────────────────────
// Business (admin create)
// ──────────────────────────────────────────────────────────────
router.post("/businesses", adminCreateBusiness);

// ──────────────────────────────────────────────────────────────
// Featured listings
// ──────────────────────────────────────────────────────────────
router.get("/featured", listFeaturedBusinesses);
router.patch("/featured/:id", toggleBusinessFeatured);

// ──────────────────────────────────────────────────────────────
// Categories
// ──────────────────────────────────────────────────────────────
router.get("/categories", listAllCategories);
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

export default router;