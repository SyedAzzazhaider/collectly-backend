'use strict';
const mongoose = require('mongoose');
const paymentLinkSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  token: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  status: { 
  type: String, 
  enum: ['active', 'paid', 'expired', 'cancelled'], 
  default: 'active' 
},
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
module.exports = mongoose.model('PaymentLink', paymentLinkSchema);
