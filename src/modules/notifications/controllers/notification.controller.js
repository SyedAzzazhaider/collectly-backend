'use strict';

const notificationService = require('../services/notification.service');
const deliveryService     = require('../services/delivery.service');
const AppError            = require('../../../shared/errors/AppError');

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

// ── POST /notifications/send ──────────────────────────────────────────────────

const send = async (req, res, next) => {
  try {
    const notification = await deliveryService.sendNotification(req.user.id, req.body);
    sendSuccess(res, 201, 'Notification sent successfully.', { notification });
  } catch (err) { next(err); }
};

// ── POST /notifications/send-bulk ─────────────────────────────────────────────

const sendBulk = async (req, res, next) => {
  try {
    const { notifications } = req.body;
    const result = await deliveryService.sendBulkNotifications(req.user.id, notifications);
    sendSuccess(res, 200, 'Bulk notifications processed.', result);
  } catch (err) { next(err); }
};

// ── GET /notifications ────────────────────────────────────────────────────────

const getNotifications = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await notificationService.getNotifications(req.user.id, {
      page:       pagination.page,
      limit:      pagination.limit,
      channel:    req.query.channel    || null,
      status:     req.query.status     || null,
      invoiceId:  req.query.invoiceId  || null,
      customerId: req.query.customerId || null,
      type:       req.query.type       || null,
    });
    sendSuccess(res, 200, 'Notifications retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /notifications/stats ──────────────────────────────────────────────────

const getStats = async (req, res, next) => {
  try {
    const stats = await notificationService.getNotificationStats(req.user.id);
    sendSuccess(res, 200, 'Notification statistics retrieved.', { stats });
  } catch (err) { next(err); }
};

// ── GET /notifications/delivery-stats ────────────────────────────────────────

const getDeliveryStats = async (req, res, next) => {
  try {
    const stats = await deliveryService.getDeliveryStats(req.user.id);
    sendSuccess(res, 200, 'Delivery statistics retrieved.', { stats });
  } catch (err) { next(err); }
};

// ── GET /notifications/invoice/:invoiceId ─────────────────────────────────────

const getInvoiceNotifications = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await notificationService.getInvoiceNotifications(
      req.user.id,
      req.params.invoiceId,
      pagination
    );
    sendSuccess(res, 200, 'Invoice notifications retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /notifications/:id ────────────────────────────────────────────────────

const getNotificationById = async (req, res, next) => {
  try {
    const notification = await notificationService.getNotificationById(
      req.user.id,
      req.params.id
    );
    sendSuccess(res, 200, 'Notification retrieved.', { notification });
  } catch (err) { next(err); }
};

// ── POST /notifications/:id/cancel ────────────────────────────────────────────

const cancelNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.cancelNotification(
      req.user.id,
      req.params.id
    );
    sendSuccess(res, 200, 'Notification cancelled.', { notification });
  } catch (err) { next(err); }
};

// ── POST /notifications/:id/retry ─────────────────────────────────────────────

const retryNotification = async (req, res, next) => {
  try {
    const notification = await notificationService.getNotificationById(
      req.user.id,
      req.params.id
    );

    if (notification.status === 'sent' || notification.status === 'delivered') {
      return next(new AppError(
        'Notification already delivered successfully.',
        400,
        'NOTIFICATION_ALREADY_DELIVERED'
      ));
    }

    if (notification.status === 'cancelled') {
      return next(new AppError(
        'Cannot retry a cancelled notification.',
        400,
        'NOTIFICATION_CANCELLED'
      ));
    }

    if (notification.attemptCount >= notification.maxAttempts) {
      return next(new AppError(
        `Maximum retry attempts (${notification.maxAttempts}) already reached.`,
        400,
        'MAX_RETRIES_REACHED'
      ));
    }

    notification.status      = 'pending';
    notification.nextRetryAt = new Date();
    await notification.save();

    const result = await deliveryService.executeDelivery(notification);
    sendSuccess(res, 200, 'Notification retry dispatched.', { notification: result });
  } catch (err) { next(err); }
};

// ── POST /notifications/retry-failed (admin only) ─────────────────────────────

const retryFailedBatch = async (req, res, next) => {
  try {
    const batchSize = parseInt(req.body.batchSize, 10) || 50;
    if (batchSize < 1 || batchSize > 500) {
      return next(new AppError('Batch size must be between 1 and 500.', 400, 'INVALID_BATCH_SIZE'));
    }
    const result = await deliveryService.retryFailedNotifications(batchSize);
    sendSuccess(res, 200, 'Retry batch completed.', result);
  } catch (err) { next(err); }
};

// ── GET /notifications/admin (admin only) ─────────────────────────────────────

const getAllNotificationsAdmin = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await notificationService.getAllNotificationsAdmin({
      page:    pagination.page,
      limit:   pagination.limit,
      status:  req.query.status  || null,
      channel: req.query.channel || null,
    });
    sendSuccess(res, 200, 'All notifications retrieved.', result);
  } catch (err) { next(err); }
};

module.exports = {
  send,
  sendBulk,
  getNotifications,
  getStats,
  getDeliveryStats,
  getInvoiceNotifications,
  getNotificationById,
  cancelNotification,
  retryNotification,
  retryFailedBatch,
  getAllNotificationsAdmin,
};

