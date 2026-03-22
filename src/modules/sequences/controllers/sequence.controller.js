'use strict';

const sequenceService      = require('../services/sequence.service');
const schedulerService     = require('../services/scheduler.service');
const reminderEngineService = require('../services/reminderEngine.service');
const AppError             = require('../../../shared/errors/AppError');

const sendSuccess = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ status: 'success', message, data });

const parsePageParams = (query) => {
  const rawPage  = parseInt(query.page,  10);
  const rawLimit = parseInt(query.limit, 10);
  if (query.page  !== undefined && (!Number.isInteger(rawPage)  || rawPage  < 1)) return null;
  if (query.limit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) return null;
  return {
    page:  query.page  !== undefined ? rawPage  : 1,
    limit: query.limit !== undefined ? rawLimit : 20,
  };
};

// ── POST /sequences ───────────────────────────────────────────────────────────

const createSequence = async (req, res, next) => {
  try {
    const sequence = await sequenceService.createSequence(req.user.id, req.body);
    sendSuccess(res, 201, 'Sequence created successfully.', { sequence });
  } catch (err) { next(err); }
};

// ── GET /sequences ────────────────────────────────────────────────────────────

const getSequences = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await sequenceService.getSequences(req.user.id, {
      page:     pagination.page,
      limit:    pagination.limit,
      isActive: req.query.isActive ?? null,
      search:   req.query.search   || null,
    });
    sendSuccess(res, 200, 'Sequences retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/default ────────────────────────────────────────────────────

const getDefaultSequence = async (req, res, next) => {
  try {
    const sequence = await sequenceService.getDefaultSequence(req.user.id);
    if (!sequence) {
      return sendSuccess(res, 200, 'No default sequence set.', { sequence: null });
    }
    sendSuccess(res, 200, 'Default sequence retrieved.', { sequence });
  } catch (err) { next(err); }
};

// ── GET /sequences/:id ────────────────────────────────────────────────────────

const getSequenceById = async (req, res, next) => {
  try {
    const sequence = await sequenceService.getSequenceById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Sequence retrieved.', { sequence });
  } catch (err) { next(err); }
};

// ── PATCH /sequences/:id ──────────────────────────────────────────────────────

const updateSequence = async (req, res, next) => {
  try {
    const sequence = await sequenceService.updateSequence(req.user.id, req.params.id, req.body);
    sendSuccess(res, 200, 'Sequence updated successfully.', { sequence });
  } catch (err) { next(err); }
};

// ── DELETE /sequences/:id ─────────────────────────────────────────────────────

const deleteSequence = async (req, res, next) => {
  try {
    const result = await sequenceService.deleteSequence(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Sequence deleted successfully.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/:id/duplicate ────────────────────────────────────────────

const duplicateSequence = async (req, res, next) => {
  try {
    const sequence = await sequenceService.duplicateSequence(req.user.id, req.params.id);
    sendSuccess(res, 201, 'Sequence duplicated successfully.', { sequence });
  } catch (err) { next(err); }
};

// ── GET /sequences/:id/phases/:phaseNumber ────────────────────────────────────

const getPhaseDetails = async (req, res, next) => {
  try {
    const { phaseNumber } = req.params;
    const n = parseInt(phaseNumber, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return next(new AppError('Phase number must be between 1 and 5.', 400, 'INVALID_PHASE_NUMBER'));
    }
    const result = await sequenceService.getPhaseDetails(req.user.id, req.params.id, n);
    sendSuccess(res, 200, 'Phase details retrieved.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/assign ────────────────────────────────────────────────────

const assignSequence = async (req, res, next) => {
  try {
    const { sequenceId, invoiceId } = req.body;
    const result = await schedulerService.initializeSequenceOnInvoice(
      invoiceId,
      sequenceId,
      req.user.id
    );
    sendSuccess(res, 200, 'Sequence assigned to invoice successfully.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/unassign ──────────────────────────────────────────────────

const unassignSequence = async (req, res, next) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) {
      return next(new AppError('Invoice ID is required.', 400, 'MISSING_INVOICE_ID'));
    }
    const result = await sequenceService.unassignSequenceFromInvoice(req.user.id, invoiceId);
    sendSuccess(res, 200, 'Sequence unassigned from invoice.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/invoice/:invoiceId ─────────────────────────────────────────

const getInvoiceSequence = async (req, res, next) => {
  try {
    const result = await sequenceService.getInvoiceSequence(req.user.id, req.params.invoiceId);
    sendSuccess(res, 200, 'Invoice sequence retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/invoice/:invoiceId/progress ────────────────────────────────

const getSequenceProgress = async (req, res, next) => {
  try {
    const result = await schedulerService.getSequenceProgress(req.user.id, req.params.invoiceId);
    sendSuccess(res, 200, 'Sequence progress retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/invoice/:invoiceId/history ─────────────────────────────────

const getReminderHistory = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await schedulerService.getReminderHistory(
      req.user.id,
      req.params.invoiceId,
      pagination
    );
    sendSuccess(res, 200, 'Reminder history retrieved.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/invoice/:invoiceId/pause ──────────────────────────────────

const pauseSequence = async (req, res, next) => {
  try {
    const invoice = await schedulerService.pauseSequence(req.user.id, req.params.invoiceId);
    sendSuccess(res, 200, 'Sequence paused for invoice.', { invoice });
  } catch (err) { next(err); }
};

// ── POST /sequences/invoice/:invoiceId/resume ─────────────────────────────────

const resumeSequence = async (req, res, next) => {
  try {
    const invoice = await schedulerService.resumeSequence(req.user.id, req.params.invoiceId);
    sendSuccess(res, 200, 'Sequence resumed for invoice.', { invoice });
  } catch (err) { next(err); }
};

// ── POST /sequences/:id/preview ───────────────────────────────────────────────

const previewSchedule = async (req, res, next) => {
  try {
    const { invoiceId } = req.body;
    if (!invoiceId) {
      return next(new AppError('Invoice ID is required for preview.', 400, 'MISSING_INVOICE_ID'));
    }
    const result = await sequenceService.previewSequenceSchedule(
      req.user.id,
      req.params.id,
      invoiceId
    );
    sendSuccess(res, 200, 'Sequence schedule preview generated.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/invoice/:invoiceId/remind ─────────────────────────────────

const sendImmediateReminder = async (req, res, next) => {
  try {
    const result = await reminderEngineService.sendImmediateReminder(
      req.user.id,
      req.params.invoiceId,
      {
        channels:   req.body.channels   || null,
        message:    req.body.message    || null,
        phaseType:  req.body.phaseType  || 'first-overdue',
      }
    );
    sendSuccess(res, 200, 'Immediate reminder dispatched.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/invoice/:invoiceId/preview-reminder ────────────────────────

const previewReminder = async (req, res, next) => {
  try {
    const phaseNumber = parseInt(req.query.phase, 10) || 1;
    const result = await reminderEngineService.previewReminder(
      req.user.id,
      req.params.invoiceId,
      phaseNumber
    );
    sendSuccess(res, 200, 'Reminder preview generated.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/active-invoices ────────────────────────────────────────────

const getActiveSequenceInvoices = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await schedulerService.getInvoicesWithActiveSequences(req.user.id, {
      page:   pagination.page,
      limit:  pagination.limit,
      paused: req.query.paused || null,
    });
    sendSuccess(res, 200, 'Active sequence invoices retrieved.', result);
  } catch (err) { next(err); }
};

// ── POST /sequences/batch/run (admin only) ────────────────────────────────────

const runReminderBatch = async (req, res, next) => {
  try {
    const batchSize = parseInt(req.body.batchSize, 10) || 50;
    if (batchSize < 1 || batchSize > 500) {
      return next(new AppError('Batch size must be between 1 and 500.', 400, 'INVALID_BATCH_SIZE'));
    }
    const result = await reminderEngineService.runReminderBatch(batchSize);
    sendSuccess(res, 200, 'Reminder batch completed.', result);
  } catch (err) { next(err); }
};

// ── GET /sequences/admin (admin only) ────────────────────────────────────────

const getAllSequencesAdmin = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await sequenceService.getAllSequencesAdmin(pagination);
    sendSuccess(res, 200, 'All sequences retrieved.', result);
  } catch (err) { next(err); }
};

module.exports = {
  createSequence,
  getSequences,
  getDefaultSequence,
  getSequenceById,
  updateSequence,
  deleteSequence,
  duplicateSequence,
  getPhaseDetails,
  assignSequence,
  unassignSequence,
  getInvoiceSequence,
  getSequenceProgress,
  getReminderHistory,
  pauseSequence,
  resumeSequence,
  previewSchedule,
  sendImmediateReminder,
  previewReminder,
  getActiveSequenceInvoices,
  runReminderBatch,
  getAllSequencesAdmin,
};

