'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_DNC_CHANNELS = ['sms', 'whatsapp', 'email', 'all'];

const VALID_DNC_REASONS = [
  'customer_request',   // Customer asked to be removed
  'unsubscribe_link',   // Clicked unsubscribe
  'complaint',          // Filed a complaint
  'legal',              // Legal requirement
  'admin',              // Admin manually added
];

// ── Schema ────────────────────────────────────────────────────────────────────

const dncListSchema = new mongoose.Schema(
  {
    // Owner — the business account this DNC entry belongs to
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // The customer on the DNC list
    customerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Customer',
      required: [true, 'Customer ID is required'],
    },

    // Which channels are blocked
    channels: {
      type:    [String],
      enum:    VALID_DNC_CHANNELS,
      default: ['all'],
      validate: {
        validator: (arr) => arr.length > 0,
        message:   'At least one channel must be specified',
      },
    },

    // Why they were added
    reason: {
      type:    String,
      enum:    VALID_DNC_REASONS,
      default: 'customer_request',
    },

    // Additional context
    notes: {
      type:      String,
      default:   null,
      maxlength: 1000,
    },

    // Whether this DNC entry is still active
    isActive: {
      type:    Boolean,
      default: true,
    },

    // When it was deactivated (if removed from DNC)
    removedAt: {
      type:    Date,
      default: null,
    },

    removedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
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

dncListSchema.index({ userId: 1, customerId: 1 }, { unique: true });
dncListSchema.index({ userId: 1, isActive: 1 });
dncListSchema.index({ customerId: 1, isActive: 1 });
dncListSchema.index({ userId: 1, createdAt: -1 });

const DncList = mongoose.model('DncList', dncListSchema);
module.exports = { DncList, VALID_DNC_CHANNELS, VALID_DNC_REASONS };

