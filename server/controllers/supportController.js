const db = require("../config/db");
const { sendError } = require("../utils/errors");

/* ─────────────────────────────────────────
   POST /api/support/requests
   Người dùng gửi yêu cầu hỗ trợ mới
───────────────────────────────────────── */
exports.createRequest = async (req, res) => {
    try {
        // Phase 2I: user_id now comes from the authenticated JWT, not the
        // request body — previously any caller could submit a support
        // request impersonating any other user_id.
        const user_id = req.user.user_id;
        const { booking_id, type, title, content } = req.body;

        // Validate bắt buộc
        if (!type)     return res.status(400).json({ message: "type là bắt buộc" });
        if (!title)    return res.status(400).json({ message: "title là bắt buộc" });
        if (!content)  return res.status(400).json({ message: "content là bắt buộc" });

        // Normalize ENUM — ERD: GENERAL,BOOKING,PAYMENT,REFUND,TECHNICAL,COMPLAINT,OTHER
        const VALID_TYPES = ["GENERAL","BOOKING","PAYMENT","REFUND","TECHNICAL","COMPLAINT","OTHER"];
        const supportType = String(type).toUpperCase();
        if (!VALID_TYPES.includes(supportType)) {
            return res.status(400).json({ message: `type không hợp lệ: ${type}` });
        }

        // booking_id: chỉ lấy số nguyên, null nếu trống/không phải số
        const bkId = booking_id ? (parseInt(booking_id) || null) : null;

        const [result] = await db.query(
            `INSERT INTO support_request
             (user_id, booking_id, type, title, content, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'PENDING', NOW())`,
            [user_id, bkId, supportType, title, content]
        );

        res.status(201).json({
            success: true,
            request_id: result.insertId,
            message: "Đã gửi yêu cầu hỗ trợ thành công"
        });

    } catch (err) {
        sendError(res, err, "createRequest");
    }
};

/* ─────────────────────────────────────────
   GET /api/support/user/:user_id
   Người dùng xem yêu cầu của mình
───────────────────────────────────────── */
exports.getUserRequests = async (req, res) => {
    try {
        const { user_id } = req.params;

        if (!user_id || isNaN(user_id)) {
            return res.status(400).json({ message: "user_id không hợp lệ" });
        }

        // Phase 2I: previously any caller could read any other user's
        // support-request history (titles, content, admin replies — often
        // sensitive/complaint content) just by changing this URL param.
        const isPrivileged = req.user.role === "ADMIN" || req.user.role === "OPERATOR";
        if (!isPrivileged && Number(req.user.user_id) !== Number(user_id)) {
            return res.status(403).json({ message: "Không có quyền truy cập dữ liệu này" });
        }

        const [rows] = await db.query(
            `SELECT
                request_id  AS id,
                user_id,
                booking_id,
                type,
                title,
                content,
                status,
                admin_reply,
                created_at
             FROM support_request
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [user_id]
        );

        // Map type về lowercase cho frontend dùng TYPE_LABELS
        const mapped = rows.map(r => ({
            ...r,
            id: r.id ? `REQ${r.id}` : r.id,
            type: (r.type || "").toLowerCase(),
            status: (r.status || "PENDING").toLowerCase(),
        }));

        res.json(mapped);

    } catch (err) {
        sendError(res, err, "getUserRequests");
    }
};

/* ─────────────────────────────────────────
   GET /api/support/requests  (admin)
   Admin xem tất cả yêu cầu kèm tên user
───────────────────────────────────────── */
exports.getAllRequests = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT
                r.request_id AS id,
                r.user_id,
                r.booking_id,
                r.type,
                r.title,
                r.content,
                r.status,
                r.admin_reply,
                r.created_at,
                u.full_name AS user_name,
                u.email     AS user_email
             FROM support_request r
             LEFT JOIN users u ON r.user_id = u.user_id
             ORDER BY
                CASE WHEN r.status = 'PENDING' THEN 0 ELSE 1 END,
                r.created_at DESC`
        );

        const mapped = rows.map(r => ({
            ...r,
            id: r.id ? `REQ${r.id}` : r.id,
            type: (r.type || "").toLowerCase(),
            status: (r.status || "PENDING").toLowerCase(),
            // urgent: REFUND và COMPLAINT mặc định khẩn
            urgent: ["REFUND","COMPLAINT"].includes(r.type),
        }));

        res.json(mapped);

    } catch (err) {
        sendError(res, err, "getAllRequests");
    }
};

/* ─────────────────────────────────────────
   PUT /api/support/requests/:id  (admin)
   Admin cập nhật trạng thái + phản hồi
───────────────────────────────────────── */
exports.replyRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { admin_reply, status, action } = req.body;

        // Lấy request_id số từ "REQ1001" hoặc "1001"
        const requestId = parseInt(String(id).replace(/\D/g, ""));
        if (!requestId) {
            return res.status(400).json({ message: "id không hợp lệ" });
        }

        const VALID_STATUSES = ["PENDING","PROCESSING","RESOLVED","CLOSED"];
        const newStatus = status ? String(status).toUpperCase() : "PROCESSING";
        if (!VALID_STATUSES.includes(newStatus)) {
            return res.status(400).json({ message: `status không hợp lệ: ${status}` });
        }

        await db.query(
            `UPDATE support_request
             SET admin_reply = ?, status = ?
             WHERE request_id = ?`,
            [admin_reply || null, newStatus, requestId]
        );

        res.json({ success: true, message: "Đã cập nhật yêu cầu" });

    } catch (err) {
        sendError(res, err, "replyRequest");
    }
};