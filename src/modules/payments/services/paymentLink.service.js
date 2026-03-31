'use strict';

const crypto = require('crypto');
const PaymentLink = require('../models/PaymentLink.model');
const Invoice = require('../../customers/models/Invoice.model');
const AppError = require('../../../shared/errors/AppError');
const logger = require('../../../shared/utils/logger');

const generateToken = () => crypto.randomBytes(32).toString('hex');

const createPaymentLink = async (userId, { invoiceId, amount, expiresInDays = 7 }) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found', 404);
  if (invoice.status === 'paid') throw new AppError('Invoice already paid', 400);
  
  const outstanding = invoice.amount - invoice.amountPaid;
  const linkAmount = amount || outstanding;
  if (linkAmount > outstanding) throw new AppError('Amount exceeds outstanding balance', 400);
  
  const token = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  
  const paymentLink = await PaymentLink.create({
    userId, invoiceId, customerId: invoice.customerId, token,
    amount: linkAmount, currency: invoice.currency, expiresAt
  });
  
  return { url: \/pay/\, token, expiresAt, amount: linkAmount };
};

const getUserPaymentLinks = async (userId) => {
  return await PaymentLink.find({ userId }).populate('invoiceId', 'invoiceNumber').populate('customerId', 'name').sort({ createdAt: -1 }).lean();
};

module.exports = { createPaymentLink, getUserPaymentLinks };
