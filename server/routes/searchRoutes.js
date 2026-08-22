const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/searchController');
const { optionalAuth, authenticate, requireAdmin } = require('../middleware/authMiddleware');

// Transit search (main feature)
router.post('/transit',          optionalAuth, ctrl.transitSearch);

// Log search from GET endpoint
router.get('/log-search',        optionalAuth, ctrl.logSearchGet);

// Phase 2I: previously reachable by anyone despite being admin-only by
// design (aggregate search-log analytics). admin.html's req() helper
// already attaches the Bearer token for every call — zero regression.
router.get('/analytics',         authenticate, requireAdmin, ctrl.getSearchAnalytics);

// Popular transfer points
router.get('/popular-transfers', ctrl.getPopularTransfers);

// City autocomplete suggestions
router.get('/suggestions',       ctrl.getSuggestions);

module.exports = router;
