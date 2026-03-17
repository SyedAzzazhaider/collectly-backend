'use strict';

const { Sequence }  = require('../models/Sequence.model');
const Invoice       = require('../../customers/models/Invoice.model');
const Customer      = require('../../customers/models/Customer.model');
const AppError      = require('../../../shared/errors/AppError');
const logger        = require('../../../shared/utils/logger');

// ── Create sequence ───────────────────────────────────────────────────────────
// Document: POST /sequences — Create sequence

const createSequence = async (userId, data) => {
  const { name, description, phases, isDefault } = data;

  // Enforce unique sequence name per user
  const existing = await Sequence.findOne({
    userId,
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
  });
  if (existing) {
    throw new AppError(
      'A sequence with this name already exists in your account.',
      409,
      'DUPLICATE_SEQUENCE_NAME'
    );
  }

  // If setting as default, unset current default first
  if (isDefault) {
    await Sequence.updateMany({ userId, isDefault: true }, { isDefault: false });
  }

  // Sort phases by phaseNumber before saving
  const sortedPhases = (phases || []).sort((a, b) => a.phaseNumber - b.phaseNumber);

  const sequence = await Sequence.create({
    userId,
    name:        name.trim(),
    description: description || null,
    isDefault:   isDefault   || false,
    isActive:    true,
    phases:      sortedPhases,
  });

  logger.info(`Sequence created: ${sequence._id} [${name}] by user: ${userId}`);
  return sequence;
};

// ── Get all sequences ─────────────────────────────────────────────────────────

const getSequences = async (userId, {
  page     = 1,
  limit    = 20,
  isActive = null,
  search   = null,
} = {}) => {
  const query = { userId };

  if (isActive !== null) {
    query.isActive = isActive === 'true' || isActive === true;
  }

  if (search) {
    query.$or = [
      { name:        { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const skip  = (page - 1) * limit;
  const total = await Sequence.countDocuments(query);

  const sequences = await Sequence.find(query)
    .sort({ isDefault: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    sequences,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// ── Get single sequence ───────────────────────────────────────────────────────

const getSequenceById = async (userId, sequenceId) => {
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });
  if (!sequence) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }
  return sequence;
};

// ── Update sequence ───────────────────────────────────────────────────────────

const updateSequence = async (userId, sequenceId, data) => {
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });
  if (!sequence) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  // Check name uniqueness if name is being changed
  if (data.name && data.name.trim() !== sequence.name) {
    const duplicate = await Sequence.findOne({
      userId,
      name: { $regex: `^${data.name.trim()}$`, $options: 'i' },
      _id:  { $ne: sequenceId },
    });
    if (duplicate) {
      throw new AppError('A sequence with this name already exists.', 409, 'DUPLICATE_SEQUENCE_NAME');
    }
  }

  // Handle default flag
  if (data.isDefault === true && !sequence.isDefault) {
    await Sequence.updateMany(
      { userId, isDefault: true, _id: { $ne: sequenceId } },
      { isDefault: false }
    );
  }

  const allowedFields = ['name', 'description', 'phases', 'isActive', 'isDefault'];
  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      sequence[field] = data[field];
    }
  });

  // Re-sort phases if updated
  if (data.phases) {
    sequence.phases = sequence.phases.sort((a, b) => a.phaseNumber - b.phaseNumber);
  }

  await sequence.save();

  logger.info(`Sequence updated: ${sequenceId} by user: ${userId}`);
  return sequence;
};

// ── Delete sequence ───────────────────────────────────────────────────────────

const deleteSequence = async (userId, sequenceId) => {
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });
  if (!sequence) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  if (sequence.activeInvoiceCount > 0) {
    throw new AppError(
      `Cannot delete sequence with ${sequence.activeInvoiceCount} active invoice(s) assigned to it.`,
      400,
      'SEQUENCE_HAS_ACTIVE_INVOICES'
    );
  }

  await Sequence.deleteOne({ _id: sequenceId, userId });

  logger.info(`Sequence deleted: ${sequenceId} by user: ${userId}`);
  return { deleted: true, sequenceId };
};

// ── Duplicate sequence ────────────────────────────────────────────────────────

const duplicateSequence = async (userId, sequenceId) => {
  const original = await Sequence.findOne({ _id: sequenceId, userId }).lean();
  if (!original) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  let copyName   = `${original.name} (Copy)`;
  let copyNumber = 1;

  // Ensure unique name for copy
  while (await Sequence.findOne({ userId, name: copyName })) {
    copyNumber++;
    copyName = `${original.name} (Copy ${copyNumber})`;
  }

  const copy = await Sequence.create({
    userId,
    name:        copyName,
    description: original.description,
    isDefault:   false,
    isActive:    true,
    phases:      original.phases,
  });

  logger.info(`Sequence duplicated: ${sequenceId} → ${copy._id} by user: ${userId}`);
  return copy;
};

// ── Assign sequence to invoice ────────────────────────────────────────────────

// Assign sequence to invoice
// BUG-10 FIX: Delegates to scheduler service for consistent phase/nextReminderAt initialization
const assignSequenceToInvoice = async (userId, sequenceId, invoiceId) => {
  const schedulerService = require('./scheduler.service');
  return schedulerService.initializeSequenceOnInvoice(invoiceId, sequenceId, userId);
};

// ── Unassign sequence from invoice ────────────────────────────────────────────

const unassignSequenceFromInvoice = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  const prevSequenceId = invoice.get('sequenceId');

  invoice.set('sequenceId',         null);
  invoice.set('sequenceAssignedAt', null);
  invoice.set('currentPhase',       null);
  await invoice.save({ validateBeforeSave: false });

  // Decrement active count on previously assigned sequence
  if (prevSequenceId) {
    await Sequence.findByIdAndUpdate(prevSequenceId, {
      $inc: { activeInvoiceCount: -1 },
    });
  }

  logger.info(`Sequence unassigned from invoice ${invoiceId} by user ${userId}`);
  return { invoice };
};

// ── Get sequences for a specific invoice ──────────────────────────────────────

const getInvoiceSequence = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  const sequenceId = invoice.get('sequenceId');
  if (!sequenceId) {
    return { sequence: null, invoice };
  }

  const sequence = await Sequence.findById(sequenceId);
  return { sequence, invoice };
};

// ── Get default sequence for user ─────────────────────────────────────────────

const getDefaultSequence = async (userId) => {
  const sequence = await Sequence.findOne({ userId, isDefault: true, isActive: true });
  return sequence;
};

// ── Get sequence phase details ────────────────────────────────────────────────

const getPhaseDetails = async (userId, sequenceId, phaseNumber) => {
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });
  if (!sequence) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  const phase = sequence.phases.find((p) => p.phaseNumber === Number(phaseNumber));
  if (!phase) {
    throw new AppError(
      `Phase ${phaseNumber} not found in this sequence.`,
      404,
      'PHASE_NOT_FOUND'
    );
  }

  return { sequence, phase };
};

// ── Preview sequence schedule for an invoice ─────────────────────────────────

const previewSequenceSchedule = async (userId, sequenceId, invoiceId) => {
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });
  if (!sequence) {
    throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .populate('customerId', 'name email timezone preferences');
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  const dueDate  = new Date(invoice.dueDate);
  const schedule = sequence.phases
    .filter((p) => p.isEnabled)
    .sort((a, b) => a.phaseNumber - b.phaseNumber)
    .map((phase) => {
      const triggerDate = new Date(dueDate);
      triggerDate.setDate(triggerDate.getDate() + phase.triggerRule.daysOffset);

      return {
        phaseNumber:   phase.phaseNumber,
        phaseType:     phase.phaseType,
        reminderType:  phase.reminderType,
        channels:      phase.channels,
        triggerDate,
        daysOffset:    phase.triggerRule.daysOffset,
        isPast:        triggerDate < new Date(),
        minAmount:     phase.triggerRule.minAmount,
        maxAmount:     phase.triggerRule.maxAmount,
        eligible:      isInvoiceEligibleForPhase(invoice, phase),
      };
    });

  return {
    sequence: { id: sequence._id, name: sequence.name },
    invoice:  { id: invoice._id, invoiceNumber: invoice.invoiceNumber, dueDate, amount: invoice.amount },
    schedule,
  };
};

// ── Helper: check if invoice is eligible for a phase ─────────────────────────

const isInvoiceEligibleForPhase = (invoice, phase) => {
  const rule = phase.triggerRule;

  if (rule.minAmount !== null && rule.minAmount !== undefined) {
    if (invoice.amount < rule.minAmount) return false;
  }

  if (rule.maxAmount !== null && rule.maxAmount !== undefined) {
    if (invoice.amount > rule.maxAmount) return false;
  }

  return true;
};

// ── Admin: get all sequences across all users ─────────────────────────────────

const getAllSequencesAdmin = async ({ page = 1, limit = 20 } = {}) => {
  const skip  = (page - 1) * limit;
  const total = await Sequence.countDocuments({});

  const sequences = await Sequence.find({})
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    sequences,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

module.exports = {
  createSequence,
  getSequences,
  getSequenceById,
  updateSequence,
  deleteSequence,
  duplicateSequence,
  assignSequenceToInvoice,
  unassignSequenceFromInvoice,
  getInvoiceSequence,
  getDefaultSequence,
  getPhaseDetails,
  previewSequenceSchedule,
  getAllSequencesAdmin,
};