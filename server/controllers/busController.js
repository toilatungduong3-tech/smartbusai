const busRepo = require("../repositories/busRepository");
const { ownsOperator } = require("../middleware/operatorScope");
const { buildSeatLayout } = require("../services/seatLayoutService");
const { parsePagination, paginatedResponse } = require("../utils/pagination");
const logger = require('../utils/logger');

/* ============================================
   GET ALL BUSES
============================================ */
/* Sprint 3 — MASTER_COMPLETION_MATRIX.md blocker: this endpoint was fully
   public (no auth) and, even when a caller did pass ?operator_id=, that
   value was trusted directly from the query string — an OPERATOR could
   read any other operator's entire fleet (plate numbers, bus types, seat
   counts) either by omitting the param (gets everyone) or by passing a
   competitor's operator_id directly (client-supplied, never verified).
   Now requires authenticate+requireAdminOrOperator+attachOperatorId (see
   busRoutes.js). An OPERATOR is ALWAYS scoped to their own server-derived
   req.operatorId, regardless of any operator_id they pass — the query
   param is only honored for ADMIN, who may legitimately filter by it. An
   OPERATOR with no active/linked operator (attachOperatorId's fail-closed
   case) gets an empty list, not an error — same "owns nothing" pattern
   already used by operatorController's dashboard endpoints. */
exports.getBuses = async (req, res) => {
    try {
        const params = [];
        let whereClause = "";

        if (req.user.role === "OPERATOR") {
            if (req.operatorId == null) return res.json([]); // unlinked or suspended — owns nothing
            whereClause = " WHERE b.operator_id=?";
            params.push(req.operatorId);
        } else if (req.query.operator_id) {
            whereClause = " WHERE b.operator_id=?";
            params.push(req.query.operator_id);
        }

        /* Sprint 6 — opt-in pagination, see server/utils/pagination.js. */
        const paging = parsePagination(req.query);
        if (!paging) {
            const { rows } = await busRepo.findAll({ whereClause, params, limit: null });
            return res.json(rows);
        }

        const { rows, total } = await busRepo.findAll({
            whereClause, params, limit: paging.limit, offset: paging.offset,
        });
        res.json(paginatedResponse(rows, total, paging));
    } catch (err) {
        logger.error("GET BUSES ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   GET BUS BY ID
============================================ */
exports.getBusById = async (req, res) => {
    try {
        const bus = await busRepo.findById(req.params.id);
        if (!bus) return res.status(404).json({ message: "Bus not found" });
        res.json(bus);
    } catch (err) {
        logger.error("GET BUS BY ID ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   GET SEAT LAYOUT (Sprint 6 — Dynamic Seat Layout Engine)
============================================ */
exports.getBusSeatLayout = async (req, res) => {
    try {
        const bus = await busRepo.findLayoutFields(req.params.id);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });

        let layout;
        if (bus.seat_layout_config) {
            layout = typeof bus.seat_layout_config === 'string' ? JSON.parse(bus.seat_layout_config) : bus.seat_layout_config;
        } else {
            // Legacy bus with no stored config — compute on the fly (not
            // persisted here; UPDATE bus's own path is what saves it).
            layout = buildSeatLayout(bus.bus_type, bus.total_seats);
        }
        res.json(layout);
    } catch (err) {
        logger.error("GET BUS SEAT LAYOUT ERROR:", err);
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   CREATE BUS
============================================ */
exports.createBus = async (req, res) => {
    try {
        const { plate_number, bus_type, total_seats, status, manufacturer, manufacture_year, color, mileage, description } = req.body;
        /* Phase 2I Step 4: an OPERATOR can only ever create a bus for
           themselves — operator_id is derived from the authenticated
           operator's own identity (see operatorScope.js), never trusted
           from the request body. ADMIN may specify any operator_id. */
        let operator_id;
        if (req.user.role === "ADMIN") {
            operator_id = req.body.operator_id;
        } else {
            if (req.operatorId == null) {
                return res.status(403).json({ message: "Tài khoản này chưa liên kết với nhà xe nào" });
            }
            operator_id = req.operatorId;
        }
        if (!operator_id || !plate_number || !bus_type || !total_seats) {
            return res.status(400).json({ message: "Thiếu dữ liệu bắt buộc" });
        }
        /* Sprint 6 — Dynamic Seat Layout Engine: every new bus gets a
           floor/row/column/aisle blueprint auto-generated from its
           bus_type + total_seats (Operator may override afterwards via
           PUT /api/buses/:id/seat-layout). Never blocks bus creation if
           generation fails (e.g. total_seats=0 slipping past validation
           above some other way) — falls back to NULL, same as any bus
           created before this migration. */
        let seatLayoutJson = null;
        try {
            seatLayoutJson = JSON.stringify(buildSeatLayout(bus_type, total_seats));
        } catch (e) { /* non-critical — legacy flat layout used at seat-generation time instead */ }

        const busId = await busRepo.create({
            operator_id, plate_number, bus_type, total_seats, status,
            manufacturer, manufacture_year, color, mileage, description,
            seat_layout_config: seatLayoutJson,
        });
        res.status(201).json({ message: "Tạo xe thành công", bus_id: busId });
    } catch (err) {
        logger.error("CREATE BUS ERROR:", err);
        if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ message: "Biển số xe đã tồn tại" });
        res.status(500).json({ message: "DB error" });
    }
};

/* ============================================
   UPDATE BUS
============================================ */
exports.updateBus = async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body || {};
        const bus = await busRepo.findOwnerAndStructure(id);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền sửa xe của nhà xe khác" });
        }

        const plate_number = body.plate_number, status = body.status, manufacturer = body.manufacturer,
              manufacture_year = body.manufacture_year, color = body.color, mileage = body.mileage,
              description = body.description;
        const bus_type    = ('bus_type' in body)    ? body.bus_type    : bus.bus_type;
        const total_seats = ('total_seats' in body) ? body.total_seats : bus.total_seats;

        /* Sprint 6 — CRUD validation: changing bus_type or total_seats
           after real tickets are sold would silently invalidate the seat
           map every one of those bookings paid for. Only blocks when a
           structural field is actually changing (re-submitting the same
           values, or only touching status/plate/etc., is unaffected). */
        const changingSeatStructure = String(bus_type) !== String(bus.bus_type) || Number(total_seats) !== Number(bus.total_seats);
        if (changingSeatStructure) {
            const activeCount = await busRepo.countActiveBookings(id);
            if (activeCount > 0) {
                return res.status(409).json({
                    message: `Không thể đổi loại xe / số ghế — xe này đang có ${activeCount} vé ở trạng thái đã đặt/chờ thanh toán`
                });
            }
        }

        /* Phase 2I Step 4: reassigning a bus to a different operator_id is
           an ADMIN-only action — an OPERATOR's update never changes it. */
        const operator_id = req.user.role === "ADMIN" && req.body.operator_id !== undefined
            ? req.body.operator_id : bus.operator_id;

        let seatLayoutJson;
        if (changingSeatStructure) {
            try { seatLayoutJson = JSON.stringify(buildSeatLayout(bus_type, total_seats)); }
            catch (e) { seatLayoutJson = null; }
        }

        await busRepo.update(id, {
            operator_id, plate_number, bus_type, total_seats, status,
            manufacturer, manufacture_year, color, mileage, description,
            seat_layout_config: seatLayoutJson,
        }, { includeSeatLayout: changingSeatStructure });
        res.json({ message: "Cập nhật xe thành công", seat_layout_regenerated: !!changingSeatStructure });
    } catch (err) {
        logger.error("UPDATE BUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ============================================
   UPDATE BUS STATUS
============================================ */
exports.updateBusStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const bus = await busRepo.findOwner(id);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền sửa xe của nhà xe khác" });
        }
        await busRepo.updateStatus(id, status);
        res.json({ message: "Cập nhật trạng thái thành công" });
    } catch (err) {
        logger.error("UPDATE BUS STATUS ERROR:", err);
        res.status(500).json({ message: "Update failed" });
    }
};

/* ============================================
   DELETE BUS
============================================ */
exports.deleteBus = async (req, res) => {
    try {
        const { id } = req.params;
        const bus = await busRepo.findOwner(id);
        if (!bus) return res.status(404).json({ message: "Không tìm thấy xe" });
        if (!ownsOperator(req, bus.operator_id)) {
            return res.status(403).json({ message: "Không có quyền xóa xe của nhà xe khác" });
        }
        /* Sprint 6 — CRUD validation: deleting a bus that still has real,
           active bookings would orphan those bookings' seat/trip data.
           Previously this had zero protection at all — any bus, however
           booked, could be hard-deleted. */
        const activeCount = await busRepo.countActiveBookings(id);
        if (activeCount > 0) {
            return res.status(409).json({
                message: `Không thể xóa xe — xe này đang có ${activeCount} vé ở trạng thái đã đặt/chờ thanh toán`
            });
        }
        await busRepo.remove(id);
        res.json({ message: "Xóa xe thành công" });
    } catch (err) {
        logger.error("DELETE BUS ERROR:", err);
        res.status(500).json({ message: "Delete failed" });
    }
};
