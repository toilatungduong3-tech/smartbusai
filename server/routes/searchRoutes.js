const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/searchController');
const { optionalAuth } = require('../middleware/authMiddleware');

// Transit search (main feature)
router.post('/transit',          optionalAuth, ctrl.transitSearch);

// Log search from GET endpoint
router.get('/log-search',        optionalAuth, ctrl.logSearchGet);

// Analytics for admin
router.get('/analytics',         ctrl.getSearchAnalytics);

// Popular transfer points
router.get('/popular-transfers', ctrl.getPopularTransfers);

// City autocomplete suggestions
router.get('/suggestions',       ctrl.getSuggestions);

module.exports = router;
