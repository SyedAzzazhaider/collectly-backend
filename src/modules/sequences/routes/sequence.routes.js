'use strict';

const express    = require('express');
const router     = express.Router();

const sequenceController = require('../controllers/sequence.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateCreateSequence,
  validateUpdateSequence,
  validateAssignSequence,
} = require('../validators/sequence.validator');

// All routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// STATIC NAMED ROUTES — must be before /:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/sequences/default
 * Get the default sequence for authenticated user
 */
router.get('/default', sequenceController.getDefaultSequence);

/**
 * GET /api/v1/sequences/active-invoices
 * Get all invoices with active sequences
 */
router.get('/active-invoices', sequenceController.getActiveSequenceInvoices);

/**
 * POST /api/v1/sequences/assign
 * Assign a sequence to an invoice
 */
router.post(
  '/assign',
  validateAssignSequence,
  sequenceController.assignSequence
);

/**
 * POST /api/v1/sequences/unassign
 * Remove sequence assignment from an invoice
 */
router.post('/unassign', sequenceController.unassignSequence);

/**
 * GET /api/v1/sequences/invoice/:invoiceId
 * Get sequence assigned to a specific invoice
 */
router.get('/invoice/:invoiceId', sequenceController.getInvoiceSequence);

/**
 * GET /api/v1/sequences/invoice/:invoiceId/progress
 * Get sequence progress for a specific invoice
 */
router.get('/invoice/:invoiceId/progress', sequenceController.getSequenceProgress);

/**
 * GET /api/v1/sequences/invoice/:invoiceId/history
 * Get reminder history for a specific invoice
 */
router.get('/invoice/:invoiceId/history', sequenceController.getReminderHistory);

/**
 * GET /api/v1/sequences/invoice/:invoiceId/preview-reminder
 * Preview reminder message for a specific invoice
 */
router.get('/invoice/:invoiceId/preview-reminder', sequenceController.previewReminder);

/**
 * POST /api/v1/sequences/invoice/:invoiceId/remind
 * Send an immediate reminder for a specific invoice
 */
router.post(
  '/invoice/:invoiceId/remind',
  restrictTo('owner', 'admin', 'agent'),
  sequenceController.sendImmediateReminder
);

/**
 * POST /api/v1/sequences/invoice/:invoiceId/pause
 * Pause the sequence for a specific invoice
 */
router.post('/invoice/:invoiceId/pause', sequenceController.pauseSequence);

/**
 * POST /api/v1/sequences/invoice/:invoiceId/resume
 * Resume the sequence for a specific invoice
 */
router.post('/invoice/:invoiceId/resume', sequenceController.resumeSequence);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — must be before /:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/sequences/admin
 * Admin: list all sequences across all users
 */
router.get('/admin', restrictTo('admin'), sequenceController.getAllSequencesAdmin);

/**
 * POST /api/v1/sequences/batch/run
 * Admin: trigger reminder batch processing
 */
router.post('/batch/run', restrictTo('admin'), sequenceController.runReminderBatch);

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC :id ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET  /api/v1/sequences       — list sequences
 * POST /api/v1/sequences       — create sequence
 */
router.route('/')
  .get(sequenceController.getSequences)
  .post(validateCreateSequence, sequenceController.createSequence);

/**
 * GET    /api/v1/sequences/:id — get single sequence
 * PATCH  /api/v1/sequences/:id — update sequence
 * DELETE /api/v1/sequences/:id — delete sequence
 */
router.route('/:id')
  .get(sequenceController.getSequenceById)
  .patch(validateUpdateSequence, sequenceController.updateSequence)
  .delete(restrictTo('owner', 'admin'), sequenceController.deleteSequence);

/**
 * POST /api/v1/sequences/:id/duplicate
 * Duplicate an existing sequence
 */
router.post('/:id/duplicate', sequenceController.duplicateSequence);

/**
 * POST /api/v1/sequences/:id/preview
 * Preview the schedule for a sequence against an invoice
 */
router.post('/:id/preview', sequenceController.previewSchedule);

/**
 * GET /api/v1/sequences/:id/phases/:phaseNumber
 * Get details of a specific phase in a sequence
 */
router.get('/:id/phases/:phaseNumber', sequenceController.getPhaseDetails);

module.exports = router;