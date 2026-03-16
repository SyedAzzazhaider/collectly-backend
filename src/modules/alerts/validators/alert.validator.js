'use strict';

const AppError = require('../../../shared/errors/AppError');
const { VALID_ALERT_TYPES } = require('../models/Alert.model');

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

// ── GET /alerts ───────────────────────────────────────────────────────────────

const validateGetAlerts = (req, res, next) => {
  try {
    const { type, isRead, page, limit } = req.query;
    const errors = {};

    if (type !== undefined && !VALID_ALERT_TYPES.includes(type)) {
      errors.type = `type must be one of: ${VALID_ALERT_TYPES.join(', ')}`;
    }

    if (isRead !== undefined && !['true', 'false'].includes(isRead)) {
      errors.isRead = 'isRead must be true or false';
    }

    if (page !== undefined) {
      const n = parseInt(page, 10);
      if (!Number.isInteger(n) || n < 1) {
        errors.page = 'page must be a positive integer';
      }
    }

    if (limit !== undefined) {
      const n = parseInt(limit, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        errors.limit = 'limit must be between 1 and 100';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Alert query validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = { validateGetAlerts };