'use strict';

const mongoose = require('mongoose');

// ── Valid values ──────────────────────────────────────────────────────────────

const VALID_CHANNELS       = ['email', 'sms', 'whatsapp', 'in-app'];
const VALID_REMINDER_TYPES = ['immediate', 'scheduled', 'recurring'];

// Document escalation phases (exactly 5 as specified)
const VALID_PHASE_TYPES = [
  'pre-due',         // Phase 1: Pre-due reminder
  'due-day',         // Phase 2: Due day reminder
  'first-overdue',   // Phase 3: First overdue
  'follow-up',       // Phase 4: Follow-up overdue
  'final-notice',    // Phase 5: Final notice
];

// ── Message template sub-schema ───────────────────────────────────────────────
// Document: Custom message templates per phase

const messageTemplateSchema = new mongoose.Schema(
  {
    channel: {
      type:     String,
      enum:     VALID_CHANNELS,
      required: [true, 'Channel is required for message template'],
    },
    subject: {
      type:      String,
      trim:      true,
      maxlength: [300, 'Subject must be at most 300 characters'],
      default:   null,
    },
    body: {
      type:      String,
      required:  [true, 'Message body is required'],
      trim:      true,
      maxlength: [5000, 'Message body must be at most 5000 characters'],
    },
  },
  { _id: false }
);

// ── Trigger rules sub-schema ──────────────────────────────────────────────────
// Document: Trigger rules (days overdue, amount thresholds)

const triggerRuleSchema = new mongoose.Schema(
  {
    // Days relative to due date:
    // negative = before due (pre-due), 0 = due day, positive = after due (overdue)
    daysOffset: {
      type:     Number,
      required: [true, 'Days offset is required'],
      min:      [-365, 'Days offset cannot be less than -365'],
      max:      [365,  'Days offset cannot exceed 365'],
    },

    // Document: Amount thresholds
    minAmount: {
      type:    Number,
      default: null,
      min:     [0, 'Minimum amount cannot be negative'],
    },
    maxAmount: {
      type:    Number,
      default: null,
      min:     [0, 'Maximum amount cannot be negative'],
    },

    // For recurring reminders — interval in days
    repeatEveryDays: {
      type:    Number,
      default: null,
      min:     [1, 'Repeat interval must be at least 1 day'],
      max:     [30, 'Repeat interval cannot exceed 30 days'],
    },

    maxRepeats: {
      type:    Number,
      default: null,
      min:     [1,  'Max repeats must be at least 1'],
      max:     [20, 'Max repeats cannot exceed 20'],
    },
  },
  { _id: false }
);

// ── Phase sub-schema ──────────────────────────────────────────────────────────
// Document: Escalation Phases 1–5
// Document: Channels per phase, custom message templates, trigger rules

const phaseSchema = new mongoose.Schema(
  {
    // Document: Phase ordering (1=pre-due, 2=due-day, 3=first-overdue,
    //           4=follow-up, 5=final-notice)
    phaseType: {
      type:     String,
      enum:     VALID_PHASE_TYPES,
      required: [true, 'Phase type is required'],
    },

    phaseNumber: {
      type:     Number,
      required: [true, 'Phase number is required'],
      min:      [1, 'Phase number must be at least 1'],
      max:      [5, 'Phase number cannot exceed 5'],
    },

    name: {
      type:      String,
      trim:      true,
      maxlength: [100, 'Phase name must be at most 100 characters'],
      default:   null,
    },

    isEnabled: {
      type:    Boolean,
      default: true,
    },

    // Document: Reminder type per phase
    reminderType: {
      type:     String,
      enum:     VALID_REMINDER_TYPES,
      required: [true, 'Reminder type is required'],
      default:  'scheduled',
    },

    // Document: Channels per phase
    channels: {
      type:     [String],
      enum:     VALID_CHANNELS,
      required: [true, 'At least one channel is required'],
      validate: {
        validator: (arr) => arr.length >= 1 && arr.length <= 4,
        message:   'Each phase must have 1–4 channels',
      },
    },

    // Document: Custom message templates per channel
    messageTemplates: {
      type:     [messageTemplateSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length <= 4,
        message:   'Maximum 4 message templates per phase',
      },
    },

    // Document: Trigger rules (days overdue, amount thresholds)
    triggerRule: {
      type:     triggerRuleSchema,
      required: [true, 'Trigger rule is required for each phase'],
    },
  },
  { _id: true }
);

// ── Main Sequence schema ──────────────────────────────────────────────────────
// Document DB schema: { userId, name, phases: [] }

const sequenceSchema = new mongoose.Schema(
  {
    // Owner — authenticated user
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
    },

    // Document: name field
    name: {
      type:      String,
      required:  [true, 'Sequence name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [150, 'Name must be at most 150 characters'],
    },

    description: {
      type:      String,
      trim:      true,
      maxlength: [500, 'Description must be at most 500 characters'],
      default:   null,
    },

    isDefault: {
      type:    Boolean,
      default: false,
    },

    isActive: {
      type:    Boolean,
      default: true,
    },

    // Document: phases: []
    // Contains all 5 escalation phases as defined in the document
    phases: {
      type:     [phaseSchema],
      default:  [],
      validate: {
        validator: (arr) => arr.length <= 5,
        message:   'A sequence can have at most 5 phases',
      },
    },

    // Track which invoices are currently running this sequence
    activeInvoiceCount: {
      type:    Number,
      default: 0,
      min:     0,
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

sequenceSchema.index({ userId: 1 });
sequenceSchema.index({ userId: 1, name: 1 });
sequenceSchema.index({ userId: 1, isActive: 1 });
sequenceSchema.index({ userId: 1, isDefault: 1 });

// ── Statics ───────────────────────────────────────────────────────────────────

sequenceSchema.statics.getValidPhaseTypes  = () => VALID_PHASE_TYPES;
sequenceSchema.statics.getValidChannels    = () => VALID_CHANNELS;
sequenceSchema.statics.getValidReminderTypes = () => VALID_REMINDER_TYPES;

const Sequence = mongoose.model('Sequence', sequenceSchema);

module.exports = { Sequence, VALID_CHANNELS, VALID_PHASE_TYPES, VALID_REMINDER_TYPES };