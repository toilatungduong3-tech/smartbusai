const express = require("express");
const router = express.Router();

const reviewController = require("../controllers/reviewController");

router.get("/trip/:tripId",         reviewController.getReviewsByTrip);
router.get("/operator/:operatorId", reviewController.getReviewsByOperator);
router.post("/operator",            reviewController.createOperatorReview);
router.post("/",                    reviewController.createReview);

module.exports = router;