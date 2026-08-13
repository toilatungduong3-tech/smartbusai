const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/routeStopController');
const { authenticate, requireAdmin, requireAdminOrOperator } = require('../middleware/authMiddleware');

/* PUBLIC — hành khách và tìm điểm gần nhất */
router.get('/',        ctrl.getStopsByRoute);
router.get('/nearest', ctrl.getNearestStops);

/* ADMIN OR OPERATOR — tạo và sửa điểm dừng */
router.post('/',     authenticate, requireAdminOrOperator, ctrl.createStop);
router.put('/:id',   authenticate, requireAdminOrOperator, ctrl.updateStop);

/* ADMIN only — xóa */
router.delete('/:id', authenticate, requireAdmin, ctrl.deleteStop);

module.exports = router;
