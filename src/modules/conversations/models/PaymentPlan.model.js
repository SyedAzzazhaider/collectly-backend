'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_STATUSES    = ['proposed', 'accepted', 'rejected', 'active', 'completed', 'defaulted'];
const VALID_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];

// ── Installment sub-schema ────────────────────────────────────────────────────

const installmentSchema = new mongoose.Schema(
  {
    installmentNumber: { type: Number, required: true, min: 1 },
    amount:            { type: Number, required: true, min: 0.01 },
    dueDate:           { type: Date,   required: true },
    paidAt:            { type: Date,   default: null },
    paidAmount:        { type: Number, default: 0 },
    status:            {
      type:    String,
      enum:    ['pending', 'paid', 'overdue', 'partial'],
      default: 'pending',
    },
  },
  { _id: true }
);

// ── Main PaymentPlan schema ───────────────────────────────────────────────────
// Document: Payment plan proposals — partial payment + flexible installments

const paymentPlanSchema = new mongoose.Schema(
  {
    // Owner
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

    // Document: linked invoice
    invoiceId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Invoice',
      required: [true, 'Invoice ID is required'],
    },

    // Document: payment plan status
    status: {
      type:    String,
      enum:    VALID_STATUSES,
      default: 'proposed',
    },

    // Document: total amount covered by this plan
    totalAmount: {
      type:     Number,
      required: [true, 'Total amount is required'],
      min:      [0.01, 'Total amount must be greater than 0'],
    },

    currency: {
      type:      String,
      required:  [true, 'Currency is required'],
      uppercase: true,
      trim:      true,
      minlength: 3,
      maxlength: 3,
      default:   'USD',
    },

    // Document: number of installments
    numberOfInstallments: {
      type:     Number,
      required: [true, 'Number of installments is required'],
      min:      [2,  'Minimum 2 installments'],
      max:      [24, 'Maximum 24 installments'],
    },

    // Document: frequency
    frequency: {
      type:     String,
      enum:     VALID_FREQUENCIES,
      required: [true, 'Frequency is required'],
      default:  'monthly',
    },

    // Document: start date
    startDate: {
      type:     Date,
      required: [true, 'Start date is required'],
    },

    // Document: installments array
    installments: {
      type:     [installmentSchema],
      default:  [],
    },

    // Document: amount paid so far
    amountPaid: {
      type:    Number,
      default: 0,
      min:     0,
    },

    // Payment link for this plan
    paymentLink: {
      type:      String,
      trim:      true,
      maxlength: 1000,
      default:   null,
    },

    // Document: notes
    notes: {
      type:      String,
      trim:      true,
      maxlength: [2000, 'Notes must be at most 2000 characters'],
      default:   null,
    },

    // Agent who created the plan
    createdBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'User',
      default: null,
    },

    // Timestamps for status changes
    proposedAt:  { type: Date, default: Date.now },
    acceptedAt:  { type: Date, default: null },
    rejectedAt:  { type: Date, default: null },
    completedAt: { type: Date, default: null },
    defaultedAt: { type: Date, default: null },

    // Rejection reason
    rejectionReason: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Rejection reason must be at most 500 characters'],
      default:   null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        delete ret.__v;
        delete ret.id;
        return ret;
      },
    },
  }
);

// ── Virtuals ──────────────────────────────────────────────────────────────────

paymentPlanSchema.virtual('amountRemaining').get(function () {
  return Math.max(0, this.totalAmount - this.amountPaid);
});

paymentPlanSchema.virtual('progressPercent').get(function () {
  if (this.totalAmount === 0) return 0;
  return Math.min(100, Math.round((this.amountPaid / this.totalAmount) * 100));
});

// ── Indexes ───────────────────────────────────────────────────────────────────

paymentPlanSchema.index({ userId: 1 });
paymentPlanSchema.index({ userId: 1, customerId: 1 });
paymentPlanSchema.index({ userId: 1, invoiceId: 1 });
paymentPlanSchema.index({ userId: 1, status: 1 });
paymentPlanSchema.index({ invoiceId: 1, status: 1 });

// ── Statics ───────────────────────────────────────────────────────────────────

paymentPlanSchema.statics.getValidStatuses    = () => VALID_STATUSES;
paymentPlanSchema.statics.getValidFrequencies = () => VALID_FREQUENCIES;

const PaymentPlan = mongoose.model('PaymentPlan', paymentPlanSchema);

module.exports = { PaymentPlan, VALID_STATUSES, VALID_FREQUENCIES };

