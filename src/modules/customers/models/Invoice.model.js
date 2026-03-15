'use strict';

const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    filename:  { type: String, required: true, maxlength: 255 },
    url:       { type: String, required: true, maxlength: 500 },
    mimeType:  { type: String, default: 'application/pdf' },
    sizeBytes: { type: Number, default: 0 },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },
    customerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Customer',
      required: [true, 'Customer ID is required'],
    },
    invoiceNumber: {
      type:      String,
      required:  [true, 'Invoice number is required'],
      trim:      true,
      maxlength: [100, 'Invoice number must be at most 100 characters'],
    },
    amount: {
      type:     Number,
      required: [true, 'Amount is required'],
      min:      [0.01, 'Amount must be greater than 0'],
    },
    amountPaid: {
      type:    Number,
      default: 0,
      min:     [0, 'Amount paid cannot be negative'],
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
    status: {
      type:    String,
      enum:    ['pending', 'paid', 'overdue', 'cancelled', 'partial'],
      default: 'pending',
    },
    dueDate: {
      type:     Date,
      required: [true, 'Due date is required'],
    },
    issueDate: {
      type:    Date,
      default: Date.now,
    },
    paidAt: { type: Date, default: null },
    attachments: {
      type:     [attachmentSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message:   'Maximum 10 attachments allowed',
      },
    },
    tags: {
      type:    [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 20,
        message:   'Maximum 20 tags allowed',
      },
    },
    notes: {
      type:      String,
      maxlength: [2000, 'Notes must be at most 2000 characters'],
      default:   null,
    },

    // ── Reminder tracking ─────────────────────────────────────────────────────
    remindersSent:  { type: Number, default: 0 },
    lastReminderAt: { type: Date,   default: null },

    // ── Module D — Sequence assignment tracking ───────────────────────────────
    sequenceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Sequence',
      default: null,
    },
    sequenceAssignedAt: { type: Date,    default: null },
    currentPhase:       { type: Number,  default: null, min: 1, max: 5 },
    sequencePaused:     { type: Boolean, default: false },
    nextReminderAt:     { type: Date,    default: null },

    reminderHistory: {
      type: [
        {
          phaseNumber: { type: Number },
          phaseType:   { type: String },
          channel:     { type: String },
          sentAt:      { type: Date, default: Date.now },
          status:      { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
          note:        { type: String, maxlength: 500 },
        },
      ],
      default: [],
      select:  false,
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

invoiceSchema.virtual('amountDue').get(function () {
  return Math.max(0, this.amount - this.amountPaid);
});

invoiceSchema.virtual('isOverdue').get(function () {
  return this.status !== 'paid' &&
         this.status !== 'cancelled' &&
         this.dueDate < new Date();
});

// ── Indexes ───────────────────────────────────────────────────────────────────

invoiceSchema.index({ userId: 1 });
invoiceSchema.index({ userId: 1, customerId: 1 });
invoiceSchema.index({ userId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ userId: 1, status: 1 });
invoiceSchema.index({ userId: 1, dueDate: 1 });
invoiceSchema.index({ userId: 1, tags: 1 });
invoiceSchema.index({ dueDate: 1, status: 1 });
invoiceSchema.index({ sequenceId: 1 },                { sparse: true });
invoiceSchema.index({ nextReminderAt: 1, status: 1 });
invoiceSchema.index({ userId: 1, sequenceId: 1 });

// ── Pre-save: auto-set overdue status ────────────────────────────────────────

invoiceSchema.pre('save', function () {
  if (this.status === 'pending' && this.dueDate < new Date()) {
    this.status = 'overdue';
  }
  if (this.amountPaid >= this.amount && this.amountPaid > 0) {
    this.status = 'paid';
    if (!this.paidAt) this.paidAt = new Date();
  } else if (this.amountPaid > 0 && this.amountPaid < this.amount) {
    this.status = 'partial';
  }
});

const Invoice = mongoose.model('Invoice', invoiceSchema);
module.exports = Invoice;
