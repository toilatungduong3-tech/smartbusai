'use strict';
const logger = require('../utils/logger');
/**
 * SmartBusAI — Sprint 4: AI Booking Concierge HTTP endpoint.
 * Public (guest chat, same posture as the public trip search) — no PII is
 * read or returned here, only trip search results already public via
 * GET /api/trips/search.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { handleMessage } = require('../ai/bookingConcierge');

/* POST /api/ai/concierge  { message: string } */
router.post('/', async (req, res) => {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ message: 'Thiếu nội dung tin nhắn' });
    }
    if (message.length > 500) {
        return res.status(422).json({ message: 'Tin nhắn quá dài (tối đa 500 ký tự)' });
    }
    try {
        const result = await handleMessage(db, message);
        res.json(result);
    } catch (err) {
        logger.error('[Concierge] error:', err.message);
        res.status(500).json({ message: 'Lỗi trợ lý AI, vui lòng thử lại' });
    }
});

module.exports = router;
