'use strict';

const invoiceService = require('../services/invoice.service');
const AppError       = require('../../../shared/errors/AppError');

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

// ── POST /invoices ────────────────────────────────────────────────────────────

const createInvoice = async (req, res, next) => {
  try {
    const invoice = await invoiceService.createInvoice(req.user.id, req.body);
    sendSuccess(res, 201, 'Invoice created successfully.', { invoice });
  } catch (err) { next(err); }
};

// ── GET /invoices ─────────────────────────────────────────────────────────────

const getInvoices = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }

    const result = await invoiceService.getInvoices(req.user.id, {
      page:        pagination.page,
      limit:       pagination.limit,
      status:      req.query.status      || null,
      customerId:  req.query.customerId  || null,
      search:      req.query.search      || null,
      tags:        req.query.tags        || null,
      dueDateFrom: req.query.dueDateFrom || null,
      dueDateTo:   req.query.dueDateTo   || null,
    });

    sendSuccess(res, 200, 'Invoices retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /invoices/overdue ─────────────────────────────────────────────────────

const getOverdueInvoices = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }

    const result = await invoiceService.getOverdueInvoices(req.user.id, pagination);
    sendSuccess(res, 200, 'Overdue invoices retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /invoices/:id ─────────────────────────────────────────────────────────

const getInvoiceById = async (req, res, next) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Invoice retrieved.', { invoice });
  } catch (err) { next(err); }
};

// ── PATCH /invoices/:id ───────────────────────────────────────────────────────

const updateInvoice = async (req, res, next) => {
  try {
    const invoice = await invoiceService.updateInvoice(req.user.id, req.params.id, req.body);
    sendSuccess(res, 200, 'Invoice updated successfully.', { invoice });
  } catch (err) { next(err); }
};

// ── DELETE /invoices/:id ──────────────────────────────────────────────────────

const deleteInvoice = async (req, res, next) => {
  try {
    const result = await invoiceService.deleteInvoice(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Invoice deleted successfully.', result);
  } catch (err) { next(err); }
};

// ── POST /invoices/:id/payment ────────────────────────────────────────────────

const recordPayment = async (req, res, next) => {
  try {
    const invoice = await invoiceService.recordPayment(
      req.user.id,
      req.params.id,
      req.body.amount
    );
    sendSuccess(res, 200, 'Payment recorded successfully.', { invoice });
  } catch (err) { next(err); }
};

module.exports = {
  createInvoice,
  getInvoices,
  getOverdueInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  recordPayment,
};