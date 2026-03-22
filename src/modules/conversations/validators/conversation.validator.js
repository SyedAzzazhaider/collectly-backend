'use strict';

const AppError = require('../../../shared/errors/AppError');
const { VALID_CHANNELS, VALID_TYPES } = require('../models/Message.model');
const { VALID_FREQUENCIES }           = require('../models/PaymentPlan.model');

// ── Helpers ───────────────────────────────────────────────────────────────────

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const sanitize    = (v) => (typeof v === 'string' ? v.trim() : v);
const stripHtml   = (v) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim() : v);
const isValidObjId  = (id) => /^[a-f\d]{24}$/i.test(String(id));

// ── validateSendMessage ───────────────────────────────────────────────────────

const validateSendMessage = (req, res, next) => {
  try {
    const { customerId, invoiceId, channel, type, subject, body, followUpAt, tags } = req.body;
    const errors = {};

    if (!customerId || !isValidObjId(customerId)) {
      errors.customerId = 'Customer ID must be a valid ID';
    }

    if (invoiceId !== undefined && invoiceId !== null && !isValidObjId(invoiceId)) {
      errors.invoiceId = 'Invoice ID must be a valid ID';
    }

    if (!channel || !VALID_CHANNELS.includes(channel)) {
      errors.channel = `Channel must be one of: ${VALID_CHANNELS.join(', ')}`;
    }

    if (type !== undefined && !VALID_TYPES.includes(type)) {
      errors.type = `Type must be one of: ${VALID_TYPES.join(', ')}`;
    }

    if (channel === 'email' && (!subject || sanitize(String(subject)).length === 0)) {
      errors.subject = 'Subject is required for email messages';
    }

    if (subject && String(subject).length > 500) {
      errors.subject = 'Subject must be at most 500 characters';
    }

    if (!body || sanitize(String(body)).length === 0) {
      errors.body = 'Message body is required';
    } else if (String(body).length > 10000) {
      errors.body = 'Message body must be at most 10000 characters';
    }

    if (followUpAt !== undefined && followUpAt !== null) {
      const d = new Date(followUpAt);
      if (isNaN(d.getTime())) {
        errors.followUpAt = 'Follow-up date must be a valid date';
      } else if (d <= new Date()) {
        errors.followUpAt = 'Follow-up date must be in the future';
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 10) {
        errors.tags = 'Maximum 10 tags allowed';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Message validation failed', errors));
    }

    req.body.body = stripHtml(String(body));
    if (subject) req.body.subject = stripHtml(String(subject));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateCreateCannedReply ─────────────────────────────────────────────────

const validateCreateCannedReply = (req, res, next) => {
  try {
    const { name, category, channel, subject, body, tags } = req.body;
    const errors = {};

    if (!name || sanitize(String(name)).length < 2) {
      errors.name = 'Name is required and must be at least 2 characters';
    } else if (String(name).length > 150) {
      errors.name = 'Name must be at most 150 characters';
    }

    if (category !== undefined && String(category).length > 100) {
      errors.category = 'Category must be at most 100 characters';
    }

    const validChannels = ['email', 'sms', 'whatsapp', 'in-app', 'all'];
    if (channel !== undefined && !validChannels.includes(channel)) {
      errors.channel = `Channel must be one of: ${validChannels.join(', ')}`;
    }

    if (subject !== undefined && String(subject).length > 500) {
      errors.subject = 'Subject must be at most 500 characters';
    }

    if (!body || sanitize(String(body)).length === 0) {
      errors.body = 'Template body is required';
    } else if (String(body).length > 5000) {
      errors.body = 'Body must be at most 5000 characters';
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Canned reply validation failed', errors));
    }

    req.body.name = stripHtml(String(name));
    req.body.body = stripHtml(String(body));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateUpdateCannedReply ─────────────────────────────────────────────────

const validateUpdateCannedReply = (req, res, next) => {
  try {
    const { name, category, channel, subject, body, tags, isActive } = req.body;
    const errors = {};

    if (name !== undefined) {
      if (sanitize(String(name)).length < 2) {
        errors.name = 'Name must be at least 2 characters';
      } else if (String(name).length > 150) {
        errors.name = 'Name must be at most 150 characters';
      }
    }

    if (category !== undefined && String(category).length > 100) {
      errors.category = 'Category must be at most 100 characters';
    }

    const validChannels = ['email', 'sms', 'whatsapp', 'in-app', 'all'];
    if (channel !== undefined && !validChannels.includes(channel)) {
      errors.channel = `Channel must be one of: ${validChannels.join(', ')}`;
    }

    if (body !== undefined) {
      if (sanitize(String(body)).length === 0) {
        errors.body = 'Body cannot be empty';
      } else if (String(body).length > 5000) {
        errors.body = 'Body must be at most 5000 characters';
      }
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.isActive = 'isActive must be a boolean';
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Canned reply update validation failed', errors));
    }

    if (name) req.body.name = stripHtml(String(name));
if (body) req.body.body = stripHtml(String(body));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateCreatePaymentPlan ─────────────────────────────────────────────────

const validateCreatePaymentPlan = (req, res, next) => {
  try {
    const {
      customerId, invoiceId, totalAmount, currency,
      numberOfInstallments, frequency, startDate, notes,
    } = req.body;
    const errors = {};

    if (!customerId || !isValidObjId(customerId)) {
      errors.customerId = 'Customer ID must be a valid ID';
    }

    if (!invoiceId || !isValidObjId(invoiceId)) {
      errors.invoiceId = 'Invoice ID must be a valid ID';
    }

    if (totalAmount === undefined || totalAmount === null) {
      errors.totalAmount = 'Total amount is required';
    } else {
      const n = Number(totalAmount);
      if (isNaN(n) || n < 0.01) {
        errors.totalAmount = 'Total amount must be greater than 0';
      }
    }

    if (currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(String(currency).toUpperCase())) {
        errors.currency = 'Currency must be a valid 3-letter code e.g. USD';
      }
    }

    if (numberOfInstallments === undefined || numberOfInstallments === null) {
      errors.numberOfInstallments = 'Number of installments is required';
    } else {
      const n = Number(numberOfInstallments);
      if (!Number.isInteger(n) || n < 2 || n > 24) {
        errors.numberOfInstallments = 'Number of installments must be between 2 and 24';
      }
    }

    if (!frequency || !VALID_FREQUENCIES.includes(frequency)) {
      errors.frequency = `Frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`;
    }

    if (!startDate) {
      errors.startDate = 'Start date is required';
    } else {
      const d = new Date(startDate);
      if (isNaN(d.getTime())) {
        errors.startDate = 'Start date must be a valid date';
      }
    }

    if (notes !== undefined && String(notes).length > 2000) {
      errors.notes = 'Notes must be at most 2000 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Payment plan validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateFollowUp ──────────────────────────────────────────────────────────

const validateFollowUp = (req, res, next) => {
  try {
    const { followUpAt, followUpNote } = req.body;
    const errors = {};

    if (!followUpAt) {
      errors.followUpAt = 'Follow-up date is required';
    } else {
      const d = new Date(followUpAt);
      if (isNaN(d.getTime())) {
        errors.followUpAt = 'Follow-up date must be a valid date';
      } else if (d <= new Date()) {
        errors.followUpAt = 'Follow-up date must be in the future';
      }
    }

    if (followUpNote !== undefined && String(followUpNote).length > 500) {
      errors.followUpNote = 'Follow-up note must be at most 500 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Follow-up validation failed', errors));
    }
    if (followUpNote) req.body.followUpNote = stripHtml(String(followUpNote));

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateSendMessage,
  validateCreateCannedReply,
  validateUpdateCannedReply,
  validateCreatePaymentPlan,
  validateFollowUp,
};

