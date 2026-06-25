const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/bookingController");

/* GET guest lookup  — /api/bookings/lookup?code=X&phone=Y (public, no auth) */
router.get("/lookup",    bookingController.lookupBooking);

/* GET all bookings  — /api/bookings */
router.get("/",          bookingController.getAllBookings);

/* GET by user       — /api/bookings/user/:id */
router.get("/user/:id",  bookingController.getBookingsByUser);

/* POST create       — /api/bookings */
router.post("/",         bookingController.createBooking);

/* POST pay           — /api/bookings/:id/pay  (before /:id to avoid clash) */
router.post("/:id/pay",  bookingController.payBooking);

/* GET QR ticket       — /api/bookings/:id/qr */
router.get("/:id/qr",    bookingController.getBookingQR);

/* POST verify QR      — /api/bookings/verify-qr */
router.post("/verify-qr", bookingController.verifyBookingQR);

/* PUT update status — /api/bookings/:id */
router.put("/:id",       bookingController.updateBookingStatus);
router.post("/:id/service-order", bookingController.addServiceOrder);

module.exports = router;
