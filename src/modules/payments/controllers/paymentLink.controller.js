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

const cancelPaymentLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const paymentLink = await paymentLinkService.cancelPaymentLink(req.user.id, id);
    sendSuccess(res, 200, 'Payment link cancelled', { paymentLink });
  } catch (err) { next(err); }
};

// ✅ ADD THIS PUBLIC FUNCTION
const getPublicPaymentLink = async (req, res, next) => {
  try {
    const { token } = req.params;
    const paymentLink = await paymentLinkService.getPaymentLinkByToken(token);
    sendSuccess(res, 200, 'Payment link retrieved', { paymentLink });
  } catch (err) { next(err); }
};



// Add this function
const createCheckoutSession = async (req, res, next) => {
  try {
    const { paymentLinkId, amount } = req.body;
    
    const paymentLink = await paymentLinkService.getPaymentLinkById(paymentLinkId);
    
    if (!paymentLink || paymentLink.status !== 'active') {
      throw new AppError('Payment link not found or expired', 404);
    }
    
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: paymentLink.currency.toLowerCase(),
          product_data: {
            name: `Invoice ${paymentLink.invoiceId?.invoiceNumber}`,
          },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&token=${paymentLink.token}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancel?token=${paymentLink.token}`,
      metadata: {
        paymentLinkId: paymentLink._id.toString(),
        token: paymentLink.token,
      },
    });
    
    res.status(200).json({ status: 'success', data: { url: session.url } });
  } catch (err) { next(err); }
};

module.exports = {
  createPaymentLink,
  getUserPaymentLinks,
  cancelPaymentLink,
  getPublicPaymentLink,
  createCheckoutSession,  // ← ADD THIS
};