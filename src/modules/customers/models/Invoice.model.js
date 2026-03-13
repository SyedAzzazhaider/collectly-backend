'use strict';

const mongoose = require('mongoose');

// ── Attachment sub-schema ─────────────────────────────────────────────────────

const attachmentSchema = new mongoose.Schema(
  {
    filename:  { type: String, required: true, maxlength: 255 },
    url:       { type: String, required: true, maxlength: 500 },
    mimeType:  { type: String, default: 'application/pdf' },
    sizeBytes: { type: Number, default: 0 },
  },
  { _id: false }
);

// ── Main Invoice schema ───────────────────────────────────────────────────────
// Fields from document: invoice number, due date, amount, currency,
// status (pending/paid/overdue), linked customer, attachments (PDF), tags

const invoiceSchema = new mongoose.Schema(
  {
    // Owner
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: Linked customer
    customerId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Customer',
      required: [true, 'Customer ID is required'],
    },

    // Document: Invoice number
    invoiceNumber: {
      type:      String,
      required:  [true, 'Invoice number is required'],
      trim:      true,
      maxlength: [100, 'Invoice number must be at most 100 characters'],
    },

    // Document: Amount
    amount: {
      type:     Number,
      required: [true, 'Amount is required'],
      min:      [0.01, 'Amount must be greater than 0'],
    },

    // Partial payment tracking
    amountPaid: {
      type:    Number,
      default: 0,
      min:     [0, 'Amount paid cannot be negative'],
    },

    // Document: Currency
    currency: {
      type:      String,
      required:  [true, 'Currency is required'],
      uppercase: true,
      trim:      true,
      minlength: 3,
      maxlength: 3,
      default:   'USD',
    },

    // Document: Status (pending/paid/overdue)
    status: {
      type:    String,
      enum:    ['pending', 'paid', 'overdue', 'cancelled', 'partial'],
      default: 'pending',
    },

    // Document: Due date
    dueDate: {
      type:     Date,
      required: [true, 'Due date is required'],
    },

    issueDate: {
      type:    Date,
      default: Date.now,
    },

    paidAt: { type: Date, default: null },

    // Document: Attachments (PDF)
    attachments: {
      type:     [attachmentSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message:   'Maximum 10 attachments allowed',
      },
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

    // Internal notes
    notes: {
      type:      String,
      maxlength: [2000, 'Notes must be at most 2000 characters'],
      default:   null,
    },

    // Reminder sequence tracking
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: { type: Date, default: null },
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
invoiceSchema.index({ dueDate: 1, status: 1 }); // For scheduler queries

// ── Pre-save: auto-set overdue status ────────────────────────────────────────

invoiceSchema.pre('save', function () {
  if (
    this.status === 'pending' &&
    this.dueDate < new Date()
  ) {
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