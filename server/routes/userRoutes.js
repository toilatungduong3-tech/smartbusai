const express  = require("express");
const logger = require('../utils/logger');
const router   = express.Router();
const ctrl     = require("../controllers/userController");
const { authenticate, requireAdmin, requireSelfOrAdmin } = require("../middleware/authMiddleware");

logger.info("✅ userRoutes loaded");

/* ADMIN: danh sách + tạo user (không phải public register — xem /api/auth/register) */
router.get("/",    authenticate, requireAdmin, ctrl.getUsers);
router.post("/",   authenticate, requireAdmin, ctrl.createUser);

/* SELF OR ADMIN */
router.get("/:id",    authenticate, requireSelfOrAdmin, ctrl.getUserById);
router.put("/:id",    authenticate, requireSelfOrAdmin, ctrl.updateUser);
/* Sprint 7 — was completely missing; profile.html's change-password modal
   has been calling this exact path since it was built. */
router.put("/:id/password", authenticate, requireSelfOrAdmin, ctrl.changePassword);
router.post("/:id/avatar",  authenticate, requireSelfOrAdmin, ctrl.uploadAvatar);
router.delete("/:id", authenticate, requireAdmin,       ctrl.deleteUser);

/* User data — self or admin */
router.get("/:id/loyalty",        authenticate, requireSelfOrAdmin, ctrl.getUserLoyalty);
router.post("/:id/redeem-points", authenticate, requireSelfOrAdmin, ctrl.redeemPoints);
router.get("/:id/stats",          authenticate, requireSelfOrAdmin, ctrl.getUserStats);
router.get("/:id/monthly-stats",  authenticate, requireSelfOrAdmin, ctrl.getMonthlyStats);
router.get("/:id/travel-profile", authenticate, requireSelfOrAdmin, ctrl.getTravelProfile);
router.get("/:id/notifications",  authenticate, requireSelfOrAdmin, ctrl.getNotifications);

/* Sprint 6 — Passenger Analytics + Saved Passengers (companion list) */
router.get("/:id/stats-summary",  authenticate, requireSelfOrAdmin, ctrl.getStatsSummary);
router.get("/:id/saved-passengers",    authenticate, requireSelfOrAdmin, ctrl.getSavedPassengers);
router.post("/:id/saved-passengers",   authenticate, requireSelfOrAdmin, ctrl.addSavedPassenger);
router.delete("/:id/saved-passengers/:passengerId", authenticate, requireSelfOrAdmin, ctrl.deleteSavedPassenger);

module.exports = router;
