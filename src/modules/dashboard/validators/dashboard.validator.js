'use strict';

const AppError = require('../../../shared/errors/AppError');

const VALID_PERIODS  = ['7d', '30d', '90d', '1y'];
const VALID_SORT_BY  = ['dueDate', 'amount', 'priority'];
const MAX_DAYS_AHEAD = 365;

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const isValidISODate = (str) => {
  const d = new Date(str);
  return !isNaN(d.getTime());
};

const validateDateRangeParams = (query) => {
  const { period, dateFrom, dateTo } = query;
  const errors = {};
  if (period !== undefined && !VALID_PERIODS.includes(period)) {
    errors.period = `period must be one of: ${VALID_PERIODS.join(', ')}`;
  }
  if (dateFrom !== undefined && !isValidISODate(dateFrom)) {
    errors.dateFrom = 'dateFrom must be a valid ISO 8601 date';
  }
  if (dateTo !== undefined) {
    if (!isValidISODate(dateTo)) {
      errors.dateTo = 'dateTo must be a valid ISO 8601 date';
    } else if (dateFrom && isValidISODate(dateFrom) && new Date(dateTo) < new Date(dateFrom)) {
      errors.dateTo = 'dateTo must be on or after dateFrom';
    }
  }
  return errors;
};

const validatePaginationParams = (query) => {
  const errors = {};
  if (query.page !== undefined) {
    const n = parseInt(query.page, 10);
    if (!Number.isInteger(n) || n < 1) errors.page = 'page must be a positive integer';
  }
  if (query.limit !== undefined) {
    const n = parseInt(query.limit, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) errors.limit = 'limit must be between 1 and 100';
  }
  return errors;
};

const validateCustomerDashboard = (req, res, next) => {
  try {
    const errors = {
      ...validateDateRangeParams(req.query),
      ...validatePaginationParams(req.query),
    };
    if (req.query.days !== undefined) {
      const n = parseInt(req.query.days, 10);
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS_AHEAD) {
        errors.days = `days must be between 1 and ${MAX_DAYS_AHEAD}`;
      }
    }
    if (Object.keys(errors).length > 0) return next(validationError('Customer dashboard query validation failed', errors));
    next();
  } catch { next(new AppError('Validation error', 422)); }
};

const validateAgentDashboard = (req, res, next) => {
  try {
    const errors = {
      ...validateDateRangeParams(req.query),
      ...validatePaginationParams(req.query),
    };
    if (req.query.sortBy !== undefined && !VALID_SORT_BY.includes(req.query.sortBy)) {
      errors.sortBy = `sortBy must be one of: ${VALID_SORT_BY.join(', ')}`;
    }
    if (Object.keys(errors).length > 0) return next(validationError('Agent dashboard query validation failed', errors));
    next();
  } catch { next(new AppError('Validation error', 422)); }
};

const validateAdminDashboard = (req, res, next) => {
  try {
    const errors = {
      ...validateDateRangeParams(req.query),
      ...validatePaginationParams(req.query),
    };
    if (Object.keys(errors).length > 0) return next(validationError('Admin dashboard query validation failed', errors));
    next();
  } catch { next(new AppError('Validation error', 422)); }
};

module.exports = {
  validateCustomerDashboard,
  validateAgentDashboard,
  validateAdminDashboard,
};
