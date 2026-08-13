const express  = require("express");
const router   = express.Router();
const ctrl     = require("../controllers/tripController");
const { authenticate, requireAdmin, requireAdminOrOperator } = require("../middleware/authMiddleware");

/* PUBLIC — hành khách xem chuyến, tìm kiếm */
router.get("/",                  ctrl.getTrips);
router.get("/running",           ctrl.getRunningTrips);
router.get("/search",            ctrl.searchTrips);
router.get("/dynamic-price/:id", ctrl.getDynamicPriceForTrip);
router.get("/:id",               ctrl.getTripById);

/* ADMIN OR OPERATOR — tạo, sửa, hủy chuyến */
router.post("/",              authenticate, requireAdminOrOperator, ctrl.createTrip);
router.put("/status/:id",     authenticate, requireAdminOrOperator, ctrl.updateTripStatus);
router.put("/price/:id",      authenticate, requireAdminOrOperator, ctrl.updateTripPrice);
router.put("/:id",            authenticate, requireAdminOrOperator, ctrl.updateTrip);

/* ADMIN only — xóa (soft) */
router.delete("/:id",         authenticate, requireAdmin, ctrl.deleteTrip);

module.exports = router;
