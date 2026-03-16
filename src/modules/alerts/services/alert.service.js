'use strict';

const mongoose = require('mongoose');
const { Alert }  = require('../models/Alert.model');
const User       = require('../../auth/models/User.model');
const AppError   = require('../../../shared/errors/AppError');
const logger     = require('../../../shared/utils/logger');
const emailService = require('../../notifications/services/email.service');

// ── Core: Create alert + optional email ───────────────────────────────────────

const createAlert = async ({
  userId,
  type,
  severity = 'info',
  title,
  message,
  invoiceId  = null,
  customerId = null,
  messageId  = null,
  metadata   = {},
  sendEmail  = false,
}) => {
  try {
    const alert = await Alert.create({
      userId,
      type,
      severity,
      title,
      message,
      invoiceId,
      customerId,
      messageId,
      metadata,
      emailSent: false,
    });

    if (sendEmail) {
      try {
        const user = await User.findById(userId).select('name email');
        if (user) {
          const result = await emailService.sendEmail({
            to:      user.email,
            toName:  user.name,
            subject: `Collectly Alert: ${title}`,
            body:    `Hi ${user.name},\n\n${message}\n\nLog in to your Collectly dashboard to view details.`,
          });

          if (result.success) {
            alert.emailSent = true;
            await alert.save({ validateBeforeSave: false });
          }
        }
      } catch (emailErr) {
        // Email failure must never prevent alert creation
        logger.warn(`Alert email failed for user ${userId}: ${emailErr.message}`);
      }
    }

    logger.info(`Alert created: type=${type} userId=${userId} severity=${severity}`);
    return alert;
  } catch (err) {
    // Alert creation must never crash the calling service
    logger.error(`Failed to create alert: type=${type} userId=${userId} error=${err.message}`);
    return null;
  }
};

// ── Get alerts for a user ─────────────────────────────────────────────────────

const getAlerts = async (userId, {
  page   = 1,
  limit  = 20,
  type   = null,
  isRead = null,
} = {}) => {
  const query = { userId };

  if (type)           query.type   = type;
  if (isRead !== null) query.isRead = isRead === 'true' || isRead === true;

  const skip  = (page - 1) * limit;
  const total = await Alert.countDocuments(query);

  const alerts = await Alert.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const unreadCount = await Alert.countDocuments({ userId, isRead: false });

  return {
    alerts,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    unreadCount,
  };
};

// ── Get single alert ──────────────────────────────────────────────────────────

const getAlertById = async (userId, alertId) => {
  const alert = await Alert.findOne({ _id: alertId, userId });
  if (!alert) throw new AppError('Alert not found.', 404, 'ALERT_NOT_FOUND');
  return alert;
};

// ── Mark single alert as read ─────────────────────────────────────────────────

const markAsRead = async (userId, alertId) => {
  const alert = await Alert.findOne({ _id: alertId, userId });
  if (!alert) throw new AppError('Alert not found.', 404, 'ALERT_NOT_FOUND');

  if (!alert.isRead) {
    alert.isRead = true;
    alert.readAt = new Date();
    await alert.save({ validateBeforeSave: false });
  }

  return alert;
};

// ── Mark all alerts as read ───────────────────────────────────────────────────

const markAllAsRead = async (userId) => {
  const result = await Alert.updateMany(
    { userId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );

  logger.info(`Marked ${result.modifiedCount} alerts as read for user: ${userId}`);
  return { updated: result.modifiedCount };
};

// ── Delete single alert ───────────────────────────────────────────────────────

const deleteAlert = async (userId, alertId) => {
  const alert = await Alert.findOne({ _id: alertId, userId });
  if (!alert) throw new AppError('Alert not found.', 404, 'ALERT_NOT_FOUND');

  await Alert.deleteOne({ _id: alertId, userId });
  logger.info(`Alert deleted: ${alertId} by user: ${userId}`);
  return { deleted: true };
};

// ── Get unread count ──────────────────────────────────────────────────────────

const getUnreadCount = async (userId) => {
  const count = await Alert.countDocuments({ userId, isRead: false });
  return { unreadCount: count };
};

// ── Subscription expiry check (called by scheduler) ───────────────────────────
// Finds all active subscriptions renewing within 7 days and creates alerts
// once per renewal cycle — avoids spam by checking if alert already exists today

const checkSubscriptionExpiry = async () => {
  const Billing = require('../../billing/models/Billing.model').Billing;

  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const now              = new Date();
  const startOfDay       = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const expiringSoon = await Billing.find({
    status:      { $in: ['active', 'trialing'] },
    renewalDate: { $gte: now, $lte: sevenDaysFromNow },
  }).select('userId plan renewalDate amount currency');

  let created = 0;

  for (const billing of expiringSoon) {
    // Only create one alert per user per day
    const existing = await Alert.findOne({
      userId:    billing.userId,
      type:      'subscription_expiring',
      createdAt: { $gte: startOfDay },
    });

    if (existing) continue;

    const daysLeft  = Math.ceil((new Date(billing.renewalDate) - now) / 86400000);
    const renewDate = new Date(billing.renewalDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    await createAlert({
      userId:    billing.userId,
      type:      'subscription_expiring',
      severity:  daysLeft <= 2 ? 'critical' : 'warning',
      title:     `Your ${billing.plan} plan renews in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      message:   `Your Collectly ${billing.plan} subscription (${billing.currency.toUpperCase()} ${billing.amount}/month) will automatically renew on ${renewDate}. Ensure your payment method is up to date.`,
      metadata:  { plan: billing.plan, renewalDate: billing.renewalDate, daysLeft },
      sendEmail: daysLeft <= 3,  // Only email when 3 or fewer days remain
    });

    created++;
  }

  if (created > 0) {
    logger.info(`Subscription expiry check: created ${created} alert(s)`);
  }

  return { checked: expiringSoon.length, created };
};

// ── Event trigger helpers (called by other services) ─────────────────────────

const triggerReminderSent = (userId, { invoice, customer, phase }) => {
  return createAlert({
    userId,
    type:       'reminder_sent',
    severity:   'info',
    title:      `Reminder sent — Invoice #${invoice.invoiceNumber}`,
    message:    `A ${phase?.phaseType || 'scheduled'} reminder was sent to ${customer?.name || 'customer'} for invoice #${invoice.invoiceNumber} (${invoice.currency} ${invoice.amount}).`,
    invoiceId:  invoice._id,
    customerId: customer?._id,
    metadata:   {
      invoiceNumber: invoice.invoiceNumber,
      amount:        invoice.amount,
      currency:      invoice.currency,
      phaseType:     phase?.phaseType,
      customerName:  customer?.name,
    },
    sendEmail: false, // High-frequency — in-app only
  });
};

const triggerPaymentReceived = (userId, { invoice, amount }) => {
  const isFullyPaid = invoice.amountPaid >= invoice.amount;
  return createAlert({
    userId,
    type:      'payment_received',
    severity:  'info',
    title:     `Payment received — Invoice #${invoice.invoiceNumber}`,
    message:   `A payment of ${invoice.currency} ${amount} was recorded on invoice #${invoice.invoiceNumber}.${isFullyPaid ? ' The invoice is now fully paid.' : ` Outstanding balance: ${invoice.currency} ${invoice.amount - invoice.amountPaid}.`}`,
    invoiceId: invoice._id,
    metadata:  {
      invoiceNumber: invoice.invoiceNumber,
      amountPaid:    amount,
      totalAmount:   invoice.amount,
      currency:      invoice.currency,
      isFullyPaid,
    },
    sendEmail: true, // Payment events always email
  });
};

const triggerCustomerReply = (userId, { customer, message }) => {
  return createAlert({
    userId,
    type:       'customer_reply',
    severity:   'info',
    title:      `New reply from ${customer?.name || 'customer'}`,
    message:    `${customer?.name || 'A customer'} sent a message via ${message?.channel || 'unknown channel'}. Check your inbox to respond.`,
    customerId: customer?._id,
    messageId:  message?._id,
    metadata:   {
      customerName: customer?.name,
      channel:      message?.channel,
    },
    sendEmail: true,
  });
};

const triggerEscalationTriggered = (userId, { invoice, customer, phase }) => {
  const escalationPhases = ['first-overdue', 'follow-up', 'final-notice'];
  if (!escalationPhases.includes(phase?.phaseType)) return Promise.resolve(null);

  const isFinal = phase?.phaseType === 'final-notice';
  return createAlert({
    userId,
    type:       'escalation_triggered',
    severity:   isFinal ? 'critical' : 'warning',
    title:      `Escalation: Invoice #${invoice.invoiceNumber} — ${phase.phaseType.replace(/-/g, ' ')}`,
    message:    `Invoice #${invoice.invoiceNumber} for ${invoice.currency} ${invoice.amount} (${customer?.name || 'customer'}) has entered the ${phase.phaseType.replace(/-/g, ' ')} escalation phase. ${isFinal ? 'This is the final automated reminder.' : ''}`,
    invoiceId:  invoice._id,
    customerId: customer?._id,
    metadata:   {
      invoiceNumber: invoice.invoiceNumber,
      amount:        invoice.amount,
      currency:      invoice.currency,
      phaseType:     phase?.phaseType,
      customerName:  customer?.name,
    },
    sendEmail: true,
  });
};

module.exports = {
  createAlert,
  getAlerts,
  getAlertById,
  markAsRead,
  markAllAsRead,
  deleteAlert,
  getUnreadCount,
  checkSubscriptionExpiry,
  triggerReminderSent,
  triggerPaymentReceived,
  triggerCustomerReply,
  triggerEscalationTriggered,
};