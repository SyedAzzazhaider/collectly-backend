'use strict';

const express    = require('express');
const router     = express.Router();

const billingController = require('../controllers/billing.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateSubscribe,
  validateChangePlan,
  validateIncrementUsage,
  validateWebhookSignature,
} = require('../validators/billing.validator');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

router.get('/plans', billingController.getPlans);

// ─────────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK — raw body required, before express.json middleware
// ─────────────────────────────────────────────────────────────────────────────

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  validateWebhookSignature,
  billingController.stripeWebhook
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — must be defined before dynamic segments
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/admin',
  protect,
  restrictTo('admin'),
  billingController.getAllBillingAdmin
);

// ─────────────────────────────────────────────────────────────────────────────
// STATIC NAMED ROUTES — must be defined before any dynamic :param routes
// ─────────────────────────────────────────────────────────────────────────────

router.get('/usage',    protect, billingController.getUsage);
router.get('/invoices', protect, billingController.getInvoiceHistory);

router.post(
  '/subscribe',
  protect,
  validateSubscribe,
  billingController.subscribe
);

router.patch(
  '/plan',
  protect,
  validateChangePlan,
  billingController.changePlan
);

router.delete('/cancel',     protect, billingController.cancelSubscription);
router.post('/reactivate',   protect, billingController.reactivateSubscription);

router.post(
  '/usage/increment',
  protect,
  restrictTo('owner', 'admin'),
  validateIncrementUsage,
  billingController.incrementUsage
);

// ─────────────────────────────────────────────────────────────────────────────
// BASE BILLING ROUTE — must be last to avoid swallowing named routes
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', protect, billingController.getBilling);

module.exports = router;
