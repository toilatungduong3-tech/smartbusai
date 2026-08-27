'use strict';
/**
 * Server-side Anthropic API wrapper — the ONLY place in this codebase that
 * should hold ANTHROPIC_API_KEY. Replaces the previous pattern (found in
 * passenger/index.html's aiSend() and admin/support.html's runAI()) of
 * calling https://api.anthropic.com/v1/messages directly from the browser
 * with no key at all, which meant that call always 401'd in production and
 * silently fell back to a rule-based local responder. Frontend callers now
 * hit our own POST /api/ai/chat instead; this module is what that route
 * calls, so the real key never reaches client-served JavaScript.
 */
const logger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_VERSION = '2023-06-01';

async function chatCompletion(prompt, { maxTokens = 600 } = {}) {
    if (!ANTHROPIC_API_KEY) {
        const err = new Error('ANTHROPIC_API_KEY chưa được cấu hình trên server');
        err.code = 'AI_NOT_CONFIGURED';
        throw err;
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: maxTokens,
            // Cap prompt length server-side — this endpoint is reachable by
            // guests (optionalAuth) via aiLimiter, not just admins.
            messages: [{ role: 'user', content: String(prompt).slice(0, 6000) }],
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error('[AnthropicService] upstream error', res.status, text);
        const err = new Error('Anthropic API error');
        err.code = 'AI_UPSTREAM_ERROR';
        throw err;
    }

    const data = await res.json();
    return data?.content?.[0]?.text || '';
}

module.exports = { chatCompletion, isConfigured: () => !!ANTHROPIC_API_KEY };
