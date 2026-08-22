'use strict';
const logger = require('./logger');
/**
 * Centralized error-handling primitives (Phase 1 hardening).
 *
 * RULE: an error's `.message` must NEVER reach an HTTP client unless it was
 * deliberately thrown as an AppError carrying a message written to be
 * user-facing (e.g. "Không đủ điểm để đổi"). Any other error — a real DB
 * failure, a bug, a third-party library's internal exception — must only
 * ever produce a fixed, generic response to the client. The real detail
 * still goes to server-side logs (console.error) for debugging, just never
 * into the response body. This is what "centralized" means here: one
 * shared decision point for "is this message safe to show the user",
 * instead of every controller's catch block re-deciding it ad hoc (which is
 * how server/controllers/supportController.js ended up echoing raw
 * err.message — including raw SQL error text — straight to the client).
 */

class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.isAppError = true;
    }
}

/**
 * Log the real error server-side and send a safe response.
 * - If `err` is an AppError (a deliberate, user-facing business error,
 *   e.g. "insufficient loyalty points"), its own statusCode/message are
 *   used — this is the ONLY case where err.message reaches the client.
 * - Otherwise (DB errors, bugs, anything unexpected) only the caller's
 *   fixed fallbackStatus/fallbackMessage are ever sent.
 */
function sendError(res, err, context, fallbackStatus = 500, fallbackMessage = 'Đã xảy ra lỗi, vui lòng thử lại sau') {
    logger.error(`[${context}]`, err);
    if (err && err.isAppError) {
        return res.status(err.statusCode).json({ message: err.message });
    }
    return res.status(fallbackStatus).json({ message: fallbackMessage });
}

module.exports = { AppError, sendError };
