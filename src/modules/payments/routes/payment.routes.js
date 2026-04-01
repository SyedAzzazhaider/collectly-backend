'use strict';

const express = require('express');
const router = express.Router();
const { protect } = require('../../../shared/middlewares/auth.middleware');
const paymentLinkController = require('../controllers/paymentLink.controller');

// ✅ PUBLIC ROUTES (no auth)
router.get('/links/public/:token', paymentLinkController.getPublicPaymentLink);
router.post('/checkout', paymentLinkController.createCheckoutSession);  // ← ADD THIS

// Protected routes (require authentication)
router.use(protect);

router.post('/links', paymentLinkController.createPaymentLink);
router.get('/links', paymentLinkController.getUserPaymentLinks);
router.delete('/links/:id', paymentLinkController.cancelPaymentLink);

module.exports = router;