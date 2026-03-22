'use strict';

const mongoose = require('mongoose');

// ── Valid report types ────────────────────────────────────────────────────────

const VALID_REPORT_TYPES = [
  'customer_dashboard',
  'agent_dashboard',
  'admin_dashboard',
  'upcoming_dues',
  'reminder_history',
  'response_rate',
  'overdue_list',
  'payment_history',
  'priority_queue',
  'recovery_rate',
  'subscriptions_overview',
  'notifications_sent',
  'billing_usage',
  'sla_performance',
];

// ── Schema ────────────────────────────────────────────────────────────────────

const reportCacheSchema = new mongoose.Schema(
  {
    // Owner — null for platform-wide admin reports
    userId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    reportType: {
      type:     String,
      enum:     VALID_REPORT_TYPES,
      required: [true, 'Report type is required'],
    },

    // Query params fingerprint — used to identify unique cache entries
    paramsHash: {
      type:      String,
      required:  [true, 'Params hash is required'],
      maxlength: 64,
    },

    // Computed report payload
    data: {
      type:     mongoose.Schema.Types.Mixed,
      required: [true, 'Report data is required'],
    },

    generatedAt: {
      type:    Date,
      default: Date.now,
    },

    // MongoDB TTL — auto-deletes document at this timestamp
    expiresAt: {
      type:     Date,
      required: [true, 'Expiry date is required'],
    },

    isStale: {
      type:    Boolean,
      default: false,
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

// TTL index — MongoDB auto-deletes expired cache documents
reportCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Lookup index — find cache by owner + type + params
reportCacheSchema.index({ userId: 1, reportType: 1, paramsHash: 1 }, { unique: true });
reportCacheSchema.index({ reportType: 1, isStale: 1 });

const ReportCache = mongoose.model('ReportCache', reportCacheSchema);
module.exports = { ReportCache, VALID_REPORT_TYPES };

