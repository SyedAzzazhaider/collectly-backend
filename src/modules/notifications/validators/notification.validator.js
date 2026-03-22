'use strict';

const AppError = require('../../../shared/errors/AppError');
const { VALID_CHANNELS, VALID_TYPES } = require('../models/Notification.model');

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const sanitize     = (v) => (typeof v === 'string' ? v.trim() : v);
const isValidObjId = (id) => /^[a-f\d]{24}$/i.test(String(id));

const validateSendNotification = (req, res, next) => {
  try {
    const {
      channel, type, recipient, subject, body,
      invoiceId, customerId, scheduledAt,
    } = req.body;
    const errors = {};

    if (!channel || !VALID_CHANNELS.includes(channel)) {
      errors.channel = `Channel must be one of: ${VALID_CHANNELS.join(', ')}`;
    }
    if (type !== undefined && !VALID_TYPES.includes(type)) {
      errors.type = `Type must be one of: ${VALID_TYPES.join(', ')}`;
    }
    if (!recipient || typeof recipient !== 'object') {
      errors.recipient = 'Recipient object is required';
    } else {
      if (!recipient.name || sanitize(String(recipient.name)).length === 0) {
        errors['recipient.name'] = 'Recipient name is required';
      } else if (String(recipient.name).length > 200) {
        errors['recipient.name'] = 'Recipient name must be at most 200 characters';
      }
      if (channel === 'email' || channel === 'in-app') {
        if (!recipient.email) {
          errors['recipient.email'] = 'Recipient email is required for email channel';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
          errors['recipient.email'] = 'Recipient email must be a valid email address';
        }
      }
      if (channel === 'sms' || channel === 'whatsapp') {
        if (!recipient.phone) {
          errors['recipient.phone'] = `Recipient phone is required for ${channel} channel`;
        } else if (!/^\+[1-9]\d{6,14}$/.test(recipient.phone)) {
          errors['recipient.phone'] = 'Phone must be in E.164 format e.g. +1234567890';
        }
      }
    }
    if (channel === 'email') {
      if (!subject || sanitize(String(subject)).length === 0) {
        errors.subject = 'Subject is required for email channel';
      } else if (String(subject).length > 500) {
        errors.subject = 'Subject must be at most 500 characters';
      }
    }
    if (!body || sanitize(String(body)).length === 0) {
      errors.body = 'Message body is required';
    } else if (String(body).length > 10000) {
      errors.body = 'Message body must be at most 10000 characters';
    }
    if (invoiceId !== undefined && invoiceId !== null && !isValidObjId(invoiceId)) {
      errors.invoiceId = 'Invoice ID must be a valid ID';
    }
    if (customerId !== undefined && customerId !== null && !isValidObjId(customerId)) {
      errors.customerId = 'Customer ID must be a valid ID';
    }

    // ── scheduledAt — must be a valid future date if provided ─────────────────
    if (scheduledAt !== undefined && scheduledAt !== null) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) {
        errors.scheduledAt = 'scheduledAt must be a valid ISO 8601 date';
      } else if (d <= new Date()) {
        errors.scheduledAt = 'scheduledAt must be a future date';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Notification validation failed', errors));
    }
    req.body.channel = sanitize(channel);
    if (body)    req.body.body    = sanitize(String(body));
    if (subject) req.body.subject = sanitize(String(subject));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

const validateSendBulk = (req, res, next) => {
  try {
    const { notifications } = req.body;
    if (notifications === undefined || notifications === null || !Array.isArray(notifications)) {
      return next(validationError('Bulk notification validation failed', {
        notifications: 'Notifications must be an array',
      }));
    }
    if (notifications.length === 0) {
      return next(validationError('Bulk notification validation failed', {
        notifications: 'At least one notification is required',
      }));
    }
    if (notifications.length > 100) {
      return next(validationError('Bulk notification validation failed', {
        notifications: 'Maximum 100 notifications per bulk request',
      }));
    }
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

const validateGetNotifications = (req, res, next) => {
  try {
    const { channel, status, page, limit } = req.query;
    const errors = {};

    if (channel !== undefined && !VALID_CHANNELS.includes(channel)) {
      errors.channel = `Channel must be one of: ${VALID_CHANNELS.join(', ')}`;
    }
    if (status !== undefined) {
      const validStatuses = ['pending', 'sent', 'delivered', 'failed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        errors.status = `Status must be one of: ${validStatuses.join(', ')}`;
      }
    }
    if (page !== undefined) {
      const n = parseInt(page, 10);
      if (!Number.isInteger(n) || n < 1) {
        errors.page = 'Page must be a positive integer';
      }
    }
    if (limit !== undefined) {
      const n = parseInt(limit, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        errors.limit = 'Limit must be between 1 and 100';
      }
    }
    if (Object.keys(errors).length > 0) {
      return next(validationError('Query validation failed', errors));
    }
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateSendNotification,
  validateSendBulk,
  validateGetNotifications,
};

