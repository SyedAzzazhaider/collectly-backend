'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_ALERT_TYPES = [
  'reminder_sent',          // Module I: Reminder sent
  'payment_received',       // Module I: Payment received
  'customer_reply',         // Module I: Customer reply
  'escalation_triggered',   // Module I: Escalation triggered
  'subscription_expiring',  // Module I: Subscription expiring
];

const VALID_SEVERITIES = ['info', 'warning', 'critical'];

// ── Main Alert schema ─────────────────────────────────────────────────────────

const alertSchema = new mongoose.Schema(
  {
    // Owner — the user who receives this alert
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Alert classification
    type: {
      type:     String,
      enum:     VALID_ALERT_TYPES,
      required: [true, 'Alert type is required'],
    },

    severity: {
      type:    String,
      enum:    VALID_SEVERITIES,
      default: 'info',
    },

    // Human-readable content
    title: {
      type:      String,
      required:  [true, 'Alert title is required'],
      trim:      true,
      maxlength: [200, 'Title must be at most 200 characters'],
    },

    message: {
      type:      String,
      required:  [true, 'Alert message is required'],
      trim:      true,
      maxlength: [1000, 'Message must be at most 1000 characters'],
    },

    // Read state
    isRead: {
      type:    Boolean,
      default: false,
    },

    readAt: {
      type:    Date,
      default: null,
    },

    // Whether an email was dispatched for this alert
    emailSent: {
      type:    Boolean,
      default: false,
    },
    smsSent: {
  type:    Boolean,
  default: false,
},
whatsAppSent: {
  type:    Boolean,
  default: false,
},

    // Contextual references — all optional
    invoiceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Invoice',
      default: null,
    },

    customerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Customer',
      default: null,
    },

    messageId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Message',
      default: null,
    },

    // Arbitrary metadata for the frontend
    metadata: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

alertSchema.index({ userId: 1, createdAt: -1 });
alertSchema.index({ userId: 1, isRead: 1 });
alertSchema.index({ userId: 1, type: 1 });
alertSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

// TTL — auto-delete alerts older than 90 days
alertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Alert = mongoose.model('Alert', alertSchema);
module.exports = { Alert, VALID_ALERT_TYPES, VALID_SEVERITIES };

