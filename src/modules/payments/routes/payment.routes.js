'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../../../shared/middlewares/auth.middleware');

router.get('/', protect, (req, res) => {
  res.json({ status: 'success', message: 'Payment module - coming soon' });
});

module.exports = router;
