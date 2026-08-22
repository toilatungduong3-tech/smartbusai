const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");

// GET /api/stats/public-summary — public, unauthenticated (login-page hero stats)
router.get("/public-summary", statsController.getPublicSummary);

module.exports = router;
