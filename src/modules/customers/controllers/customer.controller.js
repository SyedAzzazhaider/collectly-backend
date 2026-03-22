'use strict';

const customerService = require('../services/customer.service');
const AppError        = require('../../../shared/errors/AppError');
const { createAuditLog, auditFromReq } = require('../../../shared/utils/audit.util');

const sendSuccess = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ status: 'success', message, data });

const parsePageParams = (query, next) => {
  const rawPage  = parseInt(query.page,  10);
  const rawLimit = parseInt(query.limit, 10);

  if (query.page !== undefined && (!Number.isInteger(rawPage) || rawPage < 1)) {
    return null;
  }
  if (query.limit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) {
    return null;
  }

  return {
    page:  query.page  !== undefined ? rawPage  : 1,
    limit: query.limit !== undefined ? rawLimit : 20,
  };
};

// ── POST /customers ───────────────────────────────────────────────────────────

const createCustomer = async (req, res, next) => {
  try {
    const customer = await customerService.createCustomer(req.user.id, req.body);
    
    await createAuditLog('customer.create', {
      ...auditFromReq(req),
      userId:       req.user.id,
      resourceType: 'customer',
      resourceId:   customer._id || customer?.customer?._id,
    });
    
    sendSuccess(res, 201, 'Customer created successfully.', { customer });
  } catch (err) { next(err); }
};

// ── GET /customers ────────────────────────────────────────────────────────────

const getCustomers = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }

    const result = await customerService.getCustomers(req.user.id, {
      page:     pagination.page,
      limit:    pagination.limit,
      search:   req.query.search   || null,
      tags:     req.query.tags     || null,
      isActive: req.query.isActive ?? null,
    });

    sendSuccess(res, 200, 'Customers retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /customers/:id ────────────────────────────────────────────────────────

const getCustomerById = async (req, res, next) => {
  try {
    const customer = await customerService.getCustomerById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Customer retrieved.', { customer });
  } catch (err) { next(err); }
};

// ── GET /customers/:id/summary ────────────────────────────────────────────────

const getCustomerSummary = async (req, res, next) => {
  try {
    const result = await customerService.getCustomerSummary(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Customer summary retrieved.', result);
  } catch (err) { next(err); }
};

// ── PATCH /customers/:id ──────────────────────────────────────────────────────

const updateCustomer = async (req, res, next) => {
  try {
    const customer = await customerService.updateCustomer(req.user.id, req.params.id, req.body);
    sendSuccess(res, 200, 'Customer updated successfully.', { customer });
  } catch (err) { next(err); }
};

// ── DELETE /customers/:id ─────────────────────────────────────────────────────

const deleteCustomer = async (req, res, next) => {
  try {
    const result = await customerService.deleteCustomer(req.user.id, req.params.id);
    
    await createAuditLog('customer.delete', {
      ...auditFromReq(req),
      userId:       req.user.id,
      resourceType: 'customer',
      resourceId:   req.params.id,
    });
    
    sendSuccess(res, 200, 'Customer deleted successfully.', result);
  } catch (err) { next(err); }
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  getCustomerSummary,
  updateCustomer,
  deleteCustomer,
};

