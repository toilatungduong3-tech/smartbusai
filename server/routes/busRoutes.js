const express = require("express");
const router = express.Router();
const busController = require("../controllers/busController");
const { authenticate, requireAdminOrOperator } = require("../middleware/authMiddleware");
const { attachOperatorId } = require("../middleware/operatorScope");

/* Phase 2I Step 4: writes below now require ADMIN or OPERATOR, with
   ownership enforced in the controller (an OPERATOR may only touch buses
   belonging to their own operator_id, resolved server-side — see
   operatorScope.js). Frontend callers (admin/operators.html,
   operator/vehicles.html, trips.html, seats.html) retrofitted to send the
   Bearer token — see those files for the corresponding change.
   Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: GET was previously
   public/unauthenticated, so no passenger page ever needed it (confirmed —
   only admin/operator pages call it), and any caller — including one
   operator targeting another — could read every operator's full fleet.
   Now gated the same as the writes; scoping to the caller's own operator
   happens in the controller. */

/* GET all buses — /api/buses (OPERATOR: own fleet only; ADMIN: ?operator_id= optional filter, else all) */
router.get("/",            authenticate, requireAdminOrOperator, attachOperatorId, busController.getBuses);

/* POST create bus */
router.post("/",           authenticate, requireAdminOrOperator, attachOperatorId, busController.createBus);

/* PUT update status — specific before /:id */
router.put("/status/:id",  authenticate, requireAdminOrOperator, attachOperatorId, busController.updateBusStatus);

/* GET bus by id */
router.get("/:id",         busController.getBusById);

/* GET seat layout blueprint (floor/row/column/aisle/special-seat JSON) —
   Sprint 6. Public, same posture as GET /api/seats/trip/:tripId (booking
   UI needs this with no auth). */
router.get("/:id/seat-layout", busController.getBusSeatLayout);

/* PUT update bus */
router.put("/:id",         authenticate, requireAdminOrOperator, attachOperatorId, busController.updateBus);

/* DELETE bus */
router.delete("/:id",      authenticate, requireAdminOrOperator, attachOperatorId, busController.deleteBus);

module.exports = router;
