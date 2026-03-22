'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_DIRECTIONS = ['outbound', 'inbound'];
const VALID_CHANNELS   = ['email', 'sms', 'whatsapp', 'in-app'];
const VALID_STATUSES   = ['pending', 'sent', 'delivered', 'read', 'failed'];
const VALID_TYPES      = [
  'reminder',
  'canned_reply',
  'custom',
  'payment_link',
  'payment_plan',
  'note',
  'follow_up',
];

// ── Attachment sub-schema ─────────────────────────────────────────────────────

const attachmentSchema = new mongoose.Schema(
  {
    filename:  { type: String, trim: true, maxlength: 255 },
    url:       { type: String, trim: true, maxlength: 500 },
    mimeType:  { type: String, default: 'application/pdf' },
    sizeBytes: { type: Number, default: 0 },
  },
  { _id: false }
);

// ── Main Message schema ───────────────────────────────────────────────────────
// Document: Message inbox — outbound and inbound messages per customer/invoice

const messageSchema = new mongoose.Schema(
  {
    // Owner — the authenticated user's account
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: linked customer
    customerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Customer',
      required: [true, 'Customer ID is required'],
    },

    // Document: linked invoice (optional — some messages are customer-level)
    invoiceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Invoice',
      default: null,
    },

    // Document: direction — outbound (sent by agent) or inbound (reply from customer)
    direction: {
      type:     String,
      enum:     VALID_DIRECTIONS,
      required: [true, 'Direction is required'],
      default:  'outbound',
    },

    // Document: channel
    channel: {
      type:     String,
      enum:     VALID_CHANNELS,
      required: [true, 'Channel is required'],
    },

    // Document: message type
    type: {
      type:     String,
      enum:     VALID_TYPES,
      required: [true, 'Message type is required'],
      default:  'custom',
    },

    // Document: status
    status: {
      type:    String,
      enum:    VALID_STATUSES,
      default: 'pending',
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

    // Document: canned reply reference if used
    cannedReplyId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'CannedReply',
      default: null,
    },

    // Document: payment plan reference if included
    paymentPlanId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'PaymentPlan',
      default: null,
    },

    // Document: payment link if included
    paymentLink: {
      type:      String,
      trim:      true,
      maxlength: 1000,
      default:   null,
    },

    // Document: attachments
    attachments: {
      type:     [attachmentSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length <= 5,
        message:   'Maximum 5 attachments per message',
      },
    },

    // Document: notes & tags for internal use
    notes: {
      type:      String,
      trim:      true,
      maxlength: [2000, 'Notes must be at most 2000 characters'],
      default:   null,
    },

    tags: {
      type:    [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message:   'Maximum 10 tags per message',
      },
    },

    // Document: follow-up scheduling
    followUpAt: {
      type:    Date,
      default: null,
    },

    followUpNote: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Follow-up note must be at most 500 characters'],
      default:   null,
    },

    followUpCompleted: {
      type:    Boolean,
      default: false,
    },

    followUpCompletedAt: {
      type:    Date,
      default: null,
    },

    // Sent/read tracking
    sentAt:      { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    readAt:      { type: Date, default: null },
    failedAt:    { type: Date, default: null },

    // Agent who sent the message
    sentBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // Provider tracking
    notificationId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Notification',
      default: null,
    },

    providerMessageId: {
      type:    String,
      default: null,
      maxlength: 500,
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

messageSchema.index({ userId: 1 });
messageSchema.index({ userId: 1, customerId: 1 });
messageSchema.index({ userId: 1, invoiceId: 1 });
messageSchema.index({ userId: 1, direction: 1 });
messageSchema.index({ userId: 1, status: 1 });
messageSchema.index({ userId: 1, type: 1 });
messageSchema.index({ userId: 1, createdAt: -1 });
messageSchema.index({ userId: 1, followUpAt: 1, followUpCompleted: 1 });
messageSchema.index({ customerId: 1, createdAt: -1 });

// ── Statics ───────────────────────────────────────────────────────────────────

messageSchema.statics.getValidChannels   = () => VALID_CHANNELS;
messageSchema.statics.getValidDirections = () => VALID_DIRECTIONS;
messageSchema.statics.getValidTypes      = () => VALID_TYPES;
messageSchema.statics.getValidStatuses   = () => VALID_STATUSES;

const Message = mongoose.model('Message', messageSchema);

module.exports = { Message, VALID_CHANNELS, VALID_DIRECTIONS, VALID_TYPES, VALID_STATUSES };

