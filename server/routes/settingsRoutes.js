const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/settingsController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

// GET stays public — booking.html reads global config (e.g. maintenance
// mode) with a plain fetch and no login requirement.
router.get("/",  ctrl.getSettings);

// Phase 2I: previously anyone could overwrite arbitrary settings (including
// maintenance mode) with zero auth. settings.html already posts via
// api.post(), which attaches the Bearer token automatically — zero regression.
router.post("/", authenticate, requireAdmin, ctrl.saveSettings);

module.exports = router;
