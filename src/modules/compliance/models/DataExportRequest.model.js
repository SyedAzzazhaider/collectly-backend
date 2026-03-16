'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_EXPORT_STATUSES = [
  'pending',     // Request received
  'processing',  // Being compiled
  'completed',   // Ready for download
  'failed',      // Export failed
  'expired',     // Download link expired
];

const VALID_EXPORT_TYPES = [
  'full_account',    // All data for the account owner (GDPR Article 20)
  'customer_data',   // Data for a specific customer
];

// ── Schema ────────────────────────────────────────────────────────────────────

const dataExportRequestSchema = new mongoose.Schema(
  {
    // The user requesting their data
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    exportType: {
      type:     String,
      enum:     VALID_EXPORT_TYPES,
      default:  'full_account',
    },

    // For customer_data exports — which customer
    customerId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Customer',
      default: null,
    },

    status: {
      type:    String,
      enum:    VALID_EXPORT_STATUSES,
      default: 'pending',
    },

    // The compiled export payload
    exportData: {
      type:   mongoose.Schema.Types.Mixed,
      default: null,
      select:  false, // Never returned in list queries — only on explicit fetch
    },

    completedAt: {
      type:    Date,
      default: null,
    },

    // Export download expires after 24 hours — GDPR best practice
    expiresAt: {
      type:    Date,
      default: null,
    },

    errorMessage: {
      type:      String,
      default:   null,
      maxlength: 500,
    },

    // IP address of requestor — audit trail
    ipAddress: {
      type:      String,
      default:   null,
      maxlength: 45,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        delete ret.exportData; // Never expose raw data in JSON responses
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

dataExportRequestSchema.index({ userId: 1, createdAt: -1 });
dataExportRequestSchema.index({ userId: 1, status: 1 });

// TTL — auto-delete expired export requests after 48 hours
dataExportRequestSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

const DataExportRequest = mongoose.model('DataExportRequest', dataExportRequestSchema);
module.exports = { DataExportRequest, VALID_EXPORT_STATUSES, VALID_EXPORT_TYPES };