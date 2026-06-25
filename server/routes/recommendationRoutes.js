'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/passengerAIController');

// GET /api/recommendations/me?userId=X
router.get('/me', ctrl.getMyRecommendations);

module.exports = router;
