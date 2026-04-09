const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/settingsController");

router.get("/",  ctrl.getSettings);
router.post("/", ctrl.saveSettings);

module.exports = router;
