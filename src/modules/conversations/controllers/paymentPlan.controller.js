'use strict';

const paymentPlanService = require('../services/paymentPlan.service');
const AppError = require('../../../shared/errors/AppError');

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

// ── POST /conversations/payment-plans ─────────────────────────────────────────

const create = async (req, res, next) => {
  try {
    const plan = await paymentPlanService.createPaymentPlan(req.user.id, req.body);
    sendSuccess(res, 201, 'Payment plan created successfully.', { plan });
  } catch (err) { next(err); }
};

// ── GET /conversations/payment-plans ─────────────────────────────────────────

const getAll = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await paymentPlanService.getPaymentPlans(req.user.id, {
      page:       pagination.page,
      limit:      pagination.limit,
      status:     req.query.status     || null,
      customerId: req.query.customerId || null,
      invoiceId:  req.query.invoiceId  || null,
    });
    sendSuccess(res, 200, 'Payment plans retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /conversations/payment-plans/:id ─────────────────────────────────────

const getById = async (req, res, next) => {
  try {
    const plan = await paymentPlanService.getPaymentPlanById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Payment plan retrieved.', { plan });
  } catch (err) { next(err); }
};

// ── POST /conversations/payment-plans/:id/accept ─────────────────────────────

const accept = async (req, res, next) => {
  try {
    const plan = await paymentPlanService.acceptPaymentPlan(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Payment plan accepted.', { plan });
  } catch (err) { next(err); }
};

// ── POST /conversations/payment-plans/:id/reject ─────────────────────────────

const reject = async (req, res, next) => {
  try {
    const { rejectionReason } = req.body;
    const plan = await paymentPlanService.rejectPaymentPlan(
      req.user.id, req.params.id, rejectionReason
    );
    sendSuccess(res, 200, 'Payment plan rejected.', { plan });
  } catch (err) { next(err); }
};

// ── POST /conversations/payment-plans/:id/cancel ─────────────────────────────

const cancel = async (req, res, next) => {
  try {
    const plan = await paymentPlanService.cancelPaymentPlan(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Payment plan cancelled.', { plan });
  } catch (err) { next(err); }
};

// ── POST /conversations/payment-plans/:id/installments/:number/pay ────────────

const recordPayment = async (req, res, next) => {
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) {
      return next(new AppError('Amount must be greater than 0.', 400, 'INVALID_AMOUNT'));
    }
    const plan = await paymentPlanService.recordInstallmentPayment(
      req.user.id,
      req.params.id,
      req.params.number,
      Number(amount)
    );
    sendSuccess(res, 200, 'Installment payment recorded.', { plan });
  } catch (err) { next(err); }
};

module.exports = { create, getAll, getById, accept, reject, cancel, recordPayment };