'use strict';

const paymentLinkService = require('../services/paymentLink.service');

const sendSuccess = (res, statusCode, message, data = {}) => {
  res.status(statusCode).json({ status: 'success', message, data });
};

const createPaymentLink = async (req, res, next) => {
  try {
    const { invoiceId, amount, expiresInDays } = req.body;
    if (!invoiceId) throw new Error('Invoice ID required');
    const result = await paymentLinkService.createPaymentLink(req.user.id, { invoiceId, amount, expiresInDays });
    sendSuccess(res, 201, 'Payment link created', result);
  } catch (err) { next(err); }
};

const getUserPaymentLinks = async (req, res, next) => {
  try {
    const links = await paymentLinkService.getUserPaymentLinks(req.user.id);
    sendSuccess(res, 200, 'Payment links retrieved', { links });
  } catch (err) { next(err); }
};

module.exports = { createPaymentLink, getUserPaymentLinks };
