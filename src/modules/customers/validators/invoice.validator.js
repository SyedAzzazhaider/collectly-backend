'use strict';

const AppError = require('../../../shared/errors/AppError');

const VALID_STATUSES  = ['pending', 'paid', 'overdue', 'cancelled', 'partial'];
const VALID_CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'INR', 'AED', 'SAR', 'CAD', 'AUD'];

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const sanitize = (v) => (typeof v === 'string' ? v.trim() : v);

// ── Create Invoice ────────────────────────────────────────────────────────────

const validateCreateInvoice = (req, res, next) => {
  try {
    const { customerId, invoiceNumber, amount, currency, dueDate, tags, notes } = req.body;
    const errors = {};

    if (!customerId) {
      errors.customerId = 'Customer ID is required';
    } else if (!/^[a-f\d]{24}$/i.test(String(customerId))) {
      errors.customerId = 'Customer ID must be a valid ID';
    }

    if (!invoiceNumber || sanitize(String(invoiceNumber)).length === 0) {
      errors.invoiceNumber = 'Invoice number is required';
    } else if (sanitize(String(invoiceNumber)).length > 100) {
      errors.invoiceNumber = 'Invoice number must be at most 100 characters';
    }

    if (amount === undefined || amount === null) {
      errors.amount = 'Amount is required';
    } else {
      const n = Number(amount);
      if (isNaN(n) || n <= 0) {
        errors.amount = 'Amount must be a positive number';
      }
    }

    if (currency !== undefined) {
      if (!VALID_CURRENCIES.includes(String(currency).toUpperCase())) {
        errors.currency = `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`;
      }
    }

    if (!dueDate) {
      errors.dueDate = 'Due date is required';
    } else {
      const d = new Date(dueDate);
      if (isNaN(d.getTime())) {
        errors.dueDate = 'Due date must be a valid date';
      }
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      }
    }

    if (notes !== undefined && String(notes).length > 2000) {
      errors.notes = 'Notes must be at most 2000 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Invoice validation failed', errors));
    }

    req.body.invoiceNumber = sanitize(String(invoiceNumber));
    req.body.amount        = Number(amount);
    if (currency) req.body.currency = String(currency).toUpperCase();

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Update Invoice ────────────────────────────────────────────────────────────

const validateUpdateInvoice = (req, res, next) => {
  try {
    const { amount, currency, dueDate, status, amountPaid, tags, notes } = req.body;
    const errors = {};

    if (amount !== undefined) {
      const n = Number(amount);
      if (isNaN(n) || n <= 0) errors.amount = 'Amount must be a positive number';
    }

    if (currency !== undefined) {
      if (!VALID_CURRENCIES.includes(String(currency).toUpperCase())) {
        errors.currency = `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`;
      }
    }

    if (dueDate !== undefined) {
      const d = new Date(dueDate);
      if (isNaN(d.getTime())) errors.dueDate = 'Due date must be a valid date';
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      errors.status = `Status must be one of: ${VALID_STATUSES.join(', ')}`;
    }

    if (amountPaid !== undefined) {
      const n = Number(amountPaid);
      if (isNaN(n) || n < 0) errors.amountPaid = 'Amount paid must be a non-negative number';
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        errors.tags = 'Tags must be an array';
      } else if (tags.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      }
    }

    if (notes !== undefined && String(notes).length > 2000) {
      errors.notes = 'Notes must be at most 2000 characters';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Invoice update validation failed', errors));
    }

    if (amount)     req.body.amount     = Number(amount);
    if (amountPaid !== undefined) req.body.amountPaid = Number(amountPaid);
    if (currency)   req.body.currency   = String(currency).toUpperCase();

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Record Payment ────────────────────────────────────────────────────────────

const validateRecordPayment = (req, res, next) => {
  try {
    const { amount } = req.body;
    const errors     = {};

    if (amount === undefined || amount === null) {
      errors.amount = 'Payment amount is required';
    } else {
      const n = Number(amount);
      if (isNaN(n) || n <= 0) {
        errors.amount = 'Payment amount must be a positive number';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Payment validation failed', errors));
    }

    req.body.amount = Number(amount);
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateCreateInvoice,
  validateUpdateInvoice,
  validateRecordPayment,
};