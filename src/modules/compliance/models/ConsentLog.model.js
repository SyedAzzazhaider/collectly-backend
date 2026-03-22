'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_CONSENT_TYPES = [
  'sms_marketing',       // Opt-in for SMS reminders
  'whatsapp_marketing',  // Opt-in for WhatsApp reminders
  'email_marketing',     // Opt-in for email reminders
  'data_processing',     // GDPR: consent to process personal data
];

const VALID_CONSENT_ACTIONS = [
  'granted',    // Customer gave consent
  'revoked',    // Customer withdrew consent
  'updated',    // Consent preferences updated
];

const VALID_CONSENT_SOURCES = [
  'api',           // Consent recorded via API
  'unsubscribe',   // Consent revoked via unsubscribe link
  'admin',         // Consent set by admin
  'import',        // Consent set during data import
];

// ── Schema ────────────────────────────────────────────────────────────────────

const consentLogSchema = new mongoose.Schema(
  {
    // Owner — the business account
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // The customer this consent belongs to
    customerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Customer',
      required: [true, 'Customer ID is required'],
    },

    // What type of consent was given/revoked
    consentType: {
      type:     String,
      enum:     VALID_CONSENT_TYPES,
      required: [true, 'Consent type is required'],
    },

    // What happened
    action: {
      type:     String,
      enum:     VALID_CONSENT_ACTIONS,
      required: [true, 'Consent action is required'],
    },

    // How consent was collected
    source: {
      type:    String,
      enum:    VALID_CONSENT_SOURCES,
      default: 'api',
    },

    // IP address of the consent action — GDPR audit requirement
    ipAddress: {
      type:      String,
      default:   null,
      maxlength: 45, // IPv6 max length
    },

    // User agent — GDPR audit requirement
    userAgent: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    // Optional notes
    notes: {
      type:      String,
      default:   null,
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

consentLogSchema.index({ userId: 1, customerId: 1 });
consentLogSchema.index({ userId: 1, customerId: 1, consentType: 1 });
consentLogSchema.index({ customerId: 1, consentType: 1, createdAt: -1 });
consentLogSchema.index({ userId: 1, createdAt: -1 });

// TTL — GDPR requires audit logs to be kept for 3 years
consentLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 3 * 365 * 24 * 60 * 60 }
);

const ConsentLog = mongoose.model('ConsentLog', consentLogSchema);
module.exports = { ConsentLog, VALID_CONSENT_TYPES, VALID_CONSENT_ACTIONS, VALID_CONSENT_SOURCES };

