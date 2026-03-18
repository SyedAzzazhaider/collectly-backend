'use strict';

const { Billing, PLANS } = require('../models/Billing.model');
const User               = require('../../auth/models/User.model');
const AppError           = require('../../../shared/errors/AppError');
const logger             = require('../../../shared/utils/logger');

// ── Lazy Stripe initialization ─────────────────────────────────────────────────
let _stripe = null;

const getStripe = () => {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('sk_test_your')) return null;
  const Stripe = require('stripe');
  _stripe = Stripe(key);
  return _stripe;
};

const isStripeEnabled = () => !!getStripe();

// ── Helper: get or create Stripe customer ──────────────────────────────────────
const getOrCreateStripeCustomer = async (user, billing) => {
  const stripe = getStripe();
  if (!stripe) return null;

  const billingDoc = await Billing.findById(billing._id)
    .select('+stripeCustomerId');

  if (billingDoc.stripeCustomerId) return billingDoc.stripeCustomerId;

  const customer = await stripe.customers.create({
    email:    user.email,
    name:     user.name,
    metadata: { userId: String(user._id), plan: billing.plan },
  });

  billingDoc.stripeCustomerId = customer.id;
  await billingDoc.save({ validateBeforeSave: false });

  logger.info(`Stripe customer created: ${customer.id} for user ${user._id}`);
  return customer.id;
};

// ── Helper: attach test payment method when none exists ────────────────────────
// Required in test mode because Stripe subscriptions need a payment method.
// Uses Stripe's built-in tok_visa test token — never runs in production.
const ensureTestPaymentMethod = async (stripe, customerId) => {
  if (process.env.NODE_ENV === 'production') return;

  try {
    const existing = await stripe.paymentMethods.list({
      customer: customerId,
      type:     'card',
    });

    if (existing.data.length > 0) return; // already has a payment method

    const pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_visa' },
    });

    await stripe.paymentMethods.attach(pm.id, { customer: customerId });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pm.id },
    });

    logger.info(`Test payment method attached to Stripe customer: ${customerId}`);
  } catch (err) {
    logger.warn(`Could not attach test payment method: ${err.message}`);
  }
};

// ── Helper: resolve Stripe price ID ───────────────────────────────────────────
const getStripePriceId = (plan) => {
  const envMap = {
    starter:    process.env.STRIPE_STARTER_PRICE_ID,
    pro:        process.env.STRIPE_PRO_PRICE_ID,
    enterprise: process.env.STRIPE_ENTERPRISE_PRICE_ID,
  };
  const priceId = envMap[plan];
  if (!priceId) {
    throw new AppError(`Stripe price ID not configured for plan: ${plan}`, 500, 'STRIPE_CONFIG_ERROR');
  }
  return priceId;
};

// ── Helper: build usage period dates ──────────────────────────────────────────
const buildPeriodDates = () => {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  return { periodStart: start, periodEnd: end };
};

// ── Get all available plans ────────────────────────────────────────────────────
const getPlans = () => Billing.getAllPlans();

// ── Get billing record ─────────────────────────────────────────────────────────
const getBilling = async (userId) => {
  let billing = await Billing.findOne({ userId });
  if (!billing) billing = await initializeBilling(userId);
  return billing;
};

// ── Initialize billing record ──────────────────────────────────────────────────
const initializeBilling = async (userId) => {
  const { periodStart, periodEnd } = buildPeriodDates();

  const billing = await Billing.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        plan:     'starter',
        status:   'inactive',
        amount:   0,
        currency: 'usd',
        usage: {
          creditsUsed:  0,
          emailsSent:   0,
          smsSent:      0,
          whatsappSent: 0,
          periodStart,
          periodEnd,
        },
      },
    },
    {
      upsert:              true,
      new:                 true,
      setDefaultsOnInsert: true,
    }
  );

  logger.info(`Billing record ensured for user: ${userId}`);
  return billing;
};

// ── Subscribe to a plan ────────────────────────────────────────────────────────
const subscribe = async (userId, plan) => {
  const planConfig = PLANS[plan];
  if (!planConfig) throw new AppError(`Invalid plan: ${plan}`, 400, 'INVALID_PLAN');

  const user = await User.findById(userId);
  if (!user) throw new AppError('User not found.', 404);

  let billing = await Billing.findOne({ userId })
    .select('+stripeCustomerId +stripeSubscriptionId +stripePriceId');

  if (!billing) {
    await initializeBilling(userId);
    billing = await Billing.findOne({ userId })
      .select('+stripeCustomerId +stripeSubscriptionId +stripePriceId');
  }

  if (billing.plan === plan && billing.isActive()) {
    throw new AppError(
      `You are already subscribed to the ${plan} plan.`,
      409,
      'ALREADY_SUBSCRIBED'
    );
  }

  const stripe = getStripe();

  if (stripe) {
    const customerId = await getOrCreateStripeCustomer(user, billing);
    const priceId    = getStripePriceId(plan);

    // Attach a test payment method in non-production environments
    // so subscriptions don't fail with "no payment source" error
    await ensureTestPaymentMethod(stripe, customerId);

    let subscription;

    if (billing.stripeSubscriptionId) {
      const existing = await stripe.subscriptions.retrieve(billing.stripeSubscriptionId);
      subscription   = await stripe.subscriptions.update(billing.stripeSubscriptionId, {
        items:              [{ id: existing.items.data[0].id, price: priceId }],
        proration_behavior: 'always_invoice',
        metadata:           { userId: String(userId), plan },
      });
    } else {
      subscription = await stripe.subscriptions.create({
        customer: customerId,
        items:    [{ price: priceId }],
        metadata: { userId: String(userId), plan },
        expand:   ['latest_invoice.payment_intent'],
      });
    }

    logger.info(
      `Stripe subscription ${billing.stripeSubscriptionId ? 'updated' : 'created'}: ${subscription.id}`
    );

    const renewalDate = new Date(subscription.current_period_end * 1000);

    billing.stripeSubscriptionId = subscription.id;
    billing.stripePriceId        = priceId;
    billing.plan                 = plan;
    billing.status               = subscription.status === 'active' ? 'active' : 'trialing';
    billing.amount               = planConfig.price;
    billing.currency             = planConfig.currency;
    billing.renewalDate          = renewalDate;
    billing.currentPeriodStart   = new Date(subscription.current_period_start * 1000);
    billing.currentPeriodEnd     = renewalDate;
    billing.cancelAtPeriodEnd    = false;

  } else {
    // Non-Stripe mode — development and test environments without Stripe key
    const now         = new Date();
    const renewalDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    billing.plan               = plan;
    billing.status             = 'active';
    billing.amount             = planConfig.price;
    billing.currency           = planConfig.currency;
    billing.renewalDate        = renewalDate;
    billing.currentPeriodStart = now;
    billing.currentPeriodEnd   = renewalDate;
    billing.cancelAtPeriodEnd  = false;
  }

  const { periodStart, periodEnd } = buildPeriodDates();
  billing.usage = {
    creditsUsed:  0,
    emailsSent:   0,
    smsSent:      0,
    whatsappSent: 0,
    periodStart,
    periodEnd,
  };

  await billing.save({ validateBeforeSave: false });
  await User.findByIdAndUpdate(userId, { subscriptionPlan: plan });

  logger.info(`User ${userId} subscribed to plan: ${plan}`);
  return sanitizeBilling(billing);
};

// ── Change plan ────────────────────────────────────────────────────────────────
const changePlan = async (userId, newPlan) => {
  const billing = await Billing.findOne({ userId })
    .select('+stripeSubscriptionId +stripePriceId');

  if (!billing) {
    throw new AppError('No billing record found. Please subscribe first.', 404, 'BILLING_NOT_FOUND');
  }

  if (billing.plan === newPlan) {
    throw new AppError(`You are already on the ${newPlan} plan.`, 409, 'SAME_PLAN');
  }

  return subscribe(userId, newPlan);
};

// ── Cancel subscription ────────────────────────────────────────────────────────
const cancelSubscription = async (userId) => {
  const billing = await Billing.findOne({ userId })
    .select('+stripeSubscriptionId');

  if (!billing) throw new AppError('No billing record found.', 404, 'BILLING_NOT_FOUND');
  if (!billing.isActive()) throw new AppError('No active subscription to cancel.', 400, 'NO_ACTIVE_SUBSCRIPTION');

  const stripe = getStripe();
  if (stripe && billing.stripeSubscriptionId) {
    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    logger.info(`Stripe subscription set to cancel at period end: ${billing.stripeSubscriptionId}`);
  }

  billing.cancelAtPeriodEnd = true;
  await billing.save({ validateBeforeSave: false });

  logger.info(`Subscription cancellation scheduled for user: ${userId}`);
  return sanitizeBilling(billing);
};

// ── Reactivate subscription ────────────────────────────────────────────────────
const reactivateSubscription = async (userId) => {
  const billing = await Billing.findOne({ userId })
    .select('+stripeSubscriptionId');

  if (!billing) throw new AppError('No billing record found.', 404, 'BILLING_NOT_FOUND');
  if (!billing.cancelAtPeriodEnd) {
    throw new AppError('Subscription is not scheduled for cancellation.', 400, 'NOT_CANCELLED');
  }

  const stripe = getStripe();
  if (stripe && billing.stripeSubscriptionId) {
    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
    logger.info(`Stripe subscription reactivated: ${billing.stripeSubscriptionId}`);
  }

  billing.cancelAtPeriodEnd = false;
  await billing.save({ validateBeforeSave: false });

  logger.info(`Subscription reactivated for user: ${userId}`);
  return sanitizeBilling(billing);
};

// ── Get usage metrics ──────────────────────────────────────────────────────────
const getUsage = async (userId) => {
  const billing = await Billing.findOne({ userId });
  if (!billing) throw new AppError('No billing record found.', 404, 'BILLING_NOT_FOUND');

  const planConfig       = PLANS[billing.plan];
  const creditsTotal     = planConfig?.credits === -1 ? null : planConfig?.credits;
  const creditsUsed      = billing.usage?.creditsUsed || 0;
  const creditsRemaining = creditsTotal === null
    ? null
    : Math.max(0, creditsTotal - creditsUsed);

  return {
    plan:   billing.plan,
    status: billing.status,
    credits: {
      total:     creditsTotal     === null ? 'Unlimited' : creditsTotal,
      used:      creditsUsed,
      remaining: creditsRemaining === null ? 'Unlimited' : creditsRemaining,
    },
    channels: {
      email:    billing.usage?.emailsSent   || 0,
      sms:      billing.usage?.smsSent      || 0,
      whatsapp: billing.usage?.whatsappSent || 0,
    },
    period: {
      start: billing.usage?.periodStart,
      end:   billing.usage?.periodEnd,
    },
    allowedChannels: planConfig?.channels  || [],
    apiAccess:       planConfig?.apiAccess || false,
  };
};

// ── Increment usage ────────────────────────────────────────────────────────────
const incrementUsage = async (userId, channel, count = 1) => {
  const billing = await Billing.findOne({ userId });
  if (!billing) throw new AppError('No billing record found.', 404, 'BILLING_NOT_FOUND');
  if (!billing.isActive()) throw new AppError('No active subscription.', 403, 'SUBSCRIPTION_INACTIVE');

  if (!billing.canUseChannel(channel)) {
    throw new AppError(
      `Your ${billing.plan} plan does not include ${channel} channel.`,
      403,
      'CHANNEL_NOT_ALLOWED'
    );
  }

  const planConfig = PLANS[billing.plan];
  if (planConfig.credits !== -1) {
    const remaining = billing.getRemainingCredits();
    if (remaining < count) {
      throw new AppError(
        `Insufficient credits. You have ${remaining} credits remaining.`,
        402,
        'INSUFFICIENT_CREDITS'
      );
    }
  }

  billing.usage.creditsUsed += count;

  const channelMap = { email: 'emailsSent', sms: 'smsSent', whatsapp: 'whatsappSent' };
  const field      = channelMap[channel];
  if (field) billing.usage[field] += count;

  await billing.save({ validateBeforeSave: false });

  logger.info(`Usage incremented: user=${userId} channel=${channel} count=${count}`);

  return {
    creditsUsed:      billing.usage.creditsUsed,
    creditsRemaining: billing.getRemainingCredits(),
  };
};

// ── Get invoice history ────────────────────────────────────────────────────────
const getInvoiceHistory = async (userId) => {
  let billing = await Billing.findOne({ userId }).select('+invoiceHistory +stripeCustomerId');
  if (!billing) billing = await initializeBilling(userId);
  billing = await Billing.findOne({ userId }).select('+invoiceHistory +stripeCustomerId');

  const stripe = getStripe();
  if (stripe && billing.stripeCustomerId) {
    try {
      const invoices = await stripe.invoices.list({
        customer: billing.stripeCustomerId,
        limit:    20,
      });
      return invoices.data.map((inv) => ({
        id:       inv.id,
        amount:   inv.amount_paid / 100,
        currency: inv.currency,
        status:   inv.status,
        paidAt:   inv.status_transitions?.paid_at
          ? new Date(inv.status_transitions.paid_at * 1000)
          : null,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl:    inv.invoice_pdf,
        period: {
          start: new Date(inv.period_start * 1000),
          end:   new Date(inv.period_end   * 1000),
        },
      }));
    } catch (err) {
      logger.warn(`Could not fetch Stripe invoices: ${err.message}`);
    }
  }

  return billing.invoiceHistory || [];
};

// ── Handle Stripe webhook ──────────────────────────────────────────────────────
const handleStripeWebhook = async (rawBody, signature) => {
  const stripe = getStripe();
  if (!stripe) throw new AppError('Stripe is not configured.', 503, 'STRIPE_DISABLED');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.warn(`Stripe webhook verification failed: ${err.message}`);
    throw new AppError(`Webhook error: ${err.message}`, 400, 'WEBHOOK_SIGNATURE_INVALID');
  }

  logger.info(`Stripe webhook received: ${event.type}`);

  switch (event.type) {

    case 'invoice.payment_succeeded': {
      const invoice      = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId       = subscription.metadata?.userId;
      if (!userId) break;

      const billing = await Billing.findOne({ userId }).select('+invoiceHistory');
      if (!billing) break;

      billing.status             = 'active';
      billing.renewalDate        = new Date(subscription.current_period_end   * 1000);
      billing.currentPeriodEnd   = new Date(subscription.current_period_end   * 1000);
      billing.currentPeriodStart = new Date(subscription.current_period_start * 1000);

      const { periodStart, periodEnd } = buildPeriodDates();
      billing.usage = {
        creditsUsed: 0, emailsSent: 0, smsSent: 0, whatsappSent: 0,
        periodStart, periodEnd,
      };

      billing.invoiceHistory.push({
        stripeInvoiceId: invoice.id,
        amount:          invoice.amount_paid / 100,
        currency:        invoice.currency,
        status:          'paid',
        paidAt:          new Date(),
        hostedUrl:       invoice.hosted_invoice_url,
        pdfUrl:          invoice.invoice_pdf,
      });

      await billing.save({ validateBeforeSave: false });
      logger.info(`Payment succeeded — billing renewed for user: ${userId}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice      = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId       = subscription.metadata?.userId;
      if (!userId) break;
      await Billing.findOneAndUpdate({ userId }, { status: 'past_due' });
      logger.warn(`Payment failed for user: ${userId}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId       = subscription.metadata?.userId;
      if (!userId) break;
      await Billing.findOneAndUpdate(
        { userId },
        { status: 'cancelled', cancelAtPeriodEnd: false, plan: 'starter' }
      );
      await User.findByIdAndUpdate(userId, { subscriptionPlan: 'starter' });
      logger.info(`Subscription cancelled for user: ${userId}`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const userId       = subscription.metadata?.userId;
      if (!userId) break;
      const billing = await Billing.findOne({ userId });
      if (!billing) break;
      billing.status            = subscription.status;
      billing.cancelAtPeriodEnd = subscription.cancel_at_period_end;
      billing.renewalDate       = new Date(subscription.current_period_end * 1000);
      await billing.save({ validateBeforeSave: false });
      logger.info(`Subscription updated for user: ${userId}`);
      break;
    }

    default:
      logger.info(`Unhandled Stripe webhook event: ${event.type}`);
  }

  return { received: true, type: event.type };
};

// ── Admin: list all billing records ───────────────────────────────────────────
const getAllBillingAdmin = async ({ page = 1, limit = 20, status, plan } = {}) => {
  const query = {};
  if (status) query.status = status;
  if (plan)   query.plan   = plan;

  const skip  = (page - 1) * limit;
  const total = await Billing.countDocuments(query);

  const records = await Billing.find(query)
    .populate('userId', 'name email createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    records,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Sanitize billing for client response ──────────────────────────────────────
const sanitizeBilling = (billing) => {
  const obj = billing.toObject ? billing.toObject() : { ...billing };
  delete obj.stripeCustomerId;
  delete obj.stripeSubscriptionId;
  delete obj.stripePriceId;
  delete obj.invoiceHistory;
  delete obj.__v;
  return obj;
};

// ── Exports ────────────────────────────────────────────────────────────────────
module.exports = {
  getPlans,
  getBilling,
  initializeBilling,
  subscribe,
  changePlan,
  cancelSubscription,
  reactivateSubscription,
  getUsage,
  incrementUsage,
  getInvoiceHistory,
  handleStripeWebhook,
  getAllBillingAdmin,
};