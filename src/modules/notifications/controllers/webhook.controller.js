'use strict';

const crypto             = require('crypto');
const { Notification }   = require('../models/Notification.model');
const logger             = require('../../../shared/utils/logger');
const Customer           = require('../../customers/models/Customer.model');
const { DncList }        = require('../../compliance/models/DncList.model');

// ── Verify SendGrid webhook signature ─────────────────────────────────────────

// Verify SendGrid webhook signature

// Verify SendGrid webhook signature
const verifySendGridSignature = (req) => {
  const key = process.env.SENDGRID_WEBHOOK_VERIFY_KEY;
  if (!key) return process.env.NODE_ENV !== 'production';
  const signature = req.headers['x-twilio-email-event-webhook-signature'];
  const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'];
  if (!signature || !timestamp) return false;

  try {
    const payload  = timestamp + JSON.stringify(req.body);
    const expected = crypto
      .createHmac('sha256', key)
      .update(payload)
      .digest('base64');

    const sigBuf = Buffer.from(signature, 'base64');
    const expBuf = Buffer.from(expected,  'base64');

    // BUG-03 FIX: timingSafeEqual throws RangeError when buffer lengths differ.
    // Guard with explicit length check before calling it.
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
};

// ── Process SendGrid event ────────────────────────────────────────────────────

const BOUNCE_EVENTS = ['bounce', 'blocked', 'spamreport', 'unsubscribe'];

const handleSendGridWebhook = async (req, res, next) => {
  try {
    if (!verifySendGridSignature(req)) {
      logger.warn('SendGrid webhook: invalid signature');
      return res.status(401).json({ status: 'fail', message: 'Invalid signature' });
    }

    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      const { event: eventType, sg_message_id, reason, type } = event;

      if (!sg_message_id) continue;

      // Strip SendGrid suffix from message ID
      const messageId = sg_message_id.split('.')[0];

      const notification = await Notification.findOne({
        providerMessageId: { $regex: messageId, $options: 'i' },
      });

      if (!notification) continue;

      switch (eventType) {
        case 'delivered':
          notification.status      = 'delivered';
          notification.deliveredAt = new Date(event.timestamp * 1000);
          break;

        case 'bounce':
          notification.status           = 'failed';
          notification.lastErrorCode    = `BOUNCE_${(type || 'hard').toUpperCase()}`;
          notification.lastErrorMessage = reason || 'Email bounced';
          break;

        case 'blocked':
          notification.status           = 'failed';
          notification.lastErrorCode    = 'BLOCKED';
          notification.lastErrorMessage = reason || 'Email blocked by recipient server';
          break;

        case 'spamreport':
          notification.status           = 'failed';
          notification.lastErrorCode    = 'SPAM_REPORT';
          notification.lastErrorMessage = 'Marked as spam by recipient';
          break;

        case 'unsubscribe':
          notification.status           = 'failed';
          notification.lastErrorCode    = 'UNSUBSCRIBED';
          notification.lastErrorMessage = 'Recipient unsubscribed';

          // ── GDPR: auto-add to DNC list on unsubscribe ─────────────────────
          if (notification.customerId && notification.userId) {
            try {
              await DncList.findOneAndUpdate(
                {
                  userId:     notification.userId,
                  customerId: notification.customerId,
                },
                {
                  userId:     notification.userId,
                  customerId: notification.customerId,
                  reason:     'unsubscribed',
                  channel:    'email',
                  addedAt:    new Date(),
                },
                { upsert: true }
              );

              await Customer.findOneAndUpdate(
                { _id: notification.customerId, userId: notification.userId },
                { $set: { 'preferences.doNotContact': true } }
              );

              logger.info(
                `DNC auto-added on unsubscribe: customerId=${notification.customerId}`
              );
            } catch (dncErr) {
              logger.error(`DNC write failed on unsubscribe: ${dncErr.message}`);
            }
          }
          break;

        default:
          continue;
      }

      await notification.save();
      logger.info(
        `SendGrid event processed: event=${eventType} notificationId=${notification._id}`
      );
    }

    res.status(200).json({ status: 'success', message: 'Events processed.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { handleSendGridWebhook };

