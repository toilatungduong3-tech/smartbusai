const express = require("express");
const router  = express.Router();
const admin   = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

/* Tất cả admin routes yêu cầu xác thực ADMIN */
router.use(authenticate, requireAdmin);

/* ── Overview ── */
router.get("/stats",               admin.getStats);

/* ── Revenue ── */
router.get("/revenue-6months",     admin.getRevenue6Months);
router.get("/revenue-12months",    admin.getRevenue12Months);
router.get("/revenue-by-operator", admin.getRevenueByOperator);
router.get("/revenue-by-bustype",  admin.getRevenueByBusType);

/* ── Bookings ── */
router.get("/bookings-per-day",    admin.getBookingsPerDay);
router.get("/booking-status",      admin.getBookingStatus);

/* ── Routes & Trips ── */
router.get("/top-routes",          admin.getTopRoutes);
router.get("/trip-status",         admin.getTripStatus);
router.get("/recent-trips",        admin.getRecentTrips);

/* ── Users ── */
router.get("/growth-rate",         admin.getGrowthRate);
router.get("/top-users",           admin.getTopActiveUsers);
router.get("/recent-users",        admin.getRecentUsers);
router.get("/user-stats",          admin.getUserStats);

/* ── Operations ── */
router.get("/peak-hours",          admin.getPeakBookingHour);
router.get("/bus-occupancy",       admin.getBusOccupancy);
router.get("/payment-methods",     admin.getPaymentMethods);

/* ── Reviews ── */
router.get("/reviews",             admin.getReviews);

/* ── AI (legacy) ── */
router.get("/ai-top-routes",          admin.getTopAIRecommendations);
router.get("/user-behavior",          admin.getUserBehavior);
router.get("/user-behavior-hours",    admin.getUserBehaviorHours);
router.get("/ai-stats",               admin.getAIStats);

/* ── AI Engine ── */
router.get("/ai/recommendations",     admin.getAIRecommendations);
router.get("/ai/revenue-forecast",    admin.getRevenueForecast);
router.get("/ai/anomalies",           admin.getAnomalyDetection);
router.get("/ai/heatmap",             admin.getBookingHeatmap);
router.get("/ai/price-prediction",    admin.getPricePrediction);
router.get("/ai/trip-demand",         admin.getTripDemandForecast);
router.post("/ai/classify-ticket",    admin.classifySupportTicket);

router.get("/notifications",          admin.getNotifications);

/* ── Bookings management ── */
router.get("/all-bookings",           admin.getAllBookings);
router.put("/bookings/:id/status",    admin.updateBookingStatus);

/* ── Routes management ── */
router.get("/all-routes",             admin.getAllRoutes);
router.post("/routes",                admin.createRoute);
router.put("/routes/:id",             admin.updateRoute);
router.patch("/routes/:id/status",    admin.updateRouteStatus);
router.delete("/routes/:id",          admin.deleteRoute);
router.get("/routes/:id",             admin.getRouteById);

/* ── Locations management ── */
router.get("/locations",              admin.getLocations);
router.post("/locations",             admin.createLocation);
router.put("/locations/:id",          admin.updateLocation);
router.patch("/locations/:id/status", admin.updateLocationStatus);
router.delete("/locations/:id",       admin.deleteLocation);

/* ── Route import ── */
router.post("/routes/import/preview", admin.importRoutesPreview);
router.post("/routes/import/confirm", admin.importRoutesConfirm);

/* ── Demo Mode (Sprint 12) ── */
router.post("/demo/reset",            admin.resetDemoData);

module.exports = router;
