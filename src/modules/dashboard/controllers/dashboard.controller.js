'use strict';

const customerDashboardService = require('../services/customerDashboard.service');
const agentDashboardService    = require('../services/agentDashboard.service');
const adminDashboardService    = require('../services/adminDashboard.service');
const AppError                 = require('../../../shared/errors/AppError');

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

const getCustomerDashboard = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await customerDashboardService.getCustomerDashboard(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
      days:     req.query.days     || 30,
      page:     pagination.page,
      limit:    pagination.limit,
    });
    sendSuccess(res, 200, 'Customer dashboard retrieved.', result);
  } catch (err) { next(err); }
};

const getUpcomingDues = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await customerDashboardService.getUpcomingDues(req.user.id, {
      days:  req.query.days || 30,
      page:  pagination.page,
      limit: pagination.limit,
    });
    sendSuccess(res, 200, 'Upcoming dues retrieved.', result);
  } catch (err) { next(err); }
};

const getReminderHistory = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await customerDashboardService.getReminderHistory(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
      page:     pagination.page,
      limit:    pagination.limit,
    });
    sendSuccess(res, 200, 'Reminder history retrieved.', result);
  } catch (err) { next(err); }
};

const getResponseRate = async (req, res, next) => {
  try {
    const result = await customerDashboardService.getResponseRate(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Response rate retrieved.', result);
  } catch (err) { next(err); }
};

const getAgentDashboard = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await agentDashboardService.getAgentDashboard(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
      sortBy:   req.query.sortBy   || 'dueDate',
      page:     pagination.page,
      limit:    pagination.limit,
    });
    sendSuccess(res, 200, 'Agent dashboard retrieved.', result);
  } catch (err) { next(err); }
};

const getOverdueList = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await agentDashboardService.getOverdueList(req.user.id, {
      page:   pagination.page,
      limit:  pagination.limit,
      sortBy: req.query.sortBy || 'dueDate',
    });
    sendSuccess(res, 200, 'Overdue list retrieved.', result);
  } catch (err) { next(err); }
};

const getPaymentHistory = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await agentDashboardService.getPaymentHistory(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
      page:     pagination.page,
      limit:    pagination.limit,
    });
    sendSuccess(res, 200, 'Payment history retrieved.', result);
  } catch (err) { next(err); }
};

const getPriorityQueue = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    const result = await agentDashboardService.getPriorityQueue(req.user.id, {
      page:  pagination.page,
      limit: pagination.limit,
    });
    sendSuccess(res, 200, 'Priority queue retrieved.', result);
  } catch (err) { next(err); }
};

const getRecoveryRate = async (req, res, next) => {
  try {
    const result = await agentDashboardService.getRecoveryRate(req.user.id, {
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Recovery rate retrieved.', result);
  } catch (err) { next(err); }
};

const getAdminDashboard = async (req, res, next) => {
  try {
    const result = await adminDashboardService.getAdminDashboard({
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Admin dashboard retrieved.', result);
  } catch (err) { next(err); }
};

const getSubscriptionsOverview = async (req, res, next) => {
  try {
    const result = await adminDashboardService.getSubscriptionsOverview({
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Subscriptions overview retrieved.', result);
  } catch (err) { next(err); }
};

const getNotificationsSent = async (req, res, next) => {
  try {
    const result = await adminDashboardService.getNotificationsSent({
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Notifications sent stats retrieved.', result);
  } catch (err) { next(err); }
};

const getBillingUsage = async (req, res, next) => {
  try {
    const result = await adminDashboardService.getBillingUsage({
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'Billing usage retrieved.', result);
  } catch (err) { next(err); }
};

const getSlaPerformance = async (req, res, next) => {
  try {
    const result = await adminDashboardService.getSlaPerformance({
      period:   req.query.period   || '30d',
      dateFrom: req.query.dateFrom || undefined,
      dateTo:   req.query.dateTo   || undefined,
    });
    sendSuccess(res, 200, 'SLA performance retrieved.', result);
  } catch (err) { next(err); }
};

module.exports = {
  getCustomerDashboard,
  getUpcomingDues,
  getReminderHistory,
  getResponseRate,
  getAgentDashboard,
  getOverdueList,
  getPaymentHistory,
  getPriorityQueue,
  getRecoveryRate,
  getAdminDashboard,
  getSubscriptionsOverview,
  getNotificationsSent,
  getBillingUsage,
  getSlaPerformance,
};
