'use strict';

const crypto = require('crypto');
const PaymentLink = require('../models/PaymentLink.model');
const Invoice = require('../../customers/models/Invoice.model');
const Customer = require('../../customers/models/Customer.model');
const AppError = require('../../../shared/errors/AppError');
const logger = require('../../../shared/utils/logger');

const generateToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Create a payment link for an invoice
 */
const createPaymentLink = async (userId, { invoiceId, amount, expiresInDays = 7 }) => {
  // Verify invoice belongs to user
  const invoice = await Invoice.findOne({ _id: invoiceId, userId }).populate('customerId', 'name email');
  if (!invoice) {
    throw new AppError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
  }
  
  // Check if invoice is already paid
  if (invoice.status === 'paid') {
    throw new AppError('Invoice is already paid', 400, 'INVOICE_ALREADY_PAID');
  }
  
  // Calculate outstanding amount
  const outstanding = invoice.amount - invoice.amountPaid;
  const linkAmount = amount || outstanding;
  
  if (linkAmount <= 0) {
    throw new AppError('Amount must be greater than 0', 400, 'INVALID_AMOUNT');
  }
  
  if (linkAmount > outstanding) {
    throw new AppError(`Amount exceeds outstanding balance of ${outstanding}`, 400, 'AMOUNT_EXCEEDS_BALANCE');
  }
  
  // Generate unique token
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  
  // Check if active link already exists for this invoice
  const existing = await PaymentLink.findOne({
    invoiceId,
    status: 'active',
    expiresAt: { $gt: new Date() }
  });
  
  if (existing) {
    // Return existing active link
    logger.info(`Returning existing payment link for invoice ${invoiceId}`);
    return {
      url: `${process.env.FRONTEND_URL}/pay/${existing.token}`,
      token: existing.token,
      expiresAt: existing.expiresAt,
      amount: existing.amount,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerId?.name || 'Customer',
      isNew: false,
    };
  }
  
  // Create new payment link
  const paymentLink = await PaymentLink.create({
    userId,
    invoiceId,
    customerId: invoice.customerId?._id || invoice.customerId,
    token,
    amount: linkAmount,
    currency: invoice.currency,
    expiresAt
  });
  
  logger.info(`Payment link created: ${paymentLink._id} for invoice ${invoiceId} by user ${userId}`);
  
  return {
    url: `${process.env.FRONTEND_URL}/pay/${token}`,
    token,
    expiresAt,
    amount: linkAmount,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerId?.name || 'Customer',
    isNew: true,
  };
};

/**
 * Get payment link by token (public endpoint)
 */
const getPaymentLinkByToken = async (token) => {
  const paymentLink = await PaymentLink.findOne({
    token,
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).populate('invoiceId', 'invoiceNumber amount dueDate status')
    .populate('customerId', 'name email');
  
  if (!paymentLink) {
    throw new AppError('Payment link not found or expired', 404, 'PAYMENT_LINK_NOT_FOUND');
  }
  
  return paymentLink;
};

/**
 * Get all payment links for a user (with populated data)
 */
const getUserPaymentLinks = async (userId, { page = 1, limit = 20, status = null } = {}) => {
  const query = { userId };
  if (status) query.status = status;
  
  const skip = (page - 1) * limit;
  const total = await PaymentLink.countDocuments(query);
  
  const links = await PaymentLink.find(query)
    .populate('invoiceId', 'invoiceNumber amount dueDate currency')
    .populate('customerId', 'name email phone')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  
  return {
    links,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

/**
 * Mark payment link as paid (called after successful payment)
 */
const markPaymentLinkPaid = async (token, paymentIntentId) => {
  const paymentLink = await PaymentLink.findOne({ token, status: 'active' });
  if (!paymentLink) {
    return null;
  }
  
  paymentLink.status = 'paid';
  paymentLink.paymentIntentId = paymentIntentId;
  await paymentLink.save();
  
  logger.info(`Payment link marked as paid: ${paymentLink._id}`);
  return paymentLink;
};

/**
 * Cancel a payment link
 */
const cancelPaymentLink = async (userId, linkId) => {
  const paymentLink = await PaymentLink.findOne({ _id: linkId, userId });
  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'PAYMENT_LINK_NOT_FOUND');
  }
  
  if (paymentLink.status !== 'active') {
    throw new AppError(`Cannot cancel link with status: ${paymentLink.status}`, 400, 'INVALID_STATUS');
  }
  
  paymentLink.status = 'cancelled';
  await paymentLink.save();
  
  logger.info(`Payment link cancelled: ${paymentLink._id}`);
  return paymentLink;
};

/**
 * Get payment link by ID
 */
const getPaymentLinkById = async (linkId) => {
  const paymentLink = await PaymentLink.findById(linkId)
    .populate('invoiceId', 'invoiceNumber amount')
    .populate('customerId', 'name email');
  
  if (!paymentLink) {
    throw new AppError('Payment link not found', 404);
  }
  
  return paymentLink;
};

// ✅ ADD THIS FUNCTION - Update payment link
const updatePaymentLink = async (linkId, updates) => {
  const paymentLink = await PaymentLink.findByIdAndUpdate(
    linkId,
    { $set: updates },
    { new: true, runValidators: true }
  );
  
  if (!paymentLink) {
    throw new AppError('Payment link not found', 404, 'PAYMENT_LINK_NOT_FOUND');
  }
  
  logger.info(`Payment link updated: ${linkId} - Status: ${updates.status}`);
  return paymentLink;
};

module.exports = {
  createPaymentLink,
  getPaymentLinkByToken,
  getUserPaymentLinks,
  markPaymentLinkPaid,
  cancelPaymentLink,
  getPaymentLinkById,
  updatePaymentLink,  // ← ADD THIS
};