'use strict';

const { Sequence, VALID_REMINDER_TYPES } = require('../models/Sequence.model');
const Invoice          = require('../../customers/models/Invoice.model');
const Customer         = require('../../customers/models/Customer.model');
const AppError         = require('../../../shared/errors/AppError');
const logger           = require('../../../shared/utils/logger');
const schedulerService = require('./scheduler.service');
const complianceService = require('../../compliance/services/compliance.service');

// ── Compliance channel filter — shared by all three reminder functions ─────────
// Removes channels blocked by DNC list or opt-out for this customer

const applyComplianceFilter = async (userId, customerId, channels, invoiceId) => {
  const checks = await Promise.all(
    channels.map(async (channel) => {
      const check = await complianceService.isDeliveryAllowed(
        String(userId),
        String(customerId),
        channel
      );
      return { channel, ...check };
    })
  );

  const allowed = checks.filter((c) => c.allowed).map((c) => c.channel);
  const blocked = checks.filter((c) => !c.allowed);

  if (blocked.length > 0) {
    logger.info(
      `Compliance: blocked channels for invoice ${invoiceId}: ` +
      blocked.map((b) => `${b.channel}(${b.reason})`).join(', ')
    );
  }

  return allowed;
};

// ── Send immediate reminder ───────────────────────────────────────────────────
// Document: Reminder Type — Immediate

const sendImmediateReminder = async (userId, invoiceId, options = {}) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .populate('customerId', 'name email phone timezone preferences');

  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new AppError(
      `Cannot send reminder for a ${invoice.status} invoice.`,
      400,
      'INVOICE_NOT_ELIGIBLE'
    );
  }

  const customer = invoice.customerId;
  if (!customer) throw new AppError('Customer not found for this invoice.', 404);

  // Determine channels — use customer preference or override
  let channels = options.channels ||
    customer.preferences?.channels ||
    ['email'];

  // ── Compliance guard — DNC / opt-in enforcement (GDPR) ───────────────────
  channels = await applyComplianceFilter(
    userId,
    String(customer._id),
    channels,
    invoiceId
  );

  if (channels.length === 0) {
    logger.info(
      `Immediate reminder blocked by compliance for all channels: invoice=${invoiceId}`
    );
    return {
      dispatched:   false,
      reason:       'compliance_blocked',
      reminderType: 'immediate',
    };
  }

  // Build reminder payload
  const payload = buildReminderPayload({
    invoice,
    customer,
    channels,
    reminderType:  'immediate',
    phaseType:     options.phaseType || 'first-overdue',
    customMessage: options.message   || null,
  });

  logger.info(
    `Immediate reminder dispatched: invoice=${invoiceId} channels=${channels.join(',')} user=${userId}`
  );

  // Update invoice reminder tracking
  await Invoice.findByIdAndUpdate(invoiceId, {
    $inc:  { remindersSent: 1 },
    $set:  { lastReminderAt: new Date() },
    $push: {
      reminderHistory: {
        phaseNumber: invoice.currentPhase || 0,
        phaseType:   options.phaseType    || 'first-overdue',
        channel:     channels[0],
        sentAt:      new Date(),
        status:      'sent',
        note:        'Immediate reminder',
      },
    },
  });

  return {
    dispatched:   true,
    reminderType: 'immediate',
    channels,
    invoice: {
      id:            invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      amount:        invoice.amount,
      dueDate:       invoice.dueDate,
    },
    customer: {
      id:    customer._id,
      name:  customer.name,
      email: customer.email,
    },
    payload,
  };
};

// ── Process scheduled reminder for a phase ────────────────────────────────────
// Document: Reminder Type — Scheduled

const processScheduledReminder = async (invoice, phase, sequence) => {
  const customer = await Customer.findById(invoice.customerId)
    .select('name email phone timezone preferences');

  if (!customer) {
    logger.warn(`Customer not found for invoice ${invoice._id} — skipping reminder`);
    return { dispatched: false, reason: 'customer_not_found' };
  }

  // Filter channels by customer preference
  const allowedChannels = customer.preferences?.channels || ['email'];
  let channels          = phase.channels.filter((c) => allowedChannels.includes(c));

  if (channels.length === 0) {
    logger.info(
      `No matching channels for invoice ${invoice._id} phase ${phase.phaseNumber} — skipping`
    );
    return { dispatched: false, reason: 'no_matching_channels' };
  }

  // ── Compliance guard — DNC / opt-in enforcement (GDPR) ───────────────────
  channels = await applyComplianceFilter(
    String(invoice.userId),
    String(invoice.customerId),
    channels,
    String(invoice._id)
  );

  if (channels.length === 0) {
    logger.info(
      `All channels blocked by compliance: invoice=${invoice._id} phase=${phase.phaseNumber}`
    );
    return { dispatched: false, reason: 'compliance_blocked' };
  }

  // Get message template for each channel
  const templates = phase.messageTemplates.filter((t) => channels.includes(t.channel));

  const payload = buildReminderPayload({
    invoice,
    customer,
    channels,
    reminderType:  'scheduled',
    phaseType:     phase.phaseType,
    phaseNumber:   phase.phaseNumber,
    templates,
  });

  logger.info(
    `Scheduled reminder processed: invoice=${invoice._id} phase=${phase.phaseNumber} channels=${channels.join(',')}`
  );

  return {
    dispatched:   true,
    reminderType: 'scheduled',
    phaseNumber:  phase.phaseNumber,
    phaseType:    phase.phaseType,
    channels,
    payload,
  };
};

// ── Process recurring reminder ─────────────────────────────────────────────────
// Document: Reminder Type — Recurring

const processRecurringReminder = async (invoice, phase, sequence) => {
  const sentInPhase = (invoice.reminderHistory || []).filter(
    (h) => h.phaseNumber === phase.phaseNumber && h.status === 'sent'
  ).length;

  const maxRepeats = phase.triggerRule.maxRepeats || Infinity;

  if (sentInPhase >= maxRepeats) {
    logger.info(
      `Recurring reminder max repeats reached: invoice=${invoice._id} phase=${phase.phaseNumber}`
    );
    return { dispatched: false, reason: 'max_repeats_reached' };
  }

  const customer = await Customer.findById(invoice.customerId)
    .select('name email phone timezone preferences');

  if (!customer) return { dispatched: false, reason: 'customer_not_found' };

  const allowedChannels = customer.preferences?.channels || ['email'];
  let channels          = phase.channels.filter((c) => allowedChannels.includes(c));

  if (channels.length === 0) {
    return { dispatched: false, reason: 'no_matching_channels' };
  }

  // ── Compliance guard — DNC / opt-in enforcement (GDPR) ───────────────────
  channels = await applyComplianceFilter(
    String(invoice.userId),
    String(invoice.customerId),
    channels,
    String(invoice._id)
  );

  if (channels.length === 0) {
    logger.info(
      `All channels blocked by compliance (recurring): invoice=${invoice._id} phase=${phase.phaseNumber}`
    );
    return { dispatched: false, reason: 'compliance_blocked' };
  }

  const payload = buildReminderPayload({
    invoice,
    customer,
    channels,
    reminderType:  'recurring',
    phaseType:     phase.phaseType,
    phaseNumber:   phase.phaseNumber,
    repeatNumber:  sentInPhase + 1,
    maxRepeats:    phase.triggerRule.maxRepeats,
    templates:     phase.messageTemplates.filter((t) => channels.includes(t.channel)),
  });

  logger.info(
    `Recurring reminder #${sentInPhase + 1}: invoice=${invoice._id} phase=${phase.phaseNumber}`
  );

  return {
    dispatched:   true,
    reminderType: 'recurring',
    phaseNumber:  phase.phaseNumber,
    phaseType:    phase.phaseType,
    repeatNumber: sentInPhase + 1,
    channels,
    payload,
  };
};

// ── Build reminder payload ─────────────────────────────────────────────────────
// Constructs the structured payload ready for the delivery engine (Module E)

const buildReminderPayload = ({
  invoice,
  customer,
  channels,
  reminderType,
  phaseType,
  phaseNumber   = null,
  customMessage = null,
  templates     = [],
  repeatNumber  = null,
  maxRepeats    = null,
}) => {
  const messages = channels.map((channel) => {
    const template = templates.find((t) => t.channel === channel);
    const body     = customMessage
      || (template ? interpolateTemplate(template.body, { invoice, customer }) : null)
      || buildDefaultMessage(invoice, customer, phaseType, channel);

    const subject = template?.subject
      ? interpolateTemplate(template.subject, { invoice, customer })
      : buildDefaultSubject(invoice, phaseType);

    return {
      channel,
      to:      getRecipientAddress(customer, channel),
      subject,
      body,
    };
  });

  return {
    invoiceId:     String(invoice._id),
    customerId:    String(customer._id),
    invoiceNumber: invoice.invoiceNumber,
    amount:        invoice.amount,
    currency:      invoice.currency,
    dueDate:       invoice.dueDate,
    amountDue:     Math.max(0, invoice.amount - invoice.amountPaid),
    reminderType,
    phaseType,
    phaseNumber,
    repeatNumber,
    maxRepeats,
    messages,
    createdAt:     new Date(),
  };
};

// ── Template interpolation ────────────────────────────────────────────────────
// Replaces {{variable}} placeholders in message templates

const interpolateTemplate = (template, { invoice, customer }) => {
  if (!template) return '';

  const daysOverdue = Math.max(
    0,
    Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24))
  );

  const variables = {
    '{{customerName}}':  customer.name             || 'Customer',
    '{{invoiceNumber}}': invoice.invoiceNumber      || '',
    '{{amount}}':        invoice.amount?.toFixed(2) || '0.00',
    '{{currency}}':      invoice.currency           || 'USD',
    '{{dueDate}}':       new Date(invoice.dueDate).toLocaleDateString(),
    '{{amountDue}}':     Math.max(0, invoice.amount - invoice.amountPaid).toFixed(2),
    '{{daysOverdue}}':   String(daysOverdue),
    '{{companyName}}':   'Collectly',
  };

  let result = template;
  Object.entries(variables).forEach(([key, value]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  });

  return result;
};

// ── Get recipient address per channel ─────────────────────────────────────────

const getRecipientAddress = (customer, channel) => {
  const map = {
    email:    customer.email,
    sms:      customer.phone,
    whatsapp: customer.phone,
    'in-app': String(customer._id),
  };
  return map[channel] || customer.email;
};

// ── Build default message if no template defined ──────────────────────────────

const buildDefaultMessage = (invoice, customer, phaseType, channel) => {
  const daysOverdue = Math.max(
    0,
    Math.floor((new Date() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24))
  );

  const messages = {
    'pre-due':       `Dear ${customer.name}, your invoice #${invoice.invoiceNumber} for ${invoice.currency} ${invoice.amount} is due soon. Please ensure timely payment.`,
    'due-day':       `Dear ${customer.name}, your invoice #${invoice.invoiceNumber} for ${invoice.currency} ${invoice.amount} is due today. Please make payment immediately.`,
    'first-overdue': `Dear ${customer.name}, your invoice #${invoice.invoiceNumber} for ${invoice.currency} ${invoice.amount} is overdue by ${daysOverdue} day(s). Please settle immediately.`,
    'follow-up':     `Dear ${customer.name}, this is a follow-up. Invoice #${invoice.invoiceNumber} remains unpaid (${invoice.currency} ${invoice.amount}). Please contact us urgently.`,
    'final-notice':  `Dear ${customer.name}, FINAL NOTICE: Invoice #${invoice.invoiceNumber} for ${invoice.currency} ${invoice.amount} is ${daysOverdue} day(s) overdue. Immediate action required.`,
  };

  return messages[phaseType] || messages['first-overdue'];
};

// ── Build default subject ─────────────────────────────────────────────────────

const buildDefaultSubject = (invoice, phaseType) => {
  const subjects = {
    'pre-due':       `Payment Reminder — Invoice #${invoice.invoiceNumber}`,
    'due-day':       `Payment Due Today — Invoice #${invoice.invoiceNumber}`,
    'first-overdue': `Overdue Notice — Invoice #${invoice.invoiceNumber}`,
    'follow-up':     `Follow-up: Overdue Invoice #${invoice.invoiceNumber}`,
    'final-notice':  `Final Notice — Invoice #${invoice.invoiceNumber}`,
  };
  return subjects[phaseType] || `Payment Reminder — Invoice #${invoice.invoiceNumber}`;
};

// ── Process a single invoice reminder ─────────────────────────────────────────
// Main dispatch function called by the scheduler

const processInvoiceReminder = async (invoice) => {
  try {
    const sequence = await Sequence.findById(invoice.sequenceId);
    if (!sequence || !sequence.isActive) {
      logger.warn(`Sequence inactive or not found for invoice ${invoice._id}`);
      return { processed: false, reason: 'sequence_inactive' };
    }

    const now       = new Date();
    const nextPhase = schedulerService.getNextEligiblePhase(sequence, invoice, now);

    if (!nextPhase || !nextPhase.isDue) {
      return { processed: false, reason: 'no_phase_due' };
    }

    const { phase } = nextPhase;

    let result;

    // Document: Reminder Types — Immediate, Scheduled, Recurring
    switch (phase.reminderType) {
      case 'immediate':
        result = await processScheduledReminder(invoice, phase, sequence);
        break;
      case 'scheduled':
        result = await processScheduledReminder(invoice, phase, sequence);
        break;
      case 'recurring':
        result = await processRecurringReminder(invoice, phase, sequence);
        break;
      default:
        result = await processScheduledReminder(invoice, phase, sequence);
    }

    if (result.dispatched) {
      await schedulerService.advanceInvoicePhase(
        invoice._id,
        invoice.userId,
        phase,
        'sent'
      );
    }

    return { processed: result.dispatched, phase: phase.phaseNumber, result };
  } catch (err) {
    logger.error(`Error processing reminder for invoice ${invoice._id}: ${err.message}`);
    return { processed: false, reason: 'error', error: err.message };
  }
};

// ── Run the scheduled batch ───────────────────────────────────────────────────
// Called periodically — processes all invoices due for reminders

const runReminderBatch = async (batchSize = 50) => {
  logger.info(`Reminder batch started — batch size: ${batchSize}`);

  const invoices = await schedulerService.getInvoicesDueForReminders(batchSize);

  if (invoices.length === 0) {
    logger.info('Reminder batch: no invoices due');
    return { processed: 0, total: 0 };
  }

  let successCount = 0;
  let failCount    = 0;

  for (const invoice of invoices) {
    const result = await processInvoiceReminder(invoice);
    if (result.processed) {
      successCount++;
    } else {
      failCount++;
    }
  }

  logger.info(
    `Reminder batch completed — success: ${successCount}, failed: ${failCount}, total: ${invoices.length}`
  );

  return {
    processed:   successCount,
    failed:      failCount,
    total:       invoices.length,
    completedAt: new Date(),
  };
};

// ── Get reminder preview for an invoice ──────────────────────────────────────

const previewReminder = async (userId, invoiceId, phaseNumber) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .populate('customerId', 'name email phone timezone preferences');

  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  const customer = invoice.customerId;
  if (!customer) throw new AppError('Customer not found.', 404);

  let phase;
  let channels = customer.preferences?.channels || ['email'];

  if (invoice.sequenceId) {
    const sequence = await Sequence.findById(invoice.sequenceId);
    if (sequence) {
      phase = sequence.phases.find((p) => p.phaseNumber === Number(phaseNumber));
      if (phase) channels = phase.channels;
    }
  }

  const phaseType = phase?.phaseType || 'first-overdue';
  const templates = phase?.messageTemplates || [];

  const previews = channels.map((channel) => {
    const template = templates.find((t) => t.channel === channel);
    return {
      channel,
      to:      getRecipientAddress(customer, channel),
      subject: template?.subject
        ? interpolateTemplate(template.subject, { invoice, customer })
        : buildDefaultSubject(invoice, phaseType),
      body: template?.body
        ? interpolateTemplate(template.body, { invoice, customer })
        : buildDefaultMessage(invoice, customer, phaseType, channel),
    };
  });

  return {
    invoice: {
      id:            invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      amount:        invoice.amount,
      currency:      invoice.currency,
      dueDate:       invoice.dueDate,
    },
    customer: { id: customer._id, name: customer.name, email: customer.email },
    previews,
  };
};

module.exports = {
  sendImmediateReminder,
  processScheduledReminder,
  processRecurringReminder,
  buildReminderPayload,
  interpolateTemplate,
  processInvoiceReminder,
  runReminderBatch,
  previewReminder,
};