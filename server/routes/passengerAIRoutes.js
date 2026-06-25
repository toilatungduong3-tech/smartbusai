'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/passengerAIController');

// Personalized recommendations (logged-in user)
router.get('/recommend/:userId',  ctrl.getRecommendations);

// Trending routes (anonymous / cold-start)
router.get('/trending',           ctrl.getTrending);

// Behavior profile
router.get('/behavior/:userId',   ctrl.getBehaviorProfile);

// Real-time search insight
router.get('/search-insight',     ctrl.getSearchInsight);

module.exports = router;
