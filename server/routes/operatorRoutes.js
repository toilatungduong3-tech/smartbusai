const express = require("express");
const router = express.Router();
const operatorController = require("../controllers/operatorController");
const { authenticate, requireAdmin, requireAdminOrOperator } = require("../middleware/authMiddleware");
const { attachOperatorId } = require("../middleware/operatorScope");

/* Phase 2I Step 4: CRUD is ADMIN-only — admin/operators.html (the only
   caller) is already gated to ADMIN client-side, and there is no
   self-service "edit my own operator profile" flow anywhere in the app.
   Dashboard routes require ADMIN or OPERATOR; the controller now scopes
   every dashboard query to the authenticated operator's own operator_id
   (resolved server-side via operatorScope.js) when the caller is an
   OPERATOR, and leaves them platform-wide for ADMIN. GET / stays public —
   read by nha-xe.html as the public bus-company directory. */

/* ── Admin CRUD ── */
router.get("/",    operatorController.getOperators);
router.post("/",   authenticate, requireAdmin, operatorController.createOperator);
router.put("/:id", authenticate, requireAdmin, operatorController.updateOperator);
router.delete("/:id", authenticate, requireAdmin, operatorController.deleteOperator);

/* ── Operator Dashboard (scoped to the authenticated operator; ADMIN sees platform-wide) ── */
router.get("/dashboard/stats",          authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getDashboardStats);
router.get("/dashboard/revenue",        authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getRevenue);
router.get("/dashboard/routes",         authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getTopRoutes);
router.get("/dashboard/booking-status", authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getBookingStatus);
router.get("/dashboard/seat-occupancy", authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getSeatOccupancy);
router.get("/dashboard/recent-trips",   authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getRecentTrips);
router.get("/dashboard/buses",          authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getBuses);
router.get("/dashboard/reviews",        authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getReviews);
router.get("/dashboard/payments",       authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getPayments);
router.get("/dashboard/bookings",       authenticate, requireAdminOrOperator, attachOperatorId, operatorController.getBookingsSummary);

module.exports = router;
