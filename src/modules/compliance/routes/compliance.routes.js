'use strict';

const express = require('express');
const router  = express.Router();

const complianceController            = require('../controllers/compliance.controller');
const { protect, restrictTo }         = require('../../../shared/middlewares/auth.middleware');
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
 * Public unsubscribe endpoint — linked from emails
 * No auth required — customer clicks link in email
 */
router.get(
  '/unsubscribe/:customerId',
  complianceController.processUnsubscribe
);

// ─────────────────────────────────────────────────────────────────────────────
// ALL ROUTES BELOW REQUIRE AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────────────

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/compliance/customers/:customerId/consent
 * Get current consent status for a customer
 */
router.get(
  '/customers/:customerId/consent',
  complianceController.getConsentStatus
);

/**
 * PATCH /api/v1/compliance/customers/:customerId/consent
 * Update consent for a customer (grant or revoke)
 */
router.patch(
  '/customers/:customerId/consent',
  restrictTo('owner', 'admin', 'agent'),
  validateUpdateConsent,
  complianceController.updateConsent
);

/**
 * GET /api/v1/compliance/customers/:customerId/consent/history
 * Get full consent audit log for a customer — GDPR compliance
 */
router.get(
  '/customers/:customerId/consent/history',
  validateGetConsentHistory,
  complianceController.getConsentHistory
);

/**
 * GET /api/v1/compliance/customers/:customerId/consent/token
 * Generate an unsubscribe token for a customer (for embedding in emails)
 */
router.get(
  '/customers/:customerId/consent/token',
  restrictTo('owner', 'admin', 'agent'),
  complianceController.getUnsubscribeToken
);

// ─────────────────────────────────────────────────────────────────────────────
// DNC LIST MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET  /api/v1/compliance/dnc — list all DNC entries
 * POST /api/v1/compliance/dnc — add customer to DNC list
 */
router.route('/dnc')
  .get(
    validateGetDncList,
    complianceController.getDncList
  )
  .post(
    restrictTo('owner', 'admin', 'agent'),
    validateAddToDnc,
    complianceController.addToDnc
  );

/**
 * GET /api/v1/compliance/dnc/:customerId/check
 * Check if a specific customer is on the DNC list
 * Must be before /:customerId DELETE to avoid route collision
 */
router.get(
  '/dnc/:customerId/check',
  complianceController.checkDncStatus
);

/**
 * DELETE /api/v1/compliance/dnc/:customerId
 * Remove customer from DNC list (owner/admin only)
 */
router.delete(
  '/dnc/:customerId',
  restrictTo('owner', 'admin'),
  complianceController.removeFromDnc
);

// ─────────────────────────────────────────────────────────────────────────────
// GDPR DATA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/compliance/gdpr/export
 * Request a GDPR data export (Article 20 — Right to Data Portability)
 */
router.post(
  '/gdpr/export',
  validateRequestExport,
  complianceController.requestDataExport
);

/**
 * GET /api/v1/compliance/gdpr/exports
 * List all data export requests for authenticated user
 */
router.get(
  '/gdpr/exports',
  complianceController.getExportRequests
);

/**
 * GET /api/v1/compliance/gdpr/exports/:id
 * Get status of a specific export request
 */
router.get(
  '/gdpr/exports/:id',
  complianceController.getExportStatus
);

/**
 * GET /api/v1/compliance/gdpr/exports/:id/download
 * Download the actual export data
 */
router.get(
  '/gdpr/exports/:id/download',
  complianceController.downloadExport
);

module.exports = router;