'use strict';

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type:  mongoose.Schema.Types.ObjectId,
      ref:   'User',
      index: true,
    },
    action: {
      type:     String,
      required: true,
      enum: [
        // Auth
        'user.signup',
        'user.login',
        'user.logout',
        'user.logout_all',
        'user.password_change',
        'user.password_reset',
        'user.email_verify',
        'user.2fa_enable',
        'user.2fa_disable',
        // Billing
        'billing.subscribe',
        'billing.plan_change',
        'billing.cancel',
        'billing.reactivate',
        // Customers
        'customer.create',
        'customer.update',
        'customer.delete',
        // Invoices
        'invoice.create',
        'invoice.update',
        'invoice.delete',
        'invoice.payment',
        // Sequences
        'sequence.create',
        'sequence.update',
        'sequence.delete',
        'sequence.assign',
        // Compliance
        'compliance.dnc_add',
        'compliance.dnc_remove',
        'compliance.gdpr_export',
        'compliance.unsubscribe',
        // Admin
        'admin.user_view',
        'admin.billing_view',
      ],
      index: true,
    },
    resourceType: {
      type:  String,
      index: true,
    },
    resourceId: {
      type:  mongoose.Schema.Types.ObjectId,
      index: true,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    metadata: {
      type:    mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type:    String,
      enum:    ['success', 'failure'],
      default: 'success',
    },
  },
  {
    timestamps: true,
  }
);

// TTL index — auto-delete audit logs after 1 year (compliance retention)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1,  createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
module.exports = { AuditLog };