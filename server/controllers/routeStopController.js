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
    const rawLat = req.query.lat, rawLng = req.query.lng;
    const userLat = parseFloat(rawLat);
    const userLng = parseFloat(rawLng);

    if (rawLat === undefined || rawLng === undefined || isNaN(userLat) || isNaN(userLng)
        || !isFinite(userLat) || !isFinite(userLng)
        || userLat < -90 || userLat > 90 || userLng < -180 || userLng > 180) {
        return res.status(400).json({ message: 'Thiếu hoặc sai toạ độ lat/lng (lat:[-90,90], lng:[-180,180])' });
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

        const limitParam = parseInt(req.query.limit, 10);
        const limit = isNaN(limitParam) ? 10 : Math.min(20, Math.max(1, limitParam));
        return res.json(withDist.slice(0, limit));
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
    if (!route_id || !stop_name?.trim()) {
        return res.status(400).json({ message: 'Thiếu route_id hoặc stop_name' });
    }
    const VALID_TYPE = new Set(['PICKUP', 'DROPOFF', 'BOTH']);
    if (stop_type && !VALID_TYPE.has(stop_type)) {
        return res.status(422).json({ message: `stop_type phải là: ${[...VALID_TYPE].join(', ')}` });
    }
    if (lat !== undefined && lat !== null && lat !== '') {
        const v = Number(lat);
        if (isNaN(v) || !isFinite(v) || v < -90 || v > 90) {
            return res.status(422).json({ message: 'lat phải trong [-90, 90]' });
        }
    }
    if (lng !== undefined && lng !== null && lng !== '') {
        const v = Number(lng);
        if (isNaN(v) || !isFinite(v) || v < -180 || v > 180) {
            return res.status(422).json({ message: 'lng phải trong [-180, 180]' });
        }
    }
    const order = stop_order !== undefined ? parseInt(stop_order, 10) : 0;
    if (isNaN(order) || order < 0) {
        return res.status(422).json({ message: 'stop_order phải là số nguyên không âm' });
    }
    try {
        const [[routeExists]] = await db.query('SELECT route_id FROM route WHERE route_id=?', [route_id]);
        if (!routeExists) return res.status(404).json({ message: 'route_id không tồn tại' });

        const latVal = (lat !== undefined && lat !== null && lat !== '') ? Number(lat) : null;
        const lngVal = (lng !== undefined && lng !== null && lng !== '') ? Number(lng) : null;

        const [r] = await db.query(`
            INSERT INTO route_stop (route_id, stop_name, stop_type, address, lat, lng, stop_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [route_id, stop_name.trim(), stop_type || 'BOTH', address || null, latVal, lngVal, order]);
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

    const VALID_TYPE = new Set(['PICKUP', 'DROPOFF', 'BOTH']);
    if (stop_type && !VALID_TYPE.has(stop_type)) {
        return res.status(422).json({ message: `stop_type phải là: ${[...VALID_TYPE].join(', ')}` });
    }
    if (lat !== undefined && lat !== null && lat !== '') {
        const v = Number(lat);
        if (isNaN(v) || !isFinite(v) || v < -90 || v > 90) {
            return res.status(422).json({ message: 'lat phải trong [-90, 90]' });
        }
    }
    if (lng !== undefined && lng !== null && lng !== '') {
        const v = Number(lng);
        if (isNaN(v) || !isFinite(v) || v < -180 || v > 180) {
            return res.status(422).json({ message: 'lng phải trong [-180, 180]' });
        }
    }
    const latVal = (lat !== undefined && lat !== null && lat !== '') ? Number(lat) : null;
    const lngVal = (lng !== undefined && lng !== null && lng !== '') ? Number(lng) : null;

    try {
        await db.query(`
            UPDATE route_stop SET stop_name=?, stop_type=?, address=?, lat=?, lng=?, stop_order=?, is_active=?
            WHERE stop_id=?
        `, [stop_name, stop_type, address, latVal, lngVal, stop_order ?? 0, is_active ?? 1, id]);
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
