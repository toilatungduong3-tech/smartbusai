const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/routeStopController');

router.get('/',          ctrl.getStopsByRoute);
router.get('/nearest',   ctrl.getNearestStops);
router.post('/',         ctrl.createStop);
router.put('/:id',       ctrl.updateStop);
router.delete('/:id',    ctrl.deleteStop);

module.exports = router;
