'use strict';

const express = require('express');
const router  = express.Router();

const complianceController    = require('../controllers/compliance.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const { authLimiter }         = require('../../../shared/middlewares/rateLimiter');
const {
  validateUpdateConsent,
  validateGetConsentHistory,
  validateAddToDnc,
  validateGetDncList,
  validateRequestExport,
  validateUnsubscribe,
} = require('../validators/compliance.validator');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES — no authentication required
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/compliance/unsubscribe/:customerId?token=xxx
 * SEC-02 FIX: authLimiter added — prevents mass-unsubscribe via ObjectId enumeration
 * SEC-06 FIX: validateUnsubscribe applied — validates token param and customerId format
 */
router.get(
  '/unsubscribe/:customerId',
  authLimiter,
  validateUnsubscribe,
  complianceController.processUnsubscribe
);

// ─────────────────────────────────────────────────────────────────────────────
// ALL ROUTES BELOW REQUIRE AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────────────

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  '/customers/:customerId/consent',
  complianceController.getConsentStatus
);

router.patch(
  '/customers/:customerId/consent',
  restrictTo('owner', 'admin', 'agent'),
  validateUpdateConsent,
  complianceController.updateConsent
);

router.get(
  '/customers/:customerId/consent/history',
  validateGetConsentHistory,
  complianceController.getConsentHistory
);

router.get(
  '/customers/:customerId/consent/token',
  restrictTo('owner', 'admin', 'agent'),
  complianceController.getUnsubscribeToken
);

// ─────────────────────────────────────────────────────────────────────────────
// DNC LIST MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

router.route('/dnc')
  .get(validateGetDncList,   complianceController.getDncList)
  .post(
    restrictTo('owner', 'admin', 'agent'),
    validateAddToDnc,
    complianceController.addToDnc
  );

router.get(
  '/dnc/:customerId/check',
  complianceController.checkDncStatus
);

router.delete(
  '/dnc/:customerId',
  restrictTo('owner', 'admin'),
  complianceController.removeFromDnc
);

// ─────────────────────────────────────────────────────────────────────────────
// GDPR DATA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

router.post('/gdpr/export',              validateRequestExport, complianceController.requestDataExport);
router.get('/gdpr/exports',              complianceController.getExportRequests);
router.get('/gdpr/exports/:id',          complianceController.getExportStatus);
router.get('/gdpr/exports/:id/download', complianceController.downloadExport);

module.exports = router;