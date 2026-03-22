'use strict';

const mongoose = require('mongoose');

// ── Plan configuration constants ──────────────────────────────────────────────

const PLANS = {
  starter: {
    name:             'Starter',
    price:            29,
    currency:         'usd',
    credits:          500,
    channels:         ['email'],
    apiAccess:        false,
    stripePriceIdEnv: 'STRIPE_STARTER_PRICE_ID',
  },
  pro: {
    name:             'Pro',
    price:            79,
    currency:         'usd',
    credits:          2000,
    channels:         ['email', 'sms'],
    apiAccess:        false,
    stripePriceIdEnv: 'STRIPE_PRO_PRICE_ID',
  },
  enterprise: {
    name:             'Enterprise',
    price:            199,
    currency:         'usd',
    credits:          -1,           // -1 = unlimited
    channels:         ['email', 'sms', 'whatsapp'],
    apiAccess:        true,
    stripePriceIdEnv: 'STRIPE_ENTERPRISE_PRICE_ID',
  },
};

// ── Usage tracking sub-schema ─────────────────────────────────────────────────

const usageSchema = new mongoose.Schema(
  {
    creditsUsed:    { type: Number, default: 0, min: 0 },
    emailsSent:     { type: Number, default: 0, min: 0 },
    smsSent:        { type: Number, default: 0, min: 0 },
    whatsappSent:   { type: Number, default: 0, min: 0 },
    periodStart:    { type: Date,   required: true },
    periodEnd:      { type: Date,   required: true },
  },
  { _id: false }
);

// ── Invoice history sub-schema ────────────────────────────────────────────────

const invoiceHistorySchema = new mongoose.Schema(
  {
    stripeInvoiceId: { type: String },
    amount:          { type: Number, required: true },
    currency:        { type: String, default: 'usd' },
    status:          { type: String, enum: ['paid', 'open', 'void', 'uncollectible'], default: 'open' },
    paidAt:          { type: Date },
    hostedUrl:       { type: String },
    pdfUrl:          { type: String },
  },
  { timestamps: true }
);

// ── Main Billing schema ───────────────────────────────────────────────────────

const billingSchema = new mongoose.Schema(
  {
    // Link to user
    userId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'User ID is required'],
      unique:   true,
    },

    // Current plan from document: starter | pro | enterprise
    plan: {
      type:     String,
      enum:     ['starter', 'pro', 'enterprise'],
      default:  'starter',
      required: true,
    },

    // Subscription lifecycle status
    status: {
      type:    String,
      enum:    ['active', 'inactive', 'past_due', 'cancelled', 'trialing'],
      default: 'inactive',
    },

    // Stripe integration fields
    stripeCustomerId:     { type: String, select: false },
    stripeSubscriptionId: { type: String, select: false },
    stripePriceId:        { type: String, select: false },

    // Billing amounts from document
    amount:      { type: Number, default: 0, min: 0 },
    currency:    { type: String, default: 'usd', lowercase: true },

    // Renewal date from document schema
    renewalDate:      { type: Date },
    currentPeriodStart: { type: Date },
    currentPeriodEnd:   { type: Date },

    // Auto-renewal flag
    cancelAtPeriodEnd: { type: Boolean, default: false },

    // Usage metrics from document
    usage: { type: usageSchema },

    // Invoice history for billing portal
    invoiceHistory: {
      type:    [invoiceHistorySchema],
      default: [],
      select:  false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.stripeCustomerId;
        delete ret.stripeSubscriptionId;
        delete ret.stripePriceId;
        delete ret.invoiceHistory;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

billingSchema.index({ status: 1 });
billingSchema.index({ stripeCustomerId: 1 }, { sparse: true });
billingSchema.index({ stripeSubscriptionId: 1 }, { sparse: true });

// ── Instance methods ──────────────────────────────────────────────────────────

billingSchema.methods.isActive = function () {
  return ['active', 'trialing'].includes(this.status);
};

billingSchema.methods.hasCreditsRemaining = function () {
  const config = PLANS[this.plan];
  if (!config) return false;
  if (config.credits === -1) return true;                     // unlimited
  return (this.usage?.creditsUsed || 0) < config.credits;
};

billingSchema.methods.getRemainingCredits = function () {
  const config = PLANS[this.plan];
  if (!config) return 0;
  if (config.credits === -1) return Infinity;
  return Math.max(0, config.credits - (this.usage?.creditsUsed || 0));
};

billingSchema.methods.canUseChannel = function (channel) {
  const config = PLANS[this.plan];
  if (!config) return false;
  return config.channels.includes(channel);
};

billingSchema.methods.hasApiAccess = function () {
  const config = PLANS[this.plan];
  return config?.apiAccess || false;
};

// ── Static methods ────────────────────────────────────────────────────────────

billingSchema.statics.getPlanConfig = function (plan) {
  return PLANS[plan] || null;
};

billingSchema.statics.getAllPlans = function () {
  return Object.entries(PLANS).map(([key, config]) => ({
    id:       key,
    name:     config.name,
    price:    config.price,
    currency: config.currency,
    credits:  config.credits === -1 ? 'Unlimited' : config.credits,
    channels: config.channels,
    apiAccess: config.apiAccess,
  }));
};

const Billing = mongoose.model('Billing', billingSchema);

module.exports = { Billing, PLANS };


