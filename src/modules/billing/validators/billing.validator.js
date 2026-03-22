'use strict';

const AppError = require('../../../shared/errors/AppError');

const VALID_PLANS     = ['starter', 'pro', 'enterprise'];
const VALID_CHANNELS  = ['email', 'sms', 'whatsapp'];

const validationError = (message, fields = {}) => {
  const err    = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields   = fields;
  return err;
};

// ── Validate subscribe request ────────────────────────────────────────────────

const validateSubscribe = (req, res, next) => {
  try {
    const { plan } = req.body;
    const errors   = {};

    if (!plan) {
      errors.plan = 'Plan is required';
    } else if (!VALID_PLANS.includes(plan)) {
      errors.plan = `Plan must be one of: ${VALID_PLANS.join(', ')}`;
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Subscription validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate plan change request ──────────────────────────────────────────────

const validateChangePlan = (req, res, next) => {
  try {
    const { plan } = req.body;
    const errors   = {};

    if (!plan) {
      errors.plan = 'New plan is required';
    } else if (!VALID_PLANS.includes(plan)) {
      errors.plan = `Plan must be one of: ${VALID_PLANS.join(', ')}`;
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Plan change validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate usage increment request ─────────────────────────────────────────

const validateIncrementUsage = (req, res, next) => {
  try {
    const { channel, count } = req.body;
    const errors             = {};

    if (!channel) {
      errors.channel = 'Channel is required';
    } else if (!VALID_CHANNELS.includes(channel)) {
      errors.channel = `Channel must be one of: ${VALID_CHANNELS.join(', ')}`;
    }

    if (count !== undefined) {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        errors.count = 'Count must be a positive integer between 1 and 1000';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Usage validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Validate Stripe webhook ───────────────────────────────────────────────────

const validateWebhookSignature = (req, res, next) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return next(new AppError('Webhook signature missing', 400, 'MISSING_SIGNATURE'));
  }
  next();
};

module.exports = {
  validateSubscribe,
  validateChangePlan,
  validateIncrementUsage,
  validateWebhookSignature,
};

