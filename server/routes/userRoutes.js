console.log("✅ userRoutes loaded");

const express  = require("express");
const router   = express.Router();
const ctrl     = require("../controllers/userController");
const { authenticate, requireAdmin, requireSelfOrAdmin } = require("../middleware/authMiddleware");

/* ADMIN: danh sách + tạo user (không phải public register — xem /api/auth/register) */
router.get("/",    authenticate, requireAdmin, ctrl.getUsers);
router.post("/",   authenticate, requireAdmin, ctrl.createUser);

/* SELF OR ADMIN */
router.get("/:id",    authenticate, requireSelfOrAdmin, ctrl.getUserById);
router.put("/:id",    authenticate, requireSelfOrAdmin, ctrl.updateUser);
router.delete("/:id", authenticate, requireAdmin,       ctrl.deleteUser);

/* User data — self or admin */
router.get("/:id/loyalty",        authenticate, requireSelfOrAdmin, ctrl.getUserLoyalty);
router.post("/:id/redeem-points", authenticate, requireSelfOrAdmin, ctrl.redeemPoints);
router.get("/:id/stats",          authenticate, requireSelfOrAdmin, ctrl.getUserStats);
router.get("/:id/monthly-stats",  authenticate, requireSelfOrAdmin, ctrl.getMonthlyStats);
router.get("/:id/travel-profile", authenticate, requireSelfOrAdmin, ctrl.getTravelProfile);
router.get("/:id/notifications",  authenticate, requireSelfOrAdmin, ctrl.getNotifications);

module.exports = router;
