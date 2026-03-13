'use strict';

const billingService = require('../services/billing.service');
const AppError       = require('../../../shared/errors/AppError');
const logger         = require('../../../shared/utils/logger');

const sendSuccess = (res, statusCode, message, data = {}) => {
  res.status(statusCode).json({ status: 'success', message, data });
};

const getPlans = async (req, res, next) => {
  try {
    const plans = billingService.getPlans();
    sendSuccess(res, 200, 'Plans retrieved successfully.', { plans });
  } catch (err) { next(err); }
};

const getBilling = async (req, res, next) => {
  try {
    const billing = await billingService.getBilling(req.user.id);
    sendSuccess(res, 200, 'Billing record retrieved.', { billing });
  } catch (err) { next(err); }
};

const subscribe = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const billing  = await billingService.subscribe(req.user.id, plan);
    sendSuccess(res, 200, `Successfully subscribed to the ${plan} plan.`, { billing });
  } catch (err) { next(err); }
};

const changePlan = async (req, res, next) => {
  try {
    const { plan } = req.body;
    const billing  = await billingService.changePlan(req.user.id, plan);
    sendSuccess(res, 200, `Plan changed to ${plan} successfully.`, { billing });
  } catch (err) { next(err); }
};

const cancelSubscription = async (req, res, next) => {
  try {
    const billing = await billingService.cancelSubscription(req.user.id);
    sendSuccess(res, 200, 'Subscription will be cancelled at the end of the current billing period.', { billing });
  } catch (err) { next(err); }
};

const reactivateSubscription = async (req, res, next) => {
  try {
    const billing = await billingService.reactivateSubscription(req.user.id);
    sendSuccess(res, 200, 'Subscription reactivated successfully.', { billing });
  } catch (err) { next(err); }
};

const getUsage = async (req, res, next) => {
  try {
    const usage = await billingService.getUsage(req.user.id);
    sendSuccess(res, 200, 'Usage metrics retrieved.', { usage });
  } catch (err) { next(err); }
};

const incrementUsage = async (req, res, next) => {
  try {
    const { channel, count = 1 } = req.body;
    const result = await billingService.incrementUsage(req.user.id, channel, Number(count));
    sendSuccess(res, 200, 'Usage incremented.', result);
  } catch (err) { next(err); }
};

const getInvoiceHistory = async (req, res, next) => {
  try {
    const invoices = await billingService.getInvoiceHistory(req.user.id);
    sendSuccess(res, 200, 'Invoice history retrieved.', { invoices });
  } catch (err) { next(err); }
};

const stripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature'];
    const result    = await billingService.handleStripeWebhook(req.rawBody, signature);
    res.status(200).json(result);
  } catch (err) {
    logger.error(`Stripe webhook error: ${err.message}`);
    next(err);
  }
};

const getAllBillingAdmin = async (req, res, next) => {
  try {
    // Parse raw query values as integers explicitly
    const rawPage  = parseInt(req.query.page,  10);
    const rawLimit = parseInt(req.query.limit, 10);

    // Validate explicitly provided values before applying defaults
    if (req.query.page !== undefined) {
      if (!Number.isInteger(rawPage) || rawPage < 1) {
        return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
      }
    }
    if (req.query.limit !== undefined) {
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
        return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
      }
    }

    const page   = req.query.page  !== undefined ? rawPage  : 1;
    const limit  = req.query.limit !== undefined ? rawLimit : 20;
    const status = req.query.status || null;
    const plan   = req.query.plan   || null;

    const result = await billingService.getAllBillingAdmin({ page, limit, status, plan });
    sendSuccess(res, 200, 'Billing records retrieved.', result);
  } catch (err) { next(err); }
};

module.exports = {
  getPlans,
  getBilling,
  subscribe,
  changePlan,
  cancelSubscription,
  reactivateSubscription,
  getUsage,
  incrementUsage,
  getInvoiceHistory,
  stripeWebhook,
  getAllBillingAdmin,
};
