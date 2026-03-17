'use strict';
const Customer = require('../models/Customer.model');
const Invoice  = require('../models/Invoice.model');
const AppError = require('../../../shared/errors/AppError');
const logger   = require('../../../shared/utils/logger');

// BUG-09 FIX: Escape user input before using in MongoDB $regex to prevent ReDoS
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ── Create customer ───────────────────────────────────────────────────────────

const createCustomer = async (userId, data) => {
  const { name, email, phone, company, timezone, preferences, address, tags, notes } = data;

  // Enforce unique email per user account
  const existing = await Customer.findOne({
    userId,
    email: email.toLowerCase(),
  });
  if (existing) {
    throw new AppError(
      'A customer with this email already exists in your account.',
      409,
      'DUPLICATE_CUSTOMER_EMAIL'
    );
  }

  const customer = await Customer.create({
    userId,
    name,
    email: email.toLowerCase(),
    phone:       phone       || null,
    company:     company     || null,
    timezone:    timezone    || 'UTC',
    preferences: preferences || { channels: ['email'] },
    address:     address     || {},
    tags:        tags        || [],
    notes:       notes       || null,
  });

  logger.info(`Customer created: ${customer._id} by user: ${userId}`);
  return customer;
};

// ── Get all customers (with search & filters) ─────────────────────────────────

const getCustomers = async (userId, {
  page     = 1,
  limit    = 20,
  search   = null,
  tags     = null,
  isActive = null,
} = {}) => {
  const query = { userId };

  // Document: Search by customer name
  // Document: Search by customer name
  if (search) {
    const safe = escapeRegex(search.trim()); // BUG-09 FIX
    query.$or = [
      { name:    { $regex: safe, $options: 'i' } },
      { email:   { $regex: safe, $options: 'i' } },
      { company: { $regex: safe, $options: 'i' } },
    ];
  }

  // Document: Filter by tags
  if (tags) {
    const tagArray  = Array.isArray(tags) ? tags : [tags];
    query.tags      = { $in: tagArray };
  }

  if (isActive !== null) {
    query.isActive = isActive === 'true' || isActive === true;
  }

  const skip  = (page - 1) * limit;
  const total = await Customer.countDocuments(query);

  const customers = await Customer.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    customers,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// ── Get single customer ───────────────────────────────────────────────────────

const getCustomerById = async (userId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }
  return customer;
};

// ── Update customer ───────────────────────────────────────────────────────────

const updateCustomer = async (userId, customerId, data) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  // If email is being changed, check for duplicates
  if (data.email && data.email.toLowerCase() !== customer.email) {
    const duplicate = await Customer.findOne({
      userId,
      email: data.email.toLowerCase(),
      _id:   { $ne: customerId },
    });
    if (duplicate) {
      throw new AppError(
        'A customer with this email already exists.',
        409,
        'DUPLICATE_CUSTOMER_EMAIL'
      );
    }
  }

  const allowedFields = [
    'name', 'email', 'phone', 'company', 'timezone',
    'preferences', 'address', 'tags', 'notes', 'isActive',
  ];

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      customer[field] = data[field];
    }
  });

  await customer.save();

  logger.info(`Customer updated: ${customerId} by user: ${userId}`);
  return customer;
};

// ── Delete customer ───────────────────────────────────────────────────────────

const deleteCustomer = async (userId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const outstanding = await Invoice.countDocuments({
    customerId,
    userId,
    status: { $in: ['pending', 'overdue', 'partial'] },
  });

  if (outstanding > 0) {
    throw new AppError(
      `Cannot delete customer with ${outstanding} outstanding invoice(s). Settle or cancel them first.`,
      400,
      'CUSTOMER_HAS_OUTSTANDING_INVOICES'
    );
  }

  await Customer.deleteOne({ _id: customerId, userId });

  logger.info(`Customer deleted: ${customerId} by user: ${userId}`);
  return { deleted: true, customerId };
};


// ── Get customer invoice summary ──────────────────────────────────────────────

const getCustomerSummary = async (userId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const invoices = await Invoice.find({ customerId, userId }).lean();

  const summary = {
    total:     invoices.length,
    pending:   invoices.filter((i) => i.status === 'pending').length,
    paid:      invoices.filter((i) => i.status === 'paid').length,
    overdue:   invoices.filter((i) => i.status === 'overdue').length,
    partial:   invoices.filter((i) => i.status === 'partial').length,
    cancelled: invoices.filter((i) => i.status === 'cancelled').length,
    totalAmount:      invoices.reduce((s, i) => s + i.amount, 0),
    totalPaid:        invoices.reduce((s, i) => s + i.amountPaid, 0),
    totalOutstanding: invoices
      .filter((i) => !['paid', 'cancelled'].includes(i.status))
      .reduce((s, i) => s + (i.amount - i.amountPaid), 0),
  };

  return { customer, summary };
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getCustomerSummary,
};