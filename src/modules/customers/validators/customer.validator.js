'use strict';

const AppError = require('../../../shared/errors/AppError');

const VALID_CHANNELS  = ['email', 'sms', 'whatsapp', 'in-app'];
const EMAIL_REGEX     = /^\S+@\S+\.\S+$/;
const PHONE_REGEX     = /^\+?[\d\s\-().]{7,20}$/;

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const sanitize = (v) => (typeof v === 'string' ? v.trim() : v);

// ── Create / Update Customer ──────────────────────────────────────────────────

const validateCreateCustomer = (req, res, next) => {
  try {
    const { name, email, phone, company, timezone, preferences, tags } = req.body;
    const errors = {};

    if (!name || sanitize(name).length < 2) {
      errors.name = 'Customer name is required and must be at least 2 characters';
    } else if (sanitize(name).length > 100) {
      errors.name = 'Name must be at most 100 characters';
    }

    if (!email) {
      errors.email = 'Customer email is required';
    } else if (!EMAIL_REGEX.test(sanitize(email).toLowerCase())) {
      errors.email = 'Please provide a valid email address';
    }

    if (phone && !PHONE_REGEX.test(sanitize(phone))) {
      errors.phone = 'Please provide a valid phone number';
    }

    if (company && sanitize(company).length > 150) {
      errors.company = 'Company name must be at most 150 characters';
    }

    if (timezone && typeof timezone !== 'string') {
      errors.timezone = 'Timezone must be a string';
    }

    if (preferences?.channels) {
      if (!Array.isArray(preferences.channels)) {
        errors['preferences.channels'] = 'Channels must be an array';
      } else {
        const invalid = preferences.channels.filter((c) => !VALID_CHANNELS.includes(c));
        if (invalid.length > 0) {
          errors['preferences.channels'] = `Invalid channels: ${invalid.join(', ')}. Valid: ${VALID_CHANNELS.join(', ')}`;
        }
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      } else if (tags.some((t) => typeof t !== 'string' || t.length > 50)) {
        errors.tags = 'Each tag must be a string of at most 50 characters';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Customer validation failed', errors));
    }

    // Sanitize
    req.body.name  = sanitize(name);
    req.body.email = sanitize(email).toLowerCase();
    if (phone)   req.body.phone   = sanitize(phone);
    if (company) req.body.company = sanitize(company);

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

const validateUpdateCustomer = (req, res, next) => {
  try {
    const { name, email, phone, company, tags, preferences } = req.body;
    const errors = {};

    if (name !== undefined) {
      if (sanitize(name).length < 2)   errors.name = 'Name must be at least 2 characters';
      if (sanitize(name).length > 100) errors.name = 'Name must be at most 100 characters';
    }

    if (email !== undefined) {
      if (!EMAIL_REGEX.test(sanitize(email).toLowerCase())) {
        errors.email = 'Please provide a valid email address';
      }
    }

    if (phone !== undefined && phone !== null) {
      if (!PHONE_REGEX.test(sanitize(phone))) {
        errors.phone = 'Please provide a valid phone number';
      }
    }

    if (company !== undefined && sanitize(company).length > 150) {
      errors.company = 'Company name must be at most 150 characters';
    }

    if (preferences?.channels) {
      if (!Array.isArray(preferences.channels)) {
        errors['preferences.channels'] = 'Channels must be an array';
      } else {
        const invalid = preferences.channels.filter((c) => !VALID_CHANNELS.includes(c));
        if (invalid.length > 0) {
          errors['preferences.channels'] = `Invalid channels: ${invalid.join(', ')}`;
        }
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      } else if (tags.some((t) => typeof t !== 'string' || t.length > 50)) {
        errors.tags = 'Each tag must be a string of at most 50 characters';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Customer update validation failed', errors));
    }

    if (name)  req.body.name  = sanitize(name);
    if (email) req.body.email = sanitize(email).toLowerCase();

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = { validateCreateCustomer, validateUpdateCustomer };