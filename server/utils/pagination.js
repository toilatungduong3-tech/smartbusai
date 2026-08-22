'use strict';
/**
 * SmartBusAI — Sprint 6: opt-in pagination helper.
 *
 * GET /api/trips, /api/bookings (admin/operator), and /api/buses were all
 * genuinely unbounded — flagged as a known gap since Sprint 3/5's "Not
 * claimed" sections. A blanket always-on default limit=20 was considered
 * and rejected: a real inventory of every frontend call site
 * (public/pages/**) found at least 8 call sites that need the FULL
 * dataset to keep working correctly — the passenger homepage's entire
 * client-side search+chatbot (public/pages/passenger/index.html), admin
 * DB backup/export (settings.html), and cross-operator aggregate scoring
 * (admin/operators.html) among them. Silently truncating those to 20 rows
 * would corrupt search results and platform-wide stats, not just make a
 * list shorter.
 *
 * So: pagination is available and capped (limit defaults to 20, max 100)
 * whenever a caller explicitly asks for it via ?page= or ?limit= — three
 * admin/operator table UIs that already had their own client-side pager
 * (operator/trips.html, operator/bookings.html, operator/vehicles.html)
 * were converted to use it for real. Every other existing caller is
 * unaffected — omitting both params preserves the exact prior behavior
 * (a raw, unbounded array), so nothing that currently depends on getting
 * everything silently breaks.
 */

function parsePagination(query) {
    if (!query || (query.page === undefined && query.limit === undefined)) return null;

    let page = parseInt(query.page, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;

    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);

    return { page, limit, offset: (page - 1) * limit };
}

function paginatedResponse(rows, total, paging) {
    return {
        data: rows,
        pagination: {
            total,
            page: paging.page,
            limit: paging.limit,
            totalPages: Math.max(1, Math.ceil(total / paging.limit)),
        },
    };
}

module.exports = { parsePagination, paginatedResponse };
