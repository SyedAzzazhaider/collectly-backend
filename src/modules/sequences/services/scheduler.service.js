'use strict';

const { Sequence } = require('../models/Sequence.model');
const Invoice      = require('../../customers/models/Invoice.model');
const Customer     = require('../../customers/models/Customer.model');
const AppError     = require('../../../shared/errors/AppError');
const logger       = require('../../../shared/utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE_TYPE_ORDER = [
  'pre-due',
  'due-day',
  'first-overdue',
  'follow-up',
  'final-notice',
];

// ── BUG-06 FIX: Timezone-aware trigger date calculation ───────────────────────
// Previous code: date.setHours(9,0,0,0) applied 9 AM in SERVER timezone.
// Fix: compute 9 AM in the customer's local timezone using Intl-based offset.

const getTimezoneOffsetMs = (timezone, referenceDate) => {
  try {
    const d       = new Date(referenceDate);
    const utcStr  = d.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr   = d.toLocaleString('en-US', { timeZone: timezone });
    return new Date(tzStr).getTime() - new Date(utcStr).getTime();
  } catch {
    return 0; // fallback: treat as UTC
  }
};

const calculateTriggerDate = (dueDate, daysOffset, timezone = 'UTC') => {
  const base = new Date(dueDate);
  base.setDate(base.getDate() + daysOffset);

  try {
    // Get YYYY-MM-DD string in customer's timezone (en-CA gives ISO-like format)
    const localDateStr = base.toLocaleDateString('en-CA', { timeZone: timezone });

    // Build "9:00 AM UTC" for that date, then shift by timezone offset
    // so that the result equals 9:00 AM in the customer's local time
    const nineAmUtc  = new Date(`${localDateStr}T09:00:00.000Z`);
    const offsetMs   = getTimezoneOffsetMs(timezone, nineAmUtc);
    return new Date(nineAmUtc.getTime() - offsetMs);
  } catch {
    // Invalid/unknown timezone: fall back to 9 AM UTC on that date
    const fallback = new Date(base);
    fallback.setUTCHours(9, 0, 0, 0);
    return fallback;
  }
};

// ── Check if invoice amount satisfies phase trigger rule ──────────────────────

const invoiceSatisfiesAmountRule = (invoice, triggerRule) => {
  if (triggerRule.minAmount !== null && triggerRule.minAmount !== undefined) {
    if (invoice.amount < triggerRule.minAmount) return false;
  }
  if (triggerRule.maxAmount !== null && triggerRule.maxAmount !== undefined) {
    if (invoice.amount > triggerRule.maxAmount) return false;
  }
  return true;
};

// ── Get next eligible phase for an invoice ────────────────────────────────────

const getNextEligiblePhase = (sequence, invoice, now = new Date()) => {
  const currentPhase = invoice.currentPhase || 0;

  // BUG-06: read timezone from populated customerId object
  const timezone = invoice.customerId?.timezone || 'UTC';

  const enabledPhases = sequence.phases
    .filter((p) => p.isEnabled)
    .sort((a, b) => a.phaseNumber - b.phaseNumber);

  for (const phase of enabledPhases) {
    if (phase.phaseNumber <= currentPhase) continue;

    const triggerDate = calculateTriggerDate(
      invoice.dueDate,
      phase.triggerRule.daysOffset,
      timezone                        // BUG-06
    );

    if (triggerDate > now) {
      return { phase, triggerDate, isDue: false };
    }

    if (!invoiceSatisfiesAmountRule(invoice, phase.triggerRule)) {
      logger.info(
        `Invoice ${invoice._id} skipped phase ${phase.phaseNumber} — amount not in threshold`
      );
      continue;
    }

    return { phase, triggerDate, isDue: true };
  }

  return null;
};

// ── Calculate next reminder date ──────────────────────────────────────────────

const calculateNextReminderDate = (sequence, invoice, completedPhaseNumber) => {
  const now      = new Date();
  const timezone = invoice.customerId?.timezone || 'UTC'; // BUG-06

  const remainingPhases = sequence.phases
    .filter((p) => p.isEnabled && p.phaseNumber > completedPhaseNumber)
    .sort((a, b) => a.phaseNumber - b.phaseNumber);

  for (const phase of remainingPhases) {
    const triggerDate = calculateTriggerDate(
      invoice.dueDate,
      phase.triggerRule.daysOffset,
      timezone                        // BUG-06
    );

    if (invoiceSatisfiesAmountRule(invoice, phase.triggerRule)) {
      return triggerDate > now ? triggerDate : now;
    }
  }

  return null;
};

// ── Get all invoices due for reminders ────────────────────────────────────────

const getInvoicesDueForReminders = async (batchSize = 100) => {
  const now = new Date();

  // BUG-07 FIX: select +reminderHistory so processRecurringReminder can count
  // sentInPhase correctly. Without this, reminderHistory is always undefined
  // (field has select:false on schema), making maxRepeats enforcement fail.
  const invoices = await Invoice.find({
    sequenceId:     { $ne: null },
    sequencePaused: false,
    status:         { $in: ['pending', 'overdue', 'partial'] },
    nextReminderAt: { $lte: now },
  })
    .select('+reminderHistory')                               // BUG-07
    .populate('sequenceId')
    .populate('customerId', 'name email phone timezone preferences')
    .limit(batchSize)
    .lean();

  return invoices;
};

// ── Advance invoice to next phase ─────────────────────────────────────────────

const advanceInvoicePhase = async (invoiceId, userId, completedPhase, status = 'sent', note = null) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .select('+reminderHistory')
    .populate('customerId', 'timezone');  // BUG-06: needed for calculateNextReminderDate

  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  const sequence = await Sequence.findById(invoice.sequenceId);
  if (!sequence) {
    logger.warn(`Sequence not found for invoice ${invoiceId} — clearing assignment`);
    invoice.sequenceId = null;
    await invoice.save({ validateBeforeSave: false });
    return invoice;
  }

  invoice.reminderHistory.push({
    phaseNumber: completedPhase.phaseNumber,
    phaseType:   completedPhase.phaseType,
    channel:     completedPhase.channels[0],
    sentAt:      new Date(),
    status,
    note,
  });

  invoice.remindersSent  += 1;
  invoice.lastReminderAt  = new Date();
  invoice.currentPhase    = completedPhase.phaseNumber;

  // Handle recurring reminders
  if (
    completedPhase.reminderType === 'recurring' &&
    completedPhase.triggerRule.repeatEveryDays
  ) {
    const sentCount = invoice.reminderHistory.filter(
      (h) => h.phaseNumber === completedPhase.phaseNumber
    ).length;

    const maxRepeats = completedPhase.triggerRule.maxRepeats || Infinity;

    if (sentCount < maxRepeats) {
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + completedPhase.triggerRule.repeatEveryDays);
      invoice.nextReminderAt = nextDate;
      await invoice.save({ validateBeforeSave: false });
      return invoice;
    }
  }

  const nextPhaseDate = calculateNextReminderDate(sequence, invoice, completedPhase.phaseNumber);
  invoice.nextReminderAt = nextPhaseDate;

  if (!nextPhaseDate) {
    logger.info(`Sequence completed for invoice ${invoiceId}`);
    await Sequence.findByIdAndUpdate(sequence._id, {
      $inc: { activeInvoiceCount: -1 },
    });
  }

  await invoice.save({ validateBeforeSave: false });
  return invoice;
};

// ── Initialize sequence on invoice ───────────────────────────────────────────

const initializeSequenceOnInvoice = async (invoiceId, sequenceId, userId) => {
  const invoice  = await Invoice.findOne({ _id: invoiceId, userId });
  const sequence = await Sequence.findOne({ _id: sequenceId, userId });

  if (!invoice)  throw new AppError('Invoice not found.',  404, 'INVOICE_NOT_FOUND');
  if (!sequence) throw new AppError('Sequence not found.', 404, 'SEQUENCE_NOT_FOUND');

  if (!sequence.isActive) {
    throw new AppError('Cannot assign an inactive sequence.', 400, 'SEQUENCE_INACTIVE');
  }

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new AppError(
      `Cannot assign a sequence to a ${invoice.status} invoice.`,
      400,
      'INVOICE_NOT_ELIGIBLE'
    );
  }

  // BUG-06: fetch customer timezone for accurate first trigger date
  const customer    = await Customer.findById(invoice.customerId).select('timezone').lean();
  const timezone    = customer?.timezone || 'UTC';
  const now         = new Date();

  const invoiceForPhase = {
    ...invoice.toObject(),
    currentPhase: 0,
    customerId:   { timezone },
  };

  const nextPhase = getNextEligiblePhase(sequence, invoiceForPhase, now);
  const nextDate  = nextPhase ? nextPhase.triggerDate : null;

  invoice.sequenceId         = sequenceId;
  invoice.sequenceAssignedAt = now;
  invoice.currentPhase       = 0;
  invoice.sequencePaused     = false;
  invoice.nextReminderAt     = nextDate;

  await invoice.save({ validateBeforeSave: false });

  await Sequence.findByIdAndUpdate(sequenceId, {
    $inc: { activeInvoiceCount: 1 },
  });

  logger.info(`Sequence ${sequenceId} initialized on invoice ${invoiceId}`);
  return { invoice, sequence, nextReminderAt: nextDate };
};

// ── Pause sequence on invoice ─────────────────────────────────────────────────

const pauseSequence = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (!invoice.sequenceId) {
    throw new AppError('No sequence assigned to this invoice.', 400, 'NO_SEQUENCE_ASSIGNED');
  }

  invoice.sequencePaused = true;
  await invoice.save({ validateBeforeSave: false });

  logger.info(`Sequence paused for invoice ${invoiceId} by user ${userId}`);
  return invoice;
};

// ── Resume sequence on invoice ────────────────────────────────────────────────

const resumeSequence = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (!invoice.sequenceId) {
    throw new AppError('No sequence assigned to this invoice.', 400, 'NO_SEQUENCE_ASSIGNED');
  }

  if (!invoice.sequencePaused) {
    throw new AppError('Sequence is not paused.', 400, 'SEQUENCE_NOT_PAUSED');
  }

  const sequence = await Sequence.findById(invoice.sequenceId);
  if (!sequence) {
    throw new AppError('Assigned sequence not found.', 404, 'SEQUENCE_NOT_FOUND');
  }

  // BUG-06: fetch customer timezone before recalculating trigger
  const customer = await Customer.findById(invoice.customerId).select('timezone').lean();
  const timezone = customer?.timezone || 'UTC';

  const invoiceForPhase = {
    ...invoice.toObject(),
    currentPhase: invoice.currentPhase || 0,
    customerId:   { timezone },
  };

  const now       = new Date();
  const nextPhase = getNextEligiblePhase(sequence, invoiceForPhase, now);

  invoice.sequencePaused = false;
  invoice.nextReminderAt = nextPhase ? nextPhase.triggerDate : null;

  await invoice.save({ validateBeforeSave: false });

  logger.info(`Sequence resumed for invoice ${invoiceId} by user ${userId}`);
  return invoice;
};

// ── Get reminder history for an invoice ──────────────────────────────────────

const getReminderHistory = async (userId, invoiceId, { page = 1, limit = 20 } = {}) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .select('+reminderHistory');

  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  const history = invoice.reminderHistory || [];
  const sorted  = [...history].sort((a, b) => b.sentAt - a.sentAt);
  const skip    = (page - 1) * limit;
  const slice   = sorted.slice(skip, skip + limit);

  return {
    invoiceId,
    history: slice,
    pagination: {
      total: history.length,
      page,
      limit,
      pages: Math.ceil(history.length / limit),
    },
  };
};

// ── Get sequence progress for an invoice ─────────────────────────────────────

const getSequenceProgress = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .select('+reminderHistory')
    .populate('sequenceId')
    .populate('customerId', 'timezone');  // BUG-06

  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (!invoice.sequenceId) {
    return {
      hasSequence: false,
      invoice:     { id: invoice._id, invoiceNumber: invoice.invoiceNumber },
    };
  }

  const sequence     = invoice.sequenceId;
  const timezone     = invoice.customerId?.timezone || 'UTC';
  const totalPhases  = sequence.phases.filter((p) => p.isEnabled).length;
  const currentPhase = invoice.currentPhase || 0;

  const phases = sequence.phases
    .filter((p) => p.isEnabled)
    .sort((a, b) => a.phaseNumber - b.phaseNumber)
    .map((phase) => {
      const triggerDate = calculateTriggerDate(
        invoice.dueDate,
        phase.triggerRule.daysOffset,
        timezone                      // BUG-06
      );
      return {
        phaseNumber:  phase.phaseNumber,
        phaseType:    phase.phaseType,
        reminderType: phase.reminderType,
        channels:     phase.channels,
        triggerDate,
        isCompleted:  phase.phaseNumber <= currentPhase,
        isNext:       phase.phaseNumber === currentPhase + 1,
        isEnabled:    phase.isEnabled,
      };
    });

  const progressPercent = totalPhases > 0
    ? Math.round((currentPhase / totalPhases) * 100)
    : 0;

  return {
    hasSequence:        true,
    isPaused:           invoice.sequencePaused || false,
    currentPhase,
    totalPhases,
    progressPercent,
    remindersSent:      invoice.remindersSent,
    lastReminderAt:     invoice.lastReminderAt,
    nextReminderAt:     invoice.nextReminderAt,
    sequenceAssignedAt: invoice.sequenceAssignedAt,
    phases,
    sequence: { id: sequence._id, name: sequence.name },
    invoice: {
      id:            invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      dueDate:       invoice.dueDate,
      amount:        invoice.amount,
      status:        invoice.status,
    },
  };
};

// ── Get all invoices with active sequences for a user ─────────────────────────

const getInvoicesWithActiveSequences = async (userId, {
  page   = 1,
  limit  = 20,
  paused = null,
} = {}) => {
  const query = {
    userId,
    sequenceId: { $ne: null },
    status:     { $in: ['pending', 'overdue', 'partial'] },
  };

  if (paused !== null) {
    query.sequencePaused = paused === 'true' || paused === true;
  }

  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(query);

  const invoices = await Invoice.find(query)
    .populate('customerId', 'name email')
    .populate('sequenceId', 'name isActive')
    .sort({ nextReminderAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

module.exports = {
  calculateTriggerDate,
  invoiceSatisfiesAmountRule,
  getNextEligiblePhase,
  calculateNextReminderDate,
  getInvoicesDueForReminders,
  advanceInvoicePhase,
  initializeSequenceOnInvoice,
  pauseSequence,
  resumeSequence,
  getReminderHistory,
  getSequenceProgress,
  getInvoicesWithActiveSequences,
};

