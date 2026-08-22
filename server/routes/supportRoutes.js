const express = require("express");
const router  = express.Router();
const supportController = require("../controllers/supportController");
const { authenticate, requireAdmin } = require("../middleware/authMiddleware");

/*
  Base mount trong server.js phải là:
    app.use("/api/support", supportRoutes);

  Khi đó các endpoint đầy đủ sẽ là:
  ┌────────────────────────────────────────────────────────────────┐
  │ POST   /api/support/requests          ← hotro.html gửi yêu cầu│
  │ GET    /api/support/user/:user_id     ← hotro.html xem my reqs │
  │ GET    /api/support/requests          ← support.html admin      │
  │ PUT    /api/support/requests/:id      ← support.html reply      │
  └────────────────────────────────────────────────────────────────┘
*/

// ── Người dùng (passenger) ──────────────────────────────
// Phase 2I: all four routes below previously had zero auth. createRequest
// trusted a client-supplied user_id (impersonation); getUserRequests trusted
// the :user_id URL param with no ownership check (IDOR — reads another
// user's request titles/content/admin replies); getAllRequests/replyRequest
// were reachable by anyone with no admin check at all. hotro.html and
// admin/support.html both already load js/api.js, so both were updated to
// send the Bearer token — zero regression, closes all four gaps.
router.post("/requests", authenticate, supportController.createRequest);

// Xem danh sách yêu cầu của chính mình (hoặc của user khác nếu là admin/operator)
router.get("/user/:user_id", authenticate, supportController.getUserRequests);

// ── Admin ───────────────────────────────────────────────
// Xem tất cả yêu cầu (dùng GET /requests thay vì /admin/all
// để khớp với support.html đang gọi /api/support/requests)
router.get("/requests", authenticate, requireAdmin, supportController.getAllRequests);

// Admin phản hồi / cập nhật trạng thái
router.put("/requests/:id", authenticate, requireAdmin, supportController.replyRequest);

module.exports = router;