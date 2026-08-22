const express = require("express");
const router = express.Router();
const seatController = require("../controllers/seatController");
const { authenticate, requireAdminOrOperator } = require("../middleware/authMiddleware");
const { attachOperatorId } = require("../middleware/operatorScope");

/* Phase 2I Step 4: generate/expand/create/update/delete now require ADMIN
   or OPERATOR, with ownership enforced in the controller via the seat's
   bus -> operator_id chain (see operatorScope.js). operator/seats.html
   retrofitted to send the Bearer token. GET /trip/:tripId stays public —
   it's the passenger seat-map call, used by booking.html and index.html
   with no login required (booking a specific trip's seats is a legitimate
   anonymous action, not a fleet-data leak).
   Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: GET /bus/:busId
   previously stayed public/unscoped alongside it — but unlike the
   trip-scoped seat map, this returns an entire bus's seat layout with no
   booking context at all, letting any caller enumerate bus_id values to
   read any operator's fleet configuration. Now gated + ownership-checked
   in the controller, matching every write on this same resource. */

/* GET seats by bus    — /api/seats/bus/:busId (OPERATOR: own buses only) */
router.get("/bus/:busId",             authenticate, requireAdminOrOperator, attachOperatorId, seatController.getSeatsByBus);

/* GET seats by trip   — /api/seats/trip/:tripId (stays public — passenger seat map) */
router.get("/trip/:tripId",           seatController.getSeatsByTrip);

/* POST generate seats — /api/seats/generate/:tripId */
router.post("/generate/:tripId",      authenticate, requireAdminOrOperator, attachOperatorId, seatController.generateSeats);

/* POST expand seats   — /api/seats/expand-bus/:busId */
router.post("/expand-bus/:busId",     authenticate, requireAdminOrOperator, attachOperatorId, seatController.expandSeats);

/* POST create seat    — /api/seats */
router.post("/",                      authenticate, requireAdminOrOperator, attachOperatorId, seatController.createSeat);

/* PUT update seat     — /api/seats/:id */
router.put("/:id",                    authenticate, requireAdminOrOperator, attachOperatorId, seatController.updateSeat);

/* DELETE seat         — /api/seats/:id */
router.delete("/:id",                 authenticate, requireAdminOrOperator, attachOperatorId, seatController.deleteSeat);

module.exports = router;
