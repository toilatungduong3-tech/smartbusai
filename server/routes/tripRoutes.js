const express = require("express");
const router = express.Router();
const tripController = require("../controllers/tripController");

/* GET all trips  — /api/trips?bus_id=X */
router.get("/",               tripController.getTrips);

/* GET running    — /api/trips/running  (phải trước /:id) */
router.get("/running",        tripController.getRunningTrips);

/* GET search     — /api/trips/search?origin=...&destination=...&date=... */
router.get("/search",         tripController.searchTrips);

/* GET dynamic price — /api/trips/dynamic-price/:id */
router.get("/dynamic-price/:id", tripController.getDynamicPriceForTrip);

/* POST create    — /api/trips */
router.post("/",              tripController.createTrip);

/* PUT status     — /api/trips/status/:id  (specific before :id) */
router.put("/status/:id",     tripController.updateTripStatus);

/* PUT price      — /api/trips/price/:id  (specific before :id) */
router.put("/price/:id",      tripController.updateTripPrice);

/* GET by id      — /api/trips/:id */
router.get("/:id",            tripController.getTripById);

/* PUT update     — /api/trips/:id */
router.put("/:id",            tripController.updateTrip);

/* DELETE         — /api/trips/:id */
router.delete("/:id",         tripController.deleteTrip);

module.exports = router;
