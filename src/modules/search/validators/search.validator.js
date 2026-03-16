'use strict';

const AppError = require('../../../shared/errors/AppError');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_INVOICE_STATUSES  = ['pending', 'paid', 'overdue', 'partial', 'cancelled'];
const VALID_SORT_FIELDS       = ['dueDate', 'amount', 'createdAt', 'invoiceNumber', 'name'];
const VALID_SORT_ORDERS       = ['asc', 'desc'];
const VALID_ENTITY_TYPES      = ['invoices', 'customers', 'all'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const isValidISODate = (str) => {
  const d = new Date(str);
  return !isNaN(d.getTime());
};

// ── Validate global search ────────────────────────────────────────────────────

const validateSearch = (req, res, next) => {
  try {
    const {
      q, type, status, tags,
      dueDateFrom, dueDateTo,
      sortBy, sortOrder,
      page, limit,
    } = req.query;

    const errors = {};

    // q is required and must be at least 1 character
    if (q !== undefined && typeof q === 'string' && q.trim().length === 0) {
      errors.q = 'Search query cannot be empty';
    }

    // Protect against ReDoS — limit query length
    if (q && q.length > 200) {
      errors.q = 'Search query must be at most 200 characters';
    }

    if (type !== undefined && !VALID_ENTITY_TYPES.includes(type)) {
      errors.type = `type must be one of: ${VALID_ENTITY_TYPES.join(', ')}`;
    }

    if (status !== undefined && !VALID_INVOICE_STATUSES.includes(status)) {
      errors.status = `status must be one of: ${VALID_INVOICE_STATUSES.join(', ')}`;
    }

    if (tags !== undefined) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.length > 20) {
        errors.tags = 'Maximum 20 tags allowed';
      }
      if (tagArray.some((t) => typeof t !== 'string' || t.length > 50)) {
        errors.tags = 'Each tag must be a string of at most 50 characters';
      }
    }

    if (dueDateFrom !== undefined && !isValidISODate(dueDateFrom)) {
      errors.dueDateFrom = 'dueDateFrom must be a valid ISO 8601 date';
    }

    if (dueDateTo !== undefined) {
      if (!isValidISODate(dueDateTo)) {
        errors.dueDateTo = 'dueDateTo must be a valid ISO 8601 date';
      } else if (dueDateFrom && isValidISODate(dueDateFrom) && new Date(dueDateTo) < new Date(dueDateFrom)) {
        errors.dueDateTo = 'dueDateTo must be on or after dueDateFrom';
      }
    }

    if (sortBy !== undefined && !VALID_SORT_FIELDS.includes(sortBy)) {
      errors.sortBy = `sortBy must be one of: ${VALID_SORT_FIELDS.join(', ')}`;
    }

    if (sortOrder !== undefined && !VALID_SORT_ORDERS.includes(sortOrder)) {
      errors.sortOrder = `sortOrder must be one of: ${VALID_SORT_ORDERS.join(', ')}`;
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
      return next(validationError('Search validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate invoice filters (standalone filter endpoint) ─────────────────────

const validateInvoiceFilters = (req, res, next) => {
  try {
    const { status, tags, dueDateFrom, dueDateTo, page, limit } = req.query;
    const errors = {};

    if (status !== undefined && !VALID_INVOICE_STATUSES.includes(status)) {
      errors.status = `status must be one of: ${VALID_INVOICE_STATUSES.join(', ')}`;
    }

    if (tags !== undefined) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      if (tagArray.length > 20) errors.tags = 'Maximum 20 tags allowed';
    }

    if (dueDateFrom !== undefined && !isValidISODate(dueDateFrom)) {
      errors.dueDateFrom = 'dueDateFrom must be a valid ISO 8601 date';
    }

    if (dueDateTo !== undefined) {
      if (!isValidISODate(dueDateTo)) {
        errors.dueDateTo = 'dueDateTo must be a valid ISO 8601 date';
      } else if (dueDateFrom && isValidISODate(dueDateFrom) && new Date(dueDateTo) < new Date(dueDateFrom)) {
        errors.dueDateTo = 'dueDateTo must be on or after dueDateFrom';
      }
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
      return next(validationError('Filter validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateSearch,
  validateInvoiceFilters,
  VALID_INVOICE_STATUSES,
  VALID_SORT_FIELDS,
  VALID_SORT_ORDERS,
};