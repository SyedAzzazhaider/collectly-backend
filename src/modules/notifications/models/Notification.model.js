'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_CHANNELS = ['email', 'sms', 'whatsapp', 'in-app', 'webhook'];
const VALID_STATUSES  = ['pending', 'sent', 'delivered', 'failed', 'cancelled'];
const VALID_TYPES     = [
  'payment_reminder',
  'invoice_overdue',
  'payment_received',
  'subscription_renewal',
  'system_alert',
  'custom',
];

// ── Recipient sub-schema ──────────────────────────────────────────────────────

const recipientSchema = new mongoose.Schema(
  {
    name:    { type: String, trim: true, maxlength: 200, default: null },
    email:   { type: String, trim: true, lowercase: true, maxlength: 255, default: null },
    phone:   { type: String, trim: true, maxlength: 30, default: null },
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

// ── Delivery attempt sub-schema ───────────────────────────────────────────────

const deliveryAttemptSchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true, min: 1 },
    attemptedAt:   { type: Date, default: Date.now },
    status:        { type: String, enum: ['sent', 'failed'], default: 'sent' },
    providerMessageId: { type: String, default: null },
    providerResponse:  { type: String, maxlength: 1000, default: null },
    errorCode:         { type: String, maxlength: 100, default: null },
    errorMessage:      { type: String, maxlength: 500, default: null },
    durationMs:        { type: Number, default: null },
  },
  { _id: false }
);

// ── Main Notification schema ──────────────────────────────────────────────────

const notificationSchema = new mongoose.Schema(
  {
    // Owner
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: channel — email, sms, whatsapp, in-app
    channel: {
      type:     String,
      enum:     VALID_CHANNELS,
      required: [true, 'Channel is required'],
    },

    // Document: type
    type: {
      type:     String,
      enum:     VALID_TYPES,
      required: [true, 'Notification type is required'],
      default:  'payment_reminder',
    },

    // Document: status
    status: {
      type:    String,
      enum:    VALID_STATUSES,
      default: 'pending',
    },

    // Recipient details
    recipient: {
      type:     recipientSchema,
      required: [true, 'Recipient is required'],
    },

    // Message content
    subject: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Subject must be at most 500 characters'],
      default:   null,
    },

    body: {
      type:      String,
      required:  [true, 'Message body is required'],
      trim:      true,
      maxlength: [10000, 'Body must be at most 10000 characters'],
    },

    // Document: linked invoice
    invoiceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Invoice',
      default: null,
    },

    // Document: linked customer
    customerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Customer',
      default: null,
    },

    // Document: linked sequence phase
    sequenceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Sequence',
      default: null,
    },

    phaseNumber: {
      type:    Number,
      default: null,
      min:     1,
      max:     5,
    },

    // Provider tracking
    providerMessageId: {
      type:    String,
      default: null,
      maxlength: 500,
    },

    // Delivery attempts — retry tracking
    deliveryAttempts: {
      type:    [deliveryAttemptSchema],
      default: [],
    },

    attemptCount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    maxAttempts: {
      type:    Number,
      default: 3,
      min:     1,
      max:     5,
    },

    // Document: scheduled sending
    scheduledAt: {
      type:    Date,
      default: null,
    },

    sentAt: {
      type:    Date,
      default: null,
    },

    deliveredAt: {
      type:    Date,
      default: null,
    },

    failedAt: {
      type:    Date,
      default: null,
    },

    // Document: retry configuration
    nextRetryAt: {
      type:    Date,
      default: null,
    },

    retryBackoffMinutes: {
      type:    Number,
      default: 5,
    },

    // Error tracking
    lastErrorCode:    { type: String, default: null, maxlength: 100 },
    lastErrorMessage: { type: String, default: null, maxlength: 1000 },

    // Metadata
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

notificationSchema.index({ userId: 1 });
notificationSchema.index({ userId: 1, status: 1 });
notificationSchema.index({ userId: 1, channel: 1 });
notificationSchema.index({ userId: 1, invoiceId: 1 });
notificationSchema.index({ userId: 1, customerId: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ status: 1, scheduledAt: 1 });
notificationSchema.index({ status: 1, nextRetryAt: 1 });
notificationSchema.index({ invoiceId: 1, channel: 1 });

// ── Statics ───────────────────────────────────────────────────────────────────

notificationSchema.statics.getValidChannels = () => VALID_CHANNELS;
notificationSchema.statics.getValidStatuses = () => VALID_STATUSES;
notificationSchema.statics.getValidTypes    = () => VALID_TYPES;

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification, VALID_CHANNELS, VALID_STATUSES, VALID_TYPES };

