'use strict';

const alertService = require('../services/alert.service');
const AppError     = require('../../../shared/errors/AppError');

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

// ── GET /alerts ───────────────────────────────────────────────────────────────

const getAlerts = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await alertService.getAlerts(req.user.id, {
      page:   pagination.page,
      limit:  pagination.limit,
      type:   req.query.type   || null,
      isRead: req.query.isRead ?? null,
    });
    sendSuccess(res, 200, 'Alerts retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /alerts/unread-count ──────────────────────────────────────────────────

const getUnreadCount = async (req, res, next) => {
  try {
    const result = await alertService.getUnreadCount(req.user.id);
    sendSuccess(res, 200, 'Unread count retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /alerts/:id ───────────────────────────────────────────────────────────

const getAlertById = async (req, res, next) => {
  try {
    const alert = await alertService.getAlertById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Alert retrieved.', { alert });
  } catch (err) { next(err); }
};

// ── POST /alerts/:id/read ─────────────────────────────────────────────────────

const markAsRead = async (req, res, next) => {
  try {
    const alert = await alertService.markAsRead(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Alert marked as read.', { alert });
  } catch (err) { next(err); }
};

// ── POST /alerts/read-all ─────────────────────────────────────────────────────

const markAllAsRead = async (req, res, next) => {
  try {
    const result = await alertService.markAllAsRead(req.user.id);
    sendSuccess(res, 200, 'All alerts marked as read.', result);
  } catch (err) { next(err); }
};

// ── DELETE /alerts/:id ────────────────────────────────────────────────────────

const deleteAlert = async (req, res, next) => {
  try {
    const result = await alertService.deleteAlert(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Alert deleted.', result);
  } catch (err) { next(err); }
};

// ── POST /alerts/check-subscriptions (admin only) ────────────────────────────

const checkSubscriptionExpiry = async (req, res, next) => {
  try {
    const result = await alertService.checkSubscriptionExpiry();
    sendSuccess(res, 200, 'Subscription expiry check completed.', result);
  } catch (err) { next(err); }
};

module.exports = {
  getAlerts,
  getUnreadCount,
  getAlertById,
  markAsRead,
  markAllAsRead,
  deleteAlert,
  checkSubscriptionExpiry,
};