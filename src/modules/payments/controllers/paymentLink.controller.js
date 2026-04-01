'use strict';

const paymentLinkService = require('../services/paymentLink.service');

const sendSuccess = (res, code, msg, data) => 
  res.status(code).json({ status: 'success', message: msg, data });

const createPaymentLink = async (req, res, next) => {
  try {
    const result = await paymentLinkService.createPaymentLink(req.user.id, req.body);
    sendSuccess(res, 201, 'Payment link created', result);
  } catch (err) { next(err); }
};

const getUserPaymentLinks = async (req, res, next) => {
  try {
    const links = await paymentLinkService.getUserPaymentLinks(req.user.id);
    sendSuccess(res, 200, 'Payment links retrieved', { links });
  } catch (err) { next(err); }
};

// ✅ ADD THIS FUNCTION
const cancelPaymentLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentLink = await paymentLinkService.cancelPaymentLink(req.user.id, id);
    sendSuccess(res, 200, 'Payment link cancelled', { paymentLink });
  } catch (err) { next(err); }
};

module.exports = { 
  createPaymentLink, 
  getUserPaymentLinks, 
  cancelPaymentLink  // ✅ ADD THIS
};