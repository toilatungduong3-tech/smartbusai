const express = require("express");
const router = express.Router();

const reviewController = require("../controllers/reviewController");
const { authenticate } = require("../middleware/authMiddleware");

// GETs stay public — reviews are public-facing content by design.
router.get("/trip/:tripId",         reviewController.getReviewsByTrip);
router.get("/operator/:operatorId", reviewController.getReviewsByOperator);

// Phase 2I: both POSTs previously trusted body.user_id with zero auth —
// anyone could post a review attributed to any other user. index.html and
// nha-xe.html both already load js/api.js, so both were updated to send the
// Bearer token — zero regression.
router.post("/operator",            authenticate, reviewController.createOperatorReview);
router.post("/",                    authenticate, reviewController.createReview);

module.exports = router;