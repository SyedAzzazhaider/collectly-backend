'use strict';

const { Notification } = require('../models/Notification.model');
const Invoice          = require('../../customers/models/Invoice.model');
const Customer         = require('../../customers/models/Customer.model');
const AppError         = require('../../../shared/errors/AppError');
const logger           = require('../../../shared/utils/logger');

// ✅ ADD THIS IMPORT
const complianceService = require('../../compliance/services/compliance.service');

// ── Create notification record with DNC check ─────────────────────────────────

const createNotification = async (userId, data) => {
  const {
    channel, type = 'payment_reminder', recipient,
    subject, body, invoiceId = null, customerId = null,
    sequenceId = null, phaseNumber = null,
    scheduledAt = null, maxAttempts = 3, metadata = {},
  } = data;

  // ✅ ADD DNC CHECK BEFORE CREATING NOTIFICATION
  if (customerId) {
    const { allowed, reason } = await complianceService.isDeliveryAllowed(userId, customerId, channel);
    
    if (!allowed) {
      logger.info(`Notification blocked: Customer ${customerId} - ${reason} for channel ${channel}`);
      throw new AppError(
        `Cannot send ${channel} notification. Customer is ${reason === 'on_dnc_list' ? 'on DNC list' : reason}.`,
        403,
        'COMMUNICATION_BLOCKED'
      );
    }
  }

  const notification = await Notification.create({
    userId,
    channel,
    type,
    status:    scheduledAt ? 'pending' : 'pending',
    recipient,
    subject:   subject || null,
    body,
    invoiceId,
    customerId,
    sequenceId,
    phaseNumber,
    scheduledAt,
    maxAttempts,
    metadata,
  });

  logger.info(`Notification created: ${notification._id} channel=${channel} userId=${userId}`);
  return notification;
};

// ── Get notifications for user ────────────────────────────────────────────────

const getNotifications = async (userId, {
  page      = 1,
  limit     = 20,
  channel   = null,
  status    = null,
  invoiceId = null,
  customerId = null,
  type      = null,
} = {}) => {
  const query = { userId };

  if (channel)    query.channel    = channel;
  if (status)     query.status     = status;
  if (invoiceId)  query.invoiceId  = invoiceId;
  if (customerId) query.customerId = customerId;
  if (type)       query.type       = type;

  const skip  = (page - 1) * limit;
  const total = await Notification.countDocuments(query);

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    notifications,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// ── Get single notification ───────────────────────────────────────────────────

const getNotificationById = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError('Notification not found.', 404, 'NOTIFICATION_NOT_FOUND');
  }
  return notification;
};

// ── Get notification stats for user ──────────────────────────────────────────

const getNotificationStats = async (userId) => {
  const stats = await Notification.aggregate([
    { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(String(userId)) } },
    {
      $group: {
        _id:       '$status',
        count:     { $sum: 1 },
        channels:  { $addToSet: '$channel' },
      },
    },
  ]);

  const byChannel = await Notification.aggregate([
    { $match: { userId: require('mongoose').Types.ObjectId.createFromHexString(String(userId)) } },
    {
      $group: {
        _id:   '$channel',
        total: { $sum: 1 },
        sent:  { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      },
    },
  ]);

  const result = {
    total:     0,
    pending:   0,
    sent:      0,
    delivered: 0,
    failed:    0,
    cancelled: 0,
    byChannel: {},
  };

  stats.forEach((s) => {
    result[s._id] = s.count;
    result.total += s.count;
  });

  byChannel.forEach((c) => {
    result.byChannel[c._id] = {
      total:  c.total,
      sent:   c.sent,
      failed: c.failed,
    };
  });

  return result;
};

// ── Cancel a notification ─────────────────────────────────────────────────────

const cancelNotification = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    throw new AppError('Notification not found.', 404, 'NOTIFICATION_NOT_FOUND');
  }

  if (['sent', 'delivered', 'cancelled'].includes(notification.status)) {
    throw new AppError(
      `Cannot cancel a notification with status: ${notification.status}.`,
      400,
      'NOTIFICATION_CANNOT_BE_CANCELLED'
    );
  }

  notification.status = 'cancelled';
  await notification.save();

  logger.info(`Notification cancelled: ${notificationId} by user ${userId}`);
  return notification;
};

// ── Get notifications for a specific invoice ──────────────────────────────────

const getInvoiceNotifications = async (userId, invoiceId, { page = 1, limit = 20 } = {}) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  const skip  = (page - 1) * limit;
  const total = await Notification.countDocuments({ userId, invoiceId });

  const notifications = await Notification.find({ userId, invoiceId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    notifications,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Admin: get all notifications across users ─────────────────────────────────

const getAllNotificationsAdmin = async ({
  page    = 1,
  limit   = 20,
  status  = null,
  channel = null,
} = {}) => {
  const query = {};
  if (status)  query.status  = status;
  if (channel) query.channel = channel;

  const skip  = (page - 1) * limit;
  const total = await Notification.countDocuments(query);

  const notifications = await Notification.find(query)
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    notifications,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

module.exports = {
  createNotification,
  getNotifications,
  getNotificationById,
  getNotificationStats,
  cancelNotification,
  getInvoiceNotifications,
  getAllNotificationsAdmin,
};