'use strict';

const express = require('express');
const router  = express.Router();

const TOS_VERSION     = '1.0';
const PRIVACY_VERSION = '1.0';

/**
 * GET /api/v1/legal/tos
 * Returns current Terms of Service version info
 */
router.get('/tos', (req, res) => {
  res.status(200).json({
    status:  'success',
    message: 'Terms of Service retrieved.',
    data: {
      version:     TOS_VERSION,
      effectiveDate: '2024-01-01',
      url:         `${process.env.FRONTEND_URL || ''}/legal/terms`,
    },
  });
});

/**
 * GET /api/v1/legal/privacy
 * Returns current Privacy Policy version info
 */
router.get('/privacy', (req, res) => {
  res.status(200).json({
    status:  'success',
    message: 'Privacy Policy retrieved.',
    data: {
      version:     PRIVACY_VERSION,
      effectiveDate: '2024-01-01',
      url:         `${process.env.FRONTEND_URL || ''}/legal/privacy`,
    },
  });
});

module.exports = router;

