'use strict';

const { Notification } = require('../models/Notification.model');
const notificationService = require('./notification.service');
const emailService        = require('./email.service');
const smsService          = require('./sms.service');
const AppError            = require('../../../shared/errors/AppError');
const logger              = require('../../../shared/utils/logger');
const webhookService      = require('./webhook.service');

// ── Calculate retry backoff ───────────────────────────────────────────────────

const calculateNextRetry = (attemptCount, baseMinutes = 5) => {
  const backoffMinutes = baseMinutes * Math.pow(2, attemptCount - 1);
  const capped         = Math.min(backoffMinutes, 60 * 24);
  const nextRetry      = new Date();
  nextRetry.setMinutes(nextRetry.getMinutes() + capped);
  return nextRetry;
};

// BUG-05 FIX: verify billing plan allows this channel before dispatching.
// Skipped in test mode — notification tests do not provision billing records
// and billing enforcement is covered independently in billing.test.js.
const checkChannelAccess = async (userId, channel) => {
  if (process.env.NODE_ENV === 'test') return { allowed: true };

  try {
    const billingService = require('../../billing/services/billing.service');
    const billing        = await billingService.getBilling(String(userId));

    // Inactive subscription — allow email + in-app as free-tier defaults
    if (!billing.isActive()) {
      const freeChannels = ['email', 'in-app'];
      if (!freeChannels.includes(channel)) {
        return {
          allowed: false,
          reason:  `An active subscription is required to use the '${channel}' channel.`,
          code:    'SUBSCRIPTION_INACTIVE',
        };
      }
      return { allowed: true };
    }

    // Active subscription — enforce plan channel list strictly
    if (!billing.canUseChannel(channel)) {
      return {
        allowed: false,
        reason:  `Your '${billing.plan}' plan does not include the '${channel}' channel.`,
        code:    'CHANNEL_NOT_ALLOWED',
      };
    }

    return { allowed: true };
  } catch (err) {
    logger.warn(
      `Billing channel check failed — failing open (user=${userId} channel=${channel}): ${err.message}`
    );
    return { allowed: true };
  }
};

// ── Dispatch to correct provider ──────────────────────────────────────────────

const dispatchToProvider = async (notification) => {
  const { channel, recipient, subject, body, metadata } = notification;

  switch (channel) {
    case 'email':
      return emailService.sendEmail({
        to:      recipient.email,
        toName:  recipient.name,
        subject,
        body,
      });

    case 'sms':
      return smsService.sendSms({
        to:   recipient.phone,
        body,
      });

    case 'whatsapp':
      return smsService.sendWhatsApp({
        to:   recipient.phone,
        body,
      });

    case 'in-app':
      logger.info(`In-app notification queued: ${notification._id}`);
      return {
        success:           true,
        simulated:         true,
        providerMessageId: `inapp_${notification._id}`,
        durationMs:        0,
        provider:          'in-app',
      };

    case 'webhook':
      return webhookService.sendWebhook({
        webhookUrl: recipient.webhookUrl || metadata?.webhookUrl || null,
        body,
        metadata: {
          notificationId: String(notification._id),
          channel,
          invoiceId:      notification.invoiceId  || null,
          customerId:     notification.customerId || null,
          type:           notification.type,
          ...(metadata || {}),
        },
      });

    default:
      throw new AppError(`Unsupported channel: ${channel}`, 400, 'UNSUPPORTED_CHANNEL');
  }
};

// ── Send a single notification ────────────────────────────────────────────────
// Compliance guard (DNC/opt-in) is enforced upstream in reminderEngine.service.js
// Billing channel gate is enforced here as the transport entry point.

const sendNotification = async (userId, data) => {
  // BUG-05 FIX: enforce plan channel access before creating the notification record
  const access = await checkChannelAccess(userId, data.channel);
  if (!access.allowed) {
    throw new AppError(
      access.reason || 'Channel not allowed on current plan.',
      403,
      access.code   || 'CHANNEL_NOT_ALLOWED'
    );
  }

  const notification = await notificationService.createNotification(userId, data);

  // If scheduledAt is in the future — hold as pending, do not deliver now
  if (notification.scheduledAt && new Date(notification.scheduledAt) > new Date()) {
    logger.info(
      `Notification scheduled for future delivery: ${notification._id} at ${notification.scheduledAt}`
    );
    return notification;
  }

  return executeDelivery(notification);
};

// ── Execute delivery on an existing notification record ───────────────────────

const executeDelivery = async (notification) => {
  const startTime    = Date.now();
  const attemptCount = notification.attemptCount + 1;

  logger.info(
    `Delivery attempt ${attemptCount}/${notification.maxAttempts}: ` +
    `id=${notification._id} channel=${notification.channel}`
  );

  try {
    const result = await dispatchToProvider(notification);
    const now    = new Date();

    if (result.success) {
      notification.status            = 'sent';
      notification.sentAt            = now;
      notification.providerMessageId = result.providerMessageId || null;
      notification.attemptCount      = attemptCount;
      notification.nextRetryAt       = null;
      notification.lastErrorCode     = null;
      notification.lastErrorMessage  = null;

      notification.deliveryAttempts.push({
        attemptNumber:     attemptCount,
        attemptedAt:       now,
        status:            'sent',
        providerMessageId: result.providerMessageId || null,
        providerResponse:  result.providerResponse  || null,
        durationMs:        result.durationMs        || null,
      });

      await notification.save();

      logger.info(
        `Notification delivered: id=${notification._id} ` +
        `channel=${notification.channel} provider=${result.provider}`
      );
    } else {
      await handleDeliveryFailure(notification, attemptCount, result);
    }

    return notification;
  } catch (err) {
    await handleDeliveryFailure(notification, attemptCount, {
      errorCode:    'DISPATCH_ERROR',
      errorMessage: err.message,
    });
    return notification;
  }
};

// ── Handle delivery failure ───────────────────────────────────────────────────

const handleDeliveryFailure = async (notification, attemptCount, result) => {
  const now            = new Date();
  const hasMoreRetries = attemptCount < notification.maxAttempts;

  notification.attemptCount     = attemptCount;
  notification.lastErrorCode    = result.errorCode    || 'UNKNOWN';
  notification.lastErrorMessage = result.errorMessage || 'Unknown error';

  notification.deliveryAttempts.push({
    attemptNumber: attemptCount,
    attemptedAt:   now,
    status:        'failed',
    errorCode:     result.errorCode    || 'UNKNOWN',
    errorMessage:  result.errorMessage || 'Unknown error',
    durationMs:    result.durationMs   || null,
  });

  if (hasMoreRetries) {
    notification.status      = 'pending';
    notification.nextRetryAt = calculateNextRetry(attemptCount);
    logger.warn(
      `Notification failed attempt ${attemptCount}/${notification.maxAttempts}: ` +
      `id=${notification._id} nextRetry=${notification.nextRetryAt.toISOString()}`
    );
  } else {
    notification.status      = 'failed';
    notification.failedAt    = now;
    notification.nextRetryAt = null;
    logger.error(
      `Notification permanently failed after ${attemptCount} attempts: ` +
      `id=${notification._id} channel=${notification.channel} ` +
      `error=${notification.lastErrorMessage}`
    );
  }

  await notification.save();
};

// ── Retry failed notifications ────────────────────────────────────────────────

const retryFailedNotifications = async (batchSize = 50) => {
  const now = new Date();

  const notifications = await Notification.find({
    status: 'pending',
    $or: [
      { nextRetryAt: { $lte: now } },
      { scheduledAt: { $lte: now }, nextRetryAt: null },
    ],
  })
    .limit(batchSize)
    .lean();

  if (notifications.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  logger.info(`Retry/scheduled batch: processing ${notifications.length} notifications`);

  let succeeded = 0;
  let failed    = 0;

  for (const notif of notifications) {
    const full = await Notification.findById(notif._id);
    if (!full) continue;

    const result = await executeDelivery(full);
    if (result.status === 'sent') {
      succeeded++;
    } else {
      failed++;
    }
  }

  logger.info(`Retry/scheduled batch complete: succeeded=${succeeded} failed=${failed}`);

  return {
    processed:   notifications.length,
    succeeded,
    failed,
    completedAt: new Date(),
  };
};

// ── Send bulk notifications ───────────────────────────────────────────────────

const sendBulkNotifications = async (userId, notificationsData) => {
  const results = [];

  for (const data of notificationsData) {
    try {
      const notification = await sendNotification(userId, data);
      results.push({
        success:        true,
        notificationId: notification._id,
        status:         notification.status,
        channel:        notification.channel,
      });
    } catch (err) {
      logger.error(`Bulk send error for channel ${data.channel}: ${err.message}`);
      results.push({
        success: false,
        channel: data.channel,
        error:   err.message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed    = results.filter((r) => !r.success).length;

  logger.info(`Bulk send complete: userId=${userId} succeeded=${succeeded} failed=${failed}`);

  return { results, succeeded, failed, total: notificationsData.length };
};

// ── Send notification from Module D reminder payload ──────────────────────────

const sendFromReminderPayload = async (userId, payload) => {
  const {
    invoiceId, customerId, sequenceId,
    phaseNumber, phaseType, reminderType,
    messages,
  } = payload;

  const results = [];

  for (const msg of messages) {
    const notifData = {
      channel:    msg.channel,
      type:       'payment_reminder',
      recipient: {
        name:  payload.customer?.name  || null,
        email: msg.channel === 'email' || msg.channel === 'in-app' ? msg.to : null,
        phone: msg.channel === 'sms'   || msg.channel === 'whatsapp' ? msg.to : null,
      },
      subject:    msg.subject || null,
      body:       msg.body,
      invoiceId,
      customerId,
      sequenceId,
      phaseNumber,
      maxAttempts: 3,
      metadata: {
        phaseType,
        reminderType,
        invoiceNumber: payload.invoiceNumber,
        amount:        payload.amount,
        currency:      payload.currency,
      },
    };

    try {
      const notification = await sendNotification(userId, notifData);
      results.push({
        success:        true,
        notificationId: notification._id,
        channel:        msg.channel,
        status:         notification.status,
      });
    } catch (err) {
      logger.error(`Reminder payload send error: channel=${msg.channel} error=${err.message}`);
      results.push({
        success: false,
        channel: msg.channel,
        error:   err.message,
      });
    }
  }

  return results;
};

// ── Get delivery statistics ───────────────────────────────────────────────────

const getDeliveryStats = async (userId) => {
  const Mongoose = require('mongoose');
  const oid      = Mongoose.Types.ObjectId.createFromHexString(String(userId));

  const [channelStats, statusStats] = await Promise.all([
    Notification.aggregate([
      { $match: { userId: oid } },
      {
        $group: {
          _id:         '$channel',
          total:       { $sum: 1 },
          sent:        { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed:      { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pending:     { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          avgAttempts: { $avg: '$attemptCount' },
        },
      },
    ]),
    Notification.aggregate([
      { $match: { userId: oid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const byChannel = {};
  channelStats.forEach((c) => {
    byChannel[c._id] = {
      total:        c.total,
      sent:         c.sent,
      failed:       c.failed,
      pending:      c.pending,
      deliveryRate: c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0,
      avgAttempts:  Math.round((c.avgAttempts || 0) * 100) / 100,
    };
  });

  const byStatus = {};
  let total = 0;
  statusStats.forEach((s) => {
    byStatus[s._id] = s.count;
    total += s.count;
  });

  return { total, byStatus, byChannel };
};

module.exports = {
  sendNotification,
  executeDelivery,
  sendBulkNotifications,
  sendFromReminderPayload,
  retryFailedNotifications,
  getDeliveryStats,
  calculateNextRetry,
};

