const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/bookingController");
const { authenticate, requireSelfOrAdmin, requireAdminOrOperator } = require("../middleware/authMiddleware");
const { attachOperatorId } = require("../middleware/operatorScope");

/* GET guest lookup  — /api/bookings/lookup?code=X&phone=Y (public, no auth) */
router.get("/lookup",    bookingController.lookupBooking);

/* GET public homepage ticker — /api/bookings/ticker (public, no auth,
   capped at 20 rows, PII-masked server-side — see getBookingsTicker) */
router.get("/ticker",    bookingController.getBookingsTicker);

/* GET all bookings  — /api/bookings
   Sprint 3 — MASTER_COMPLETION_MATRIX.md P0 blocker: previously fully
   unauthenticated and unscoped (the Phase 2I note here previously deferred
   this fix because operator/bookings.html had no auth-header mechanism —
   that page has now been retrofitted with the same _authHeaders() Bearer
   token pattern already used by vehicles.html/trips.html/seats.html).
   Now requires ADMIN or OPERATOR; an OPERATOR is scoped to their own
   bookings only (server-derived operator_id, never client-supplied). */
router.get("/",          authenticate, requireAdminOrOperator, attachOperatorId, bookingController.getAllBookings);

/* GET by user       — /api/bookings/user/:id
   Phase 2I: profile.html already sends a JWT here via authFetch(). */
router.get("/user/:id",  authenticate, requireSelfOrAdmin, bookingController.getBookingsByUser);

/* POST create       — /api/bookings (stays public: guest checkout) */
router.post("/",         bookingController.createBooking);

/* POST pay           — /api/bookings/:id/pay  (before /:id to avoid clash)
   Phase 2I: previously unauthenticated — anyone could mark any booking PAID
   with no booking_code, no ownership check at all. profile.html already
   sends a JWT here via authFetch(); ownership enforced in the controller. */
router.post("/:id/pay",  authenticate, bookingController.payBooking);

/* GET QR ticket       — /api/bookings/:id/qr
   Phase 2I: was an IDOR (any booking_id leaked full name/email/QR/checksum).
   profile.html already sends a JWT here via api.get(). */
router.get("/:id/qr",    authenticate, bookingController.getBookingQR);

/* POST verify QR      — /api/bookings/verify-qr (operator scanner)
   Sprint 7: closes the Phase 2I KNOWN GAP noted above — verifyBookingQR
   returns full_name/email for whatever booking_id a scanned QR resolves
   to, with zero access control; the checksum only proves the QR wasn't
   tampered with, not that the caller has any right to see this data (a
   photographed/leaked QR was replayable by anyone). operator/scan.html
   updated to send the Bearer token via _authHeaders(). */
router.post("/verify-qr", authenticate, requireAdminOrOperator, bookingController.verifyBookingQR);

/* PUT update status — /api/bookings/:id
   Phase 2I: was unauthenticated AND accepted any string as `status` with
   zero validation. profile.html already sends a JWT here (cancel flow).
   Ownership + a status whitelist are now enforced in the controller. */
router.put("/:id",       authenticate, bookingController.updateBookingStatus);

/* POST service-order — /api/bookings/:id/service-order
   Phase 2I: was unauthenticated, no ownership check.
   profile.html already sends a JWT here via authFetch(). */
router.post("/:id/service-order", authenticate, bookingController.addServiceOrder);

module.exports = router;
