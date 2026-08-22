/**
 * SmartBusAI — Operator tenant-scoping middleware
 *
 * Phase 2I: operator identity is derived from the authenticated user_id
 * (from the verified JWT) via the explicit users.operator_id ->
 * bus_operator.operator_id FK (migrate_v8.sql) — never from req.body,
 * req.query, req.params, or email matching. This replaces the earlier
 * email-match scheme (bus_operator.email = req.user.email), which silently
 * failed whenever a user's own email legitimately differed from their
 * company's contact email (confirmed against real seed data: two
 * legitimate operator accounts never matched under that scheme) and had
 * no database-level integrity guarantee at all. The lookup is re-run
 * per-request rather than trusted from a JWT claim, specifically so that
 * an admin correcting a user's operator_id takes effect immediately
 * without waiting for the user's token to expire/refresh.
 *
 * Sets req.operatorId:
 *   - ADMIN                      -> null (bypasses ownership checks entirely)
 *   - OPERATOR (operator_id set, bus_operator.status='ACTIVE')
 *                                 -> that operator_id (existence of the
 *     referenced bus_operator row is guaranteed by the FK)
 *   - OPERATOR (operator_id NULL, OR the linked bus_operator is SUSPENDED)
 *                                 -> undefined (fail closed — callers must
 *     treat this as "owns nothing", not "owns everything", never fall back
 *     to global data)
 *
 * Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: admin "suspending" a bus
 * company (bus_operator.status='SUSPENDED', the only disable action exposed
 * in admin/operators.html) previously had NO effect here — this lookup only
 * ever checked users.operator_id existence, never the operator's own
 * status, so every OPERATOR user linked to a suspended company kept full
 * create/update/delete access to that company's buses/trips/seats via every
 * ownsOperator() check in the codebase. Failing closed here (same as the
 * unlinked-account case) automatically closes that gap everywhere
 * ownsOperator() is used, with no per-controller changes required.
 */
const db = require("../config/db");
const logger = require('../utils/logger');

const attachOperatorId = async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Chưa xác thực" });
    if (req.user.role === "ADMIN") { req.operatorId = null; return next(); }
    if (req.user.role !== "OPERATOR") { req.operatorId = undefined; return next(); }
    try {
        const [[row]] = await db.query(
            `SELECT u.operator_id, bo.status AS operator_status
             FROM users u
             LEFT JOIN bus_operator bo ON bo.operator_id = u.operator_id
             WHERE u.user_id = ? LIMIT 1`,
            [req.user.user_id]
        );
        const linked = row && row.operator_id != null;
        const active = linked && row.operator_status === "ACTIVE";
        req.operatorId = active ? row.operator_id : undefined;
        req.operatorSuspended = linked && !active;
        next();
    } catch (err) {
        logger.error("[operatorScope] lookup error:", err.message);
        res.status(500).json({ message: "Lỗi xác định nhà xe" });
    }
};

/* True if the caller (ADMIN, or the OPERATOR who owns operatorId) may act
   on a resource belonging to `targetOperatorId`. ADMIN always passes.
   An OPERATOR with no resolved operatorId (req.operatorId undefined) owns
   nothing and always fails ownership checks. */
function ownsOperator(req, targetOperatorId) {
    if (req.user?.role === "ADMIN") return true;
    if (req.operatorId == null) return false;
    return Number(req.operatorId) === Number(targetOperatorId);
}

module.exports = { attachOperatorId, ownsOperator };
