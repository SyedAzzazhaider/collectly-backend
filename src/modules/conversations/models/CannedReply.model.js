'use strict';

const mongoose = require('mongoose');

// ── Document: Templates / Canned replies ─────────────────────────────────────

const cannedReplySchema = new mongoose.Schema(
  {
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: template name for quick identification
    name: {
      type:      String,
      required:  [true, 'Canned reply name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [150, 'Name must be at most 150 characters'],
    },

    // Document: category for organization
    category: {
      type:      String,
      trim:      true,
      maxlength: [100, 'Category must be at most 100 characters'],
      default:   'General',
    },

    // Document: channel this template is for
    channel: {
      type:    String,
      enum:    ['email', 'sms', 'whatsapp', 'in-app', 'all'],
      default: 'all',
    },

    // Subject for email templates
    subject: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Subject must be at most 500 characters'],
      default:   null,
    },

    // Document: template body with {{placeholder}} support
    body: {
      type:      String,
      required:  [true, 'Template body is required'],
      trim:      true,
      maxlength: [5000, 'Body must be at most 5000 characters'],
    },

    // Document: tags for organization and search
    tags: {
      type:    [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 20,
        message:   'Maximum 20 tags per canned reply',
      },
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    // Usage tracking
    usageCount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    lastUsedAt: {
      type:    Date,
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

cannedReplySchema.index({ userId: 1 });
cannedReplySchema.index({ userId: 1, name: 1 });
cannedReplySchema.index({ userId: 1, category: 1 });
cannedReplySchema.index({ userId: 1, channel: 1 });
cannedReplySchema.index({ userId: 1, isActive: 1 });
cannedReplySchema.index({ userId: 1, tags: 1 });

const CannedReply = mongoose.model('CannedReply', cannedReplySchema);

module.exports = { CannedReply };

