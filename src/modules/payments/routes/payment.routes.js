'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../../../shared/middlewares/auth.middleware');
const paymentLinkController = require('../controllers/paymentLink.controller');

router.use(protect);
router.post('/links', paymentLinkController.createPaymentLink);
router.get('/links', paymentLinkController.getUserPaymentLinks);

module.exports = router;
