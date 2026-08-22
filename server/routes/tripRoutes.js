const express  = require("express");
const router   = express.Router();
const ctrl     = require("../controllers/tripController");
const { authenticate, requireAdmin, requireAdminOrOperator, optionalAuth } = require("../middleware/authMiddleware");
const { attachOperatorId } = require("../middleware/operatorScope");

/* PUBLIC — hành khách xem chuyến, tìm kiếm */
router.get("/",                  ctrl.getTrips);
router.get("/running",           ctrl.getRunningTrips);
// optionalAuth: search stays public/anonymous by default, but a logged-in
// caller's req.user.user_id lets searchTrips apply personalized ranking
// (Sprint 11 — see aiSearchRanking.js). Never blocks or requires a token.
router.get("/search",            optionalAuth, ctrl.searchTrips);
router.get("/dynamic-price/:id", ctrl.getDynamicPriceForTrip);
router.get("/:id",               ctrl.getTripById);

/* ADMIN OR OPERATOR — tạo, sửa, hủy chuyến.
   Phase 2I Step 2: createTrip/updateTrip had their own inline ownership
   check using the now-obsolete bus_operator.email = req.user.email scheme
   (same root cause as operatorScope.js's old design — see
   tests/phase2i_operator_identity_audit.md); updateTripStatus/
   updateTripPrice had NO ownership check at all, letting any OPERATOR
   modify any other operator's trip. All four now use the canonical
   users.operator_id-derived req.operatorId via attachOperatorId +
   ownsOperator(). */
router.post("/",              authenticate, requireAdminOrOperator, attachOperatorId, ctrl.createTrip);
router.put("/status/:id",     authenticate, requireAdminOrOperator, attachOperatorId, ctrl.updateTripStatus);
router.put("/price/:id",      authenticate, requireAdminOrOperator, attachOperatorId, ctrl.updateTripPrice);
router.put("/:id",            authenticate, requireAdminOrOperator, attachOperatorId, ctrl.updateTrip);

/* ADMIN only — xóa (soft) */
router.delete("/:id",         authenticate, requireAdmin, ctrl.deleteTrip);

module.exports = router;
