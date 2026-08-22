'use strict';
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/passengerAIController');
const { authenticate, optionalAuth, requireAdminOrOperator } = require('../middleware/authMiddleware');
const { aiLimiter } = require('../middleware/rateLimiter');

// Phase 2I: :userId was previously trusted straight from the URL with zero
// auth — any caller could read any other user's personalized recommendations
// or behavior profile. authenticate + an ownership check in the controller
// (self or ADMIN/OPERATOR) closes this. No existing frontend caller hits
// /recommend/:userId at all; /behavior/:userId is only called from
// profile.html via authFetch, which already sends a Bearer token — zero
// regression risk on either.
router.get('/recommend/:userId',  authenticate, ctrl.getRecommendations);

// Trending routes (anonymous / cold-start) — intentionally public, no PII.
router.get('/trending',           ctrl.getTrending);

router.get('/behavior/:userId',   authenticate, ctrl.getBehaviorProfile);

// Search insight must stay usable for anonymous visitors, so this stays
// optionalAuth rather than authenticate; the controller now derives the
// personalization target from req.user (if present) instead of trusting
// the client-supplied ?userId= query param.
router.get('/search-insight',     optionalAuth, ctrl.getSearchInsight);

/* ═══ Sprint 11 — Real Behavioral AI, Preference Learning & Booking Intent Prediction ═══ */

// Intent scoring works for guests too (a booking session doesn't require
// an account) — optionalAuth so a logged-in user_id is used when present,
// but no token is ever required.
router.post('/predict-intent',       aiLimiter, optionalAuth, ctrl.predictIntent);

// Admin/Operator only — system-wide forecast and cross-user analytics.
router.get('/demand-forecast',       authenticate, requireAdminOrOperator, ctrl.demandForecast);
router.get('/behavioral-analytics',  authenticate, requireAdminOrOperator, ctrl.getBehavioralAnalytics);

module.exports = router;
