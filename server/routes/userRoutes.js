console.log("✅ userRoutes loaded");

const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

/* ================= GET ALL USERS ================= */
router.get("/", userController.getUsers);

/* ================= GET USER BY ID ================= */
router.get("/:id", userController.getUserById);

/* ================= CREATE USER ================= */
router.post("/", userController.createUser);

/* ================= UPDATE USER ================= */
router.put("/:id", userController.updateUser);

/* ================= DELETE USER ================= */
router.delete("/:id", userController.deleteUser);

/* ================= LOYALTY POINTS ================= */
router.get("/:id/loyalty", userController.getUserLoyalty);
router.post("/:id/redeem-points", userController.redeemPoints);

module.exports = router;