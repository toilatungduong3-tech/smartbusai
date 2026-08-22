const reviewRepo = require("../repositories/reviewRepository");
const logger = require('../utils/logger');

/* GET reviews by operator */
exports.getReviewsByOperator = async (req, res) => {
    try {
        const opId = req.params.operatorId;
        const rows = await reviewRepo.findByOperator(opId);
        res.json(reviewRepo.summarize(rows));
    } catch (err) {
        logger.error("getReviewsByOperator error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

/* POST review for operator */
exports.createOperatorReview = async (req, res) => {
    // Phase 2I: user_id now comes from the authenticated JWT, not the
    // request body — previously any caller could post a review attributed
    // to any other user_id (fake-review / impersonation risk).
    const user_id = req.user.user_id;
    const { operator_id, rating, comment } = req.body;
    if (!operator_id || !rating)
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    try {
        if (await reviewRepo.operatorReviewExists(user_id, operator_id))
            return res.status(400).json({ message: "Bạn đã đánh giá nhà xe này rồi" });
        await reviewRepo.createOperatorReview({ user_id, operator_id, rating, comment });
        res.json({ message: "Review created" });
    } catch (err) {
        logger.error("createOperatorReview error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

/* GET reviews by trip */
exports.getReviewsByTrip = async (req, res) => {
    try {
        const tripId = req.params.tripId;
        const rows = await reviewRepo.findByTrip(tripId);
        res.json(reviewRepo.summarize(rows));
    } catch (err) {
        logger.error("getReviewsByTrip error:", err);
        res.status(500).json({ error: "DB error" });
    }
};

exports.createReview = async (req, res) => {
    // Phase 2I: user_id now comes from the authenticated JWT, not the
    // request body — same impersonation risk as createOperatorReview above.
    const user_id = req.user.user_id;
    const { trip_id, rating, comment, rating_time, rating_clean, rating_service, rating_comfort, tags } = req.body;

    if (!trip_id || !rating) {
        return res.status(400).json({ message: "Thiếu dữ liệu" });
    }

    try {
        if (await reviewRepo.tripReviewExists(user_id, trip_id)) {
            return res.status(400).json({ message: "Bạn đã đánh giá chuyến này rồi" });
        }

        await reviewRepo.createTripReview({
            user_id, trip_id, rating, comment,
            rating_time, rating_clean, rating_service, rating_comfort, tags,
        });

        res.json({ message: "Review created" });

    } catch (err) {
        logger.info(err);
        res.status(500).json({ error: "DB error" });
    }

};
