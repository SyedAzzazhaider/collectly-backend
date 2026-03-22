'use strict';

const searchService = require('../services/search.service');
const AppError      = require('../../../shared/errors/AppError');

const sendSuccess = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ status: 'success', message, data });

const parsePageParams = (query) => {
  const rawPage  = parseInt(query.page,  10);
  const rawLimit = parseInt(query.limit, 10);
  if (query.page  !== undefined && (!Number.isInteger(rawPage)  || rawPage  < 1)) return null;
  if (query.limit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) return null;
  return {
    page:  query.page  !== undefined ? rawPage  : 1,
    limit: query.limit !== undefined ? rawLimit : 20,
  };
};

// ── GET /search ───────────────────────────────────────────────────────────────

const globalSearch = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await searchService.globalSearch(req.user.id, {
      q:           req.query.q           || null,
      type:        req.query.type        || 'all',
      status:      req.query.status      || null,
      tags:        req.query.tags        || null,
      dueDateFrom: req.query.dueDateFrom || null,
      dueDateTo:   req.query.dueDateTo   || null,
      sortBy:      req.query.sortBy      || 'createdAt',
      sortOrder:   req.query.sortOrder   || 'desc',
      page:        pagination.page,
      limit:       pagination.limit,
    });
    sendSuccess(res, 200, 'Search results retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /search/invoices ──────────────────────────────────────────────────────

const searchInvoices = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await searchService.searchInvoices(req.user.id, {
      q:           req.query.q           || null,
      status:      req.query.status      || null,
      tags:        req.query.tags        || null,
      dueDateFrom: req.query.dueDateFrom || null,
      dueDateTo:   req.query.dueDateTo   || null,
      sortBy:      req.query.sortBy      || 'createdAt',
      sortOrder:   req.query.sortOrder   || 'desc',
      page:        pagination.page,
      limit:       pagination.limit,
    });
    sendSuccess(res, 200, 'Invoice search results retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /search/customers ─────────────────────────────────────────────────────

const searchCustomers = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await searchService.searchCustomers(req.user.id, {
      q:         req.query.q         || null,
      tags:      req.query.tags      || null,
      isActive:  req.query.isActive  ?? null,
      sortBy:    req.query.sortBy    || 'createdAt',
      sortOrder: req.query.sortOrder || 'desc',
      page:      pagination.page,
      limit:     pagination.limit,
    });
    sendSuccess(res, 200, 'Customer search results retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /search/invoices/filter ───────────────────────────────────────────────

const filterInvoices = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await searchService.filterInvoices(req.user.id, {
      status:      req.query.status      || null,
      tags:        req.query.tags        || null,
      dueDateFrom: req.query.dueDateFrom || null,
      dueDateTo:   req.query.dueDateTo   || null,
      customerId:  req.query.customerId  || null,
      sortBy:      req.query.sortBy      || 'dueDate',
      sortOrder:   req.query.sortOrder   || 'asc',
      page:        pagination.page,
      limit:       pagination.limit,
    });
    sendSuccess(res, 200, 'Invoice filter results retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /search/tags ──────────────────────────────────────────────────────────

const getAvailableTags = async (req, res, next) => {
  try {
    const result = await searchService.getAvailableTags(req.user.id);
    sendSuccess(res, 200, 'Available tags retrieved.', result);
  } catch (err) { next(err); }
};

module.exports = {
  globalSearch,
  searchInvoices,
  searchCustomers,
  filterInvoices,
  getAvailableTags,
};

