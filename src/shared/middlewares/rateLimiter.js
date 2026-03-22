'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ── Global limiter ────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { status: 'fail', message: 'Too many requests, please try again later.' },
  skip:            (req) => process.env.NODE_ENV === 'test',
});

// ── Auth limiter ──────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { status: 'fail', message: 'Too many authentication attempts, please try again later.' },
  skip:            (req) => process.env.NODE_ENV === 'test',
});

// ── Per-user limiter ──────────────────────────────────────────────────────────

const perUserLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             parseInt(process.env.PER_USER_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => {
    if (req.user?.id) return `user_${req.user.id}`;
    return ipKeyGenerator(req);
  },
  message: { status: 'fail', message: 'Rate limit exceeded. Please slow down.' },
  skip:    (req) => process.env.NODE_ENV === 'test',
});

module.exports = { globalLimiter, authLimiter, perUserLimiter };

