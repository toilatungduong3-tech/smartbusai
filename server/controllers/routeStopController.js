'use strict';

const db = require('../config/db');
const { haversine } = require('../ai/transitRouter');

/* ═══════════════════════════════════════════════════
   GET /api/stops?route_id=X
   Lấy tất cả điểm đón/trả của một tuyến
═══════════════════════════════════════════════════ */
exports.getStopsByRoute = async (req, res) => {
    const { route_id } = req.query;
    if (!route_id) return res.status(400).json({ message: 'Thiếu route_id' });
    try {
        const [rows] = await db.query(`
            SELECT * FROM route_stop
            WHERE route_id = ? AND is_active = 1
            ORDER BY stop_order ASC, stop_id ASC
        `, [route_id]);
        return res.json(rows);
    } catch (err) {
        console.error('[routeStop] getStopsByRoute:', err);
        return res.status(500).json({ message: 'DB error' });
    }
};

/* ═══════════════════════════════════════════════════
   GET /api/stops/nearest?lat=X&lng=Y&route_id=Z&type=PICKUP
   Tìm điểm đón/trả gần nhất theo toạ độ người dùng
   Sắp xếp theo khoảng cách tăng dần (Haversine)
═══════════════════════════════════════════════════ */
exports.getNearestStops = async (req, res) => {
    const { lat, lng, route_id, type } = req.query;
    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    if (isNaN(userLat) || isNaN(userLng)) {
        return res.status(400).json({ message: 'Thiếu hoặc sai toạ độ lat/lng' });
    }

    try {
        let sql, params = [];
        if (route_id) {
            // Khi lọc theo tuyến cụ thể: trả tất cả stops của tuyến đó
            sql = `SELECT * FROM route_stop WHERE is_active = 1 AND lat IS NOT NULL AND lng IS NOT NULL AND route_id = ?`;
            params.push(route_id);
            if (type) { sql += ' AND (stop_type = ? OR stop_type = "BOTH")'; params.push(type); }
            sql += ' ORDER BY stop_order ASC LIMIT 50';
        } else {
            // Không có route_id: deduplicate theo tên bến xe (GROUP BY stop_name)
            // Lấy đại diện mỗi bến xe một lần (min stop_id để nhất quán)
            let typeClause = '';
            if (type) {
                typeClause = ` AND (stop_type = ? OR stop_type = 'BOTH')`;
                params.push(type);
            }
            sql = `
                SELECT rs.stop_name, rs.stop_type, rs.address,
                       AVG(rs.lat) AS lat, AVG(rs.lng) AS lng,
                       MIN(rs.stop_id) AS stop_id, MIN(rs.route_id) AS route_id,
                       MIN(r.origin) AS city
                FROM route_stop rs
                JOIN route r ON r.route_id = rs.route_id
                WHERE rs.is_active = 1 AND rs.lat IS NOT NULL AND rs.lng IS NOT NULL
                ${typeClause}
                GROUP BY rs.stop_name
                LIMIT 300
            `;
        }

        const [stops] = await db.query(sql, params);

        // Tính khoảng cách và sắp xếp tăng dần
        const withDist = stops.map(s => ({
            ...s,
            lat: parseFloat(s.lat),
            lng: parseFloat(s.lng),
            distance_km: Math.round(haversine(userLat, userLng, parseFloat(s.lat), parseFloat(s.lng)) * 10) / 10
        })).sort((a, b) => a.distance_km - b.distance_km);

        return res.json(withDist.slice(0, 10));
    } catch (err) {
        console.error('[routeStop] getNearestStops:', err);
        return res.status(500).json({ message: 'DB error' });
    }
};

/* ═══════════════════════════════════════════════════
   POST /api/stops  (admin/operator tạo điểm dừng)
═══════════════════════════════════════════════════ */
exports.createStop = async (req, res) => {
    const { route_id, stop_name, stop_type, address, lat, lng, stop_order } = req.body;
    if (!route_id || !stop_name) {
        return res.status(400).json({ message: 'Thiếu route_id hoặc stop_name' });
    }
    try {
        const [r] = await db.query(`
            INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [route_id, stop_name, stop_type || 'BOTH', address || null,
            lat || null, lng || null, stop_order || 0]);
        return res.status(201).json({ message: 'Tạo điểm dừng thành công', stop_id: r.insertId });
    } catch (err) {
        console.error('[routeStop] createStop:', err);
        return res.status(500).json({ message: 'DB error' });
    }
};

/* ═══════════════════════════════════════════════════
   PUT /api/stops/:id
═══════════════════════════════════════════════════ */
exports.updateStop = async (req, res) => {
    const { id } = req.params;
    const { stop_name, stop_type, address, lat, lng, stop_order, is_active } = req.body;
    try {
        await db.query(`
            UPDATE route_stop SET stop_name=?, stop_type=?, address=?, lat=?, lng=?, stop_order=?, is_active=?
            WHERE stop_id=?
        `, [stop_name, stop_type, address, lat, lng, stop_order, is_active ?? 1, id]);
        return res.json({ message: 'Cập nhật thành công' });
    } catch (err) {
        console.error('[routeStop] updateStop:', err);
        return res.status(500).json({ message: 'DB error' });
    }
};

/* ═══════════════════════════════════════════════════
   DELETE /api/stops/:id
═══════════════════════════════════════════════════ */
exports.deleteStop = async (req, res) => {
    try {
        await db.query('UPDATE route_stop SET is_active=0 WHERE stop_id=?', [req.params.id]);
        return res.json({ message: 'Đã xoá điểm dừng' });
    } catch (err) {
        return res.status(500).json({ message: 'DB error' });
    }
};
