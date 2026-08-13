const express  = require('express');
const router   = express.Router();
const db       = require('../config/db');

/* PUBLIC — gợi ý địa điểm (dùng cho autocomplete) */
router.get('/suggestions', async (req, res) => {
    const q     = (req.query.q || '').trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
    if (!q) return res.json([]);
    try {
        const [rows] = await db.query(
            `SELECT location_id, name, type, province, latitude, longitude
             FROM location
             WHERE status='ACTIVE' AND name LIKE ?
             ORDER BY name ASC LIMIT ?`,
            [`%${q}%`, limit]
        );
        res.json(rows);
    } catch {
        res.json([]);
    }
});

/* PUBLIC — danh sách theo tỉnh/loại */
router.get('/', async (req, res) => {
    const type   = req.query.type   || '';
    const status = req.query.status || 'ACTIVE';
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    try {
        const wheres = ['status=?'];
        const params = [status];
        if (type) { wheres.push('type=?'); params.push(type); }
        const [rows] = await db.query(
            `SELECT * FROM location WHERE ${wheres.join(' AND ')} ORDER BY name ASC LIMIT ?`,
            [...params, limit]
        );
        res.json(rows);
    } catch {
        res.json([]);
    }
});

module.exports = router;
