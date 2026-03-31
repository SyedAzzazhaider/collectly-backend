'use strict';

const crypto = require('crypto');
const PaymentLink = require('../models/PaymentLink.model');

const createPaymentLink = async (userId, { invoiceId, amount, expiresInDays = 7 }) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  
  const paymentLink = await PaymentLink.create({
    userId,
    invoiceId,
    customerId: userId,
    token,
    amount: amount || 100,
    currency: 'USD',
    expiresAt
  });
  
  return { url: \/pay/\, token, expiresAt, amount: paymentLink.amount };
};

const getUserPaymentLinks = async (userId) => {
  return await PaymentLink.find({ userId }).sort({ createdAt: -1 }).lean();
};

module.exports = { createPaymentLink, getUserPaymentLinks };
