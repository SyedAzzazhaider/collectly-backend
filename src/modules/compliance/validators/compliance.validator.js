'use strict';

const AppError = require('../../../shared/errors/AppError');
const { VALID_CONSENT_TYPES } = require('../models/ConsentLog.model');
const { VALID_DNC_CHANNELS, VALID_DNC_REASONS } = require('../models/DncList.model');
const { VALID_EXPORT_TYPES } = require('../models/DataExportRequest.model');

// ── Helpers ───────────────────────────────────────────────────────────────────

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const isValidObjId = (id) => /^[a-f\d]{24}$/i.test(String(id));

// ── Validate consent update ───────────────────────────────────────────────────

const validateUpdateConsent = (req, res, next) => {
  try {
    const { consentType, granted, source, notes } = req.body;
    const errors = {};

    if (!consentType || !VALID_CONSENT_TYPES.includes(consentType)) {
      errors.consentType = `consentType must be one of: ${VALID_CONSENT_TYPES.join(', ')}`;
    }

    if (granted === undefined || granted === null) {
      errors.granted = 'granted is required (true or false)';
    } else if (typeof granted !== 'boolean') {
      errors.granted = 'granted must be a boolean';
    }

    if (source !== undefined && !['api', 'admin', 'import'].includes(source)) {
      errors.source = 'source must be one of: api, admin, import';
    }

    if (notes !== undefined && String(notes).length > 500) {
      errors.notes = 'notes must be at most 500 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Consent validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate get consent history ──────────────────────────────────────────────

const validateGetConsentHistory = (req, res, next) => {
  try {
    const { consentType, page, limit } = req.query;
    const errors = {};

    if (consentType !== undefined && !VALID_CONSENT_TYPES.includes(consentType)) {
      errors.consentType = `consentType must be one of: ${VALID_CONSENT_TYPES.join(', ')}`;
    }

    if (page !== undefined) {
      const n = parseInt(page, 10);
      if (!Number.isInteger(n) || n < 1) errors.page = 'page must be a positive integer';
    }

    if (limit !== undefined) {
      const n = parseInt(limit, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) errors.limit = 'limit must be between 1 and 100';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Query validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate add to DNC ───────────────────────────────────────────────────────

const validateAddToDnc = (req, res, next) => {
  try {
    const { customerId, channels, reason, notes } = req.body;
    const errors = {};

    if (!customerId || !isValidObjId(customerId)) {
      errors.customerId = 'customerId must be a valid ID';
    }

    if (channels !== undefined) {
      if (!Array.isArray(channels)) {
        errors.channels = 'channels must be an array';
      } else if (channels.length === 0) {
        errors.channels = 'At least one channel is required';
      } else {
        const invalid = channels.filter((c) => !VALID_DNC_CHANNELS.includes(c));
        if (invalid.length > 0) {
          errors.channels = `Invalid channels: ${invalid.join(', ')}. Valid: ${VALID_DNC_CHANNELS.join(', ')}`;
        }
      }
    }

    if (reason !== undefined && !VALID_DNC_REASONS.includes(reason)) {
      errors.reason = `reason must be one of: ${VALID_DNC_REASONS.join(', ')}`;
    }

    if (notes !== undefined && String(notes).length > 1000) {
      errors.notes = 'notes must be at most 1000 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('DNC validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate DNC list query ───────────────────────────────────────────────────

const validateGetDncList = (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const errors = {};

    if (page !== undefined) {
      const n = parseInt(page, 10);
      if (!Number.isInteger(n) || n < 1) errors.page = 'page must be a positive integer';
    }

    if (limit !== undefined) {
      const n = parseInt(limit, 10);
      if (!Number.isInteger(n) || n < 1 || n > 100) errors.limit = 'limit must be between 1 and 100';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Query validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate data export request ──────────────────────────────────────────────

const validateRequestExport = (req, res, next) => {
  try {
    const { exportType, customerId } = req.body;
    const errors = {};

    if (exportType !== undefined && !VALID_EXPORT_TYPES.includes(exportType)) {
      errors.exportType = `exportType must be one of: ${VALID_EXPORT_TYPES.join(', ')}`;
    }

    if (exportType === 'customer_data') {
      if (!customerId || !isValidObjId(customerId)) {
        errors.customerId = 'customerId is required for customer_data export';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Export request validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate unsubscribe token ────────────────────────────────────────────────

const validateUnsubscribe = (req, res, next) => {
  try {
    const { customerId } = req.params;
    const { token }      = req.query;

    const errors = {};

    // Validate customerId is a valid MongoDB ObjectId
    if (!customerId || !/^[a-fA-F0-9]{24}$/.test(customerId)) {
      errors.customerId = 'Invalid customer ID';
    }

    // Token is required — any non-empty string is accepted here.
    // The service layer verifies the HMAC value — the validator only checks presence.
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      // Return 400 (not 422) for missing token — matches test expectations
      const err = new AppError('Unsubscribe token is required.', 400, 'MISSING_TOKEN');
      return next(err);
    }

    if (Object.keys(errors).length > 0) {
      const err = new AppError('Invalid unsubscribe request.', 400, 'VALIDATION_ERROR');
      err.fields = errors;
      return next(err);
    }

    next();
  } catch {
    next(new AppError('Validation error', 400));
  }
};

module.exports = {
  validateUpdateConsent,
  validateGetConsentHistory,
  validateAddToDnc,
  validateGetDncList,
  validateRequestExport,
  validateUnsubscribe,
};

