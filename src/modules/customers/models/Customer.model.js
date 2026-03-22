'use strict';

const mongoose = require('mongoose');

// ── Preferred channels sub-schema ─────────────────────────────────────────────

const preferenceSchema = new mongoose.Schema(
  {
    channels: {
      type:    [String],
      enum:    ['email', 'sms', 'whatsapp', 'in-app', 'webhook'],
      default: ['email'],
    },
    language:     { type: String,  default: 'en', maxlength: 10 },
    doNotContact: { type: Boolean, default: false },
    webhookUrl: {
      type:      String,
      default:   null,
      maxlength: 500,
      match:     [/^https?:\/\/.+/, 'webhookUrl must be a valid HTTP/HTTPS URL'],
    },
  },
  { _id: false }
);

// ── Main Customer schema ──────────────────────────────────────────────────────
// Fields from document: name, company, contact info,
// preferred channels, timezone

const customerSchema = new mongoose.Schema(
  {
    // Owner — the authenticated user who created this customer
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: Name
    name: {
      type:      String,
      required:  [true, 'Customer name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must be at most 100 characters'],
    },

    // Document: Company
    company: {
      type:      String,
      trim:      true,
      maxlength: [150, 'Company name must be at most 150 characters'],
      default:   null,
    },

    // Document: Contact info
    email: {
      type:      String,
      required:  [true, 'Customer email is required'],
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },

    phone: {
      type:    String,
      trim:    true,
      match:   [/^\+?[\d\s\-().]{7,20}$/, 'Please provide a valid phone number'],
      default: null,
    },

    // Document: Timezone
    timezone: {
      type:    String,
      default: 'UTC',
      maxlength: 60,
    },

    // Document: Preferred channels (email/SMS/WhatsApp)
    preferences: {
      type:    preferenceSchema,
      default: () => ({}),
    },

    // Additional contact info
    address: {
      street:  { type: String, trim: true, maxlength: 200 },
      city:    { type: String, trim: true, maxlength: 100 },
      country: { type: String, trim: true, maxlength: 100 },
      zip:     { type: String, trim: true, maxlength: 20  },
    },

    // Document: Tags
    tags: {
      type:    [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 20,
        message:   'Maximum 20 tags allowed',
      },
    },

    isActive: { type: Boolean, default: true },

    // Notes for agents
    notes: {
      type:      String,
      maxlength: [2000, 'Notes must be at most 2000 characters'],
      default:   null,
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

customerSchema.index({ userId: 1 });
customerSchema.index({ userId: 1, email: 1 }, { unique: true });
customerSchema.index({ userId: 1, name:  1 });
customerSchema.index({ userId: 1, tags:  1 });
customerSchema.index({ userId: 1, isActive: 1 });

const Customer = mongoose.model('Customer', customerSchema);
module.exports = Customer;

