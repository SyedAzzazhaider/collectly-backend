'use strict';

const mongoose = require('mongoose');

const legalNoticeSchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    name: {
      type:      String,
      required:  [true, 'Template name is required'],
      trim:      true,
      maxlength: [150, 'Name must be at most 150 characters'],
    },
    subject: {
      type:      String,
      required:  [true, 'Subject is required'],
      trim:      true,
      maxlength: [300, 'Subject must be at most 300 characters'],
    },
    body: {
      type:      String,
      required:  [true, 'Body is required'],
      maxlength: [10000, 'Body must be at most 10000 characters'],
    },
    // Supported variables: {{customerName}}, {{invoiceNumber}}, {{amount}},
    // {{dueDate}}, {{companyName}}, {{agentName}}
    variables: {
      type:    [String],
      default: [],
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

legalNoticeSchema.index({ userId: 1, isActive: 1 });

const LegalNotice = mongoose.model('LegalNotice', legalNoticeSchema);
module.exports = { LegalNotice };

