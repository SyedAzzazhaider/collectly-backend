'use strict';

const { PaymentPlan } = require('../models/PaymentPlan.model');
const Invoice         = require('../../customers/models/Invoice.model');
const Customer        = require('../../customers/models/Customer.model');
const AppError        = require('../../../shared/errors/AppError');
const logger          = require('../../../shared/utils/logger');

// -- Generate installment schedule ---------------------------------------------

const generateInstallments = (totalAmount, numberOfInstallments, frequency, startDate) => {
  const installments   = [];
  const perInstallment = Math.floor((totalAmount / numberOfInstallments) * 100) / 100;
  let remainder        = Math.round((totalAmount - perInstallment * numberOfInstallments) * 100) / 100;

  const frequencyDays = { weekly: 7, biweekly: 14, monthly: 30 };
  const daysGap       = frequencyDays[frequency] || 30;
  let currentDate     = new Date(startDate);

  for (let i = 1; i <= numberOfInstallments; i++) {
    const isLast = i === numberOfInstallments;
    const amount = isLast
      ? Math.round((perInstallment + remainder) * 100) / 100
      : perInstallment;

    installments.push({
      installmentNumber: i,
      amount,
      dueDate: new Date(currentDate),
      status:  'pending',
    });

    currentDate = new Date(currentDate);
    currentDate.setDate(currentDate.getDate() + daysGap);
  }

  return installments;
};

// -- Create payment plan -------------------------------------------------------

const createPaymentPlan = async (userId, data) => {
  const {
    customerId, invoiceId, totalAmount, currency = 'USD',
    numberOfInstallments, frequency, startDate, notes = null,
  } = data;

  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (['paid', 'cancelled'].includes(invoice.status)) {
    throw new AppError(
      `Cannot create a payment plan for a ${invoice.status} invoice.`,
      400,
      'INVOICE_NOT_ELIGIBLE'
    );
  }

  const existingActive = await PaymentPlan.findOne({
    userId,
    invoiceId,
    status: { $in: ['proposed', 'accepted', 'active'] },
  });

  if (existingActive) {
    throw new AppError(
      'An active payment plan already exists for this invoice.',
      409,
      'PAYMENT_PLAN_EXISTS'
    );
  }

  const installments = generateInstallments(
    Number(totalAmount),
    Number(numberOfInstallments),
    frequency,
    startDate
  );

  const plan = await PaymentPlan.create({
    userId,
    customerId,
    invoiceId,
    status:               'proposed',
    totalAmount:          Number(totalAmount),
    currency:             currency.toUpperCase(),
    numberOfInstallments: Number(numberOfInstallments),
    frequency,
    startDate:            new Date(startDate),
    installments,
    amountPaid:           0,
    notes,
    createdBy:            userId,
    proposedAt:           new Date(),
  });

  logger.info(`Payment plan created: ${plan._id} invoice=${invoiceId} user=${userId}`);
  return plan;
};

// -- Get payment plans ---------------------------------------------------------

const getPaymentPlans = async (userId, {
  page       = 1,
  limit      = 20,
  status     = null,
  customerId = null,
  invoiceId  = null,
} = {}) => {
  const query = { userId };
  if (status)     query.status     = status;
  if (customerId) query.customerId = customerId;
  if (invoiceId)  query.invoiceId  = invoiceId;

  const skip  = (page - 1) * limit;
  const total = await PaymentPlan.countDocuments(query);
  const plans = await PaymentPlan.find(query)
    .populate('customerId', 'name email company')
    .populate('invoiceId',  'invoiceNumber amount status')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    plans,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// -- Get payment plan by ID ----------------------------------------------------

const getPaymentPlanById = async (userId, planId) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId })
    .populate('customerId', 'name email company')
    .populate('invoiceId',  'invoiceNumber amount currency status');

  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');
  return plan;
};

// -- Accept payment plan -------------------------------------------------------

const acceptPaymentPlan = async (userId, planId) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');

  if (plan.status !== 'proposed') {
    throw new AppError(
      `Cannot accept a payment plan with status: ${plan.status}.`,
      400,
      'PAYMENT_PLAN_NOT_PROPOSED'
    );
  }

  plan.status     = 'active';
  plan.acceptedAt = new Date();
  await plan.save();

  logger.info(`Payment plan accepted: ${planId} by user ${userId}`);
  return plan;
};

// -- Reject payment plan -------------------------------------------------------

const rejectPaymentPlan = async (userId, planId, rejectionReason = null) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');

  if (!['proposed', 'active'].includes(plan.status)) {
    throw new AppError(
      `Cannot reject a payment plan with status: ${plan.status}.`,
      400,
      'PAYMENT_PLAN_NOT_REJECTABLE'
    );
  }

  plan.status          = 'rejected';
  plan.rejectedAt      = new Date();
  plan.rejectionReason = rejectionReason || null;
  await plan.save();

  logger.info(`Payment plan rejected: ${planId} by user ${userId}`);
  return plan;
};

// -- Cancel payment plan -------------------------------------------------------

const cancelPaymentPlan = async (userId, planId) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');

  if (['completed', 'rejected'].includes(plan.status)) {
    throw new AppError(
      `Cannot cancel a ${plan.status} payment plan.`,
      400,
      'PAYMENT_PLAN_NOT_CANCELLABLE'
    );
  }

  plan.status     = 'rejected';
  plan.rejectedAt = new Date();
  await plan.save();

  logger.info(`Payment plan cancelled: ${planId} by user ${userId}`);
  return plan;
};

// -- Record installment payment ------------------------------------------------

const recordInstallmentPayment = async (userId, planId, installmentId, paidAmount) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId }).populate('invoiceId');
  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');

  if (['completed', 'defaulted', 'rejected'].includes(plan.status)) {
    throw new AppError(
      `Cannot record payment on a ${plan.status} plan.`,
      400,
      'PLAN_NOT_ACTIVE'
    );
  }

  const installment = plan.installments.id(installmentId);
  if (!installment) throw new AppError('Installment not found.', 404, 'INSTALLMENT_NOT_FOUND');
  if (installment.status === 'paid') throw new AppError('Installment is already paid.', 400, 'INSTALLMENT_ALREADY_PAID');

  const amount = Number(paidAmount);
  if (!amount || amount <= 0) throw new AppError('Payment amount must be greater than 0.', 400, 'INVALID_AMOUNT');

  installment.paidAmount = (installment.paidAmount || 0) + amount;
  installment.paidAt     = new Date();
  installment.status     = installment.paidAmount >= installment.amount ? 'paid' : 'partial';

  plan.amountPaid = (plan.amountPaid || 0) + amount;

  if (['proposed', 'accepted'].includes(plan.status)) {
    plan.status = 'active';
  }

  const allPaid = plan.installments.every((i) => i.status === 'paid');
  if (allPaid) {
    plan.status      = 'completed';
    plan.completedAt = new Date();
  }

  await plan.save();

  try {
    const invoiceService = require('../../customers/services/invoice.service');
    await invoiceService.recordPayment(
      userId,
      String(plan.invoiceId._id || plan.invoiceId),
      amount
    );
  } catch (invoiceErr) {
    logger.warn(
      `Installment recorded but invoice sync failed: planId=${planId} error=${invoiceErr.message}`
    );
  }

  logger.info(
    `Installment payment recorded: planId=${planId} installmentId=${installmentId} amount=${amount} userId=${userId}`
  );

  return plan;
};

// -- Generate Stripe payment link for an installment ---------------------------

const generateStripePaymentLink = async (userId, planId, installmentNumber) => {
  const plan = await PaymentPlan.findOne({ _id: planId, userId });
  if (!plan) throw new AppError('Payment plan not found.', 404, 'PAYMENT_PLAN_NOT_FOUND');

  const installment = plan.installments.find(
    (i) => i.installmentNumber === installmentNumber
  );
  if (!installment) throw new AppError('Installment not found.', 404, 'INSTALLMENT_NOT_FOUND');
  if (installment.status === 'paid') throw new AppError('Installment already paid.', 400, 'ALREADY_PAID');

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || stripeKey.includes('your_')) {
    throw new AppError('Stripe not configured.', 503, 'STRIPE_NOT_CONFIGURED');
  }

  const stripe      = require('stripe')(stripeKey);
  const amountCents = Math.round(installment.amount * 100);
  const currency    = (plan.currency || 'usd').toLowerCase();

  const price = await stripe.prices.create({
    currency,
    unit_amount:  amountCents,
    product_data: { name: `Payment Plan Installment #${installmentNumber}` },
  });

  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: {
      planId:            String(planId),
      installmentNumber: String(installmentNumber),
      userId:            String(userId),
    },
    after_completion: {
      type:     'redirect',
      redirect: { url: `${process.env.FRONTEND_URL}/payment/success` },
    },
  });

  installment.paymentLink = paymentLink.url;
  await plan.save({ validateBeforeSave: false });

  logger.info(`Stripe payment link generated: planId=${planId} installment=${installmentNumber}`);
  return { paymentLink: paymentLink.url, stripeId: paymentLink.id };
};

// -- Exports -------------------------------------------------------------------

module.exports = {
  generateInstallments,
  createPaymentPlan,
  getPaymentPlans,
  getPaymentPlanById,
  acceptPaymentPlan,
  rejectPaymentPlan,
  cancelPaymentPlan,
  recordInstallmentPayment,
  generateStripePaymentLink,
};
