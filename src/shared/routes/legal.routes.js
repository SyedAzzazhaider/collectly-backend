'use strict';

const express   = require('express');
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');

const TOS_VERSION     = '1.0';
const PRIVACY_VERSION = '1.0';

// ── Rate limiter for public legal endpoints ───────────────────────────────────
// Prevents DoS and rate limit exhaustion on shared IP from authenticated users

const legalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { status: 'fail', message: 'Too many requests. Please try again later.' },
  skip:            (req) => process.env.NODE_ENV === 'test',
});

/**
 * GET /api/v1/legal/tos
 * Returns current Terms of Service version info
 */
router.get('/tos', legalLimiter, (req, res) => {
  res.status(200).json({
    status:  'success',
    message: 'Terms of Service retrieved.',
    data: {
      version:       TOS_VERSION,
      effectiveDate: '2024-01-01',
      url:           `${process.env.FRONTEND_URL || ''}/legal/terms`,
    },
  });
});

/**
 * GET /api/v1/legal/privacy
 * Returns current Privacy Policy version info
 */
router.get('/privacy', legalLimiter, (req, res) => {
  res.status(200).json({
    status:  'success',
    message: 'Privacy Policy retrieved.',
    data: {
      version:       PRIVACY_VERSION,
      effectiveDate: '2024-01-01',
      url:           `${process.env.FRONTEND_URL || ''}/legal/privacy`,
    },
  });
});

module.exports = router;