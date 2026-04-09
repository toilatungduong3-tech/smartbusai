const express = require("express");
const router = express.Router();
const seatController = require("../controllers/seatController");

/* GET seats by bus    — /api/seats/bus/:busId */
router.get("/bus/:busId",             seatController.getSeatsByBus);

/* GET seats by trip   — /api/seats/trip/:tripId */
router.get("/trip/:tripId",           seatController.getSeatsByTrip);

/* POST generate seats — /api/seats/generate/:tripId */
router.post("/generate/:tripId",      seatController.generateSeats);

/* POST expand seats   — /api/seats/expand-bus/:busId */
router.post("/expand-bus/:busId",     seatController.expandSeats);

/* POST create seat    — /api/seats */
router.post("/",                      seatController.createSeat);

/* PUT update seat     — /api/seats/:id */
router.put("/:id",                    seatController.updateSeat);

/* DELETE seat         — /api/seats/:id */
router.delete("/:id",                 seatController.deleteSeat);

module.exports = router;
