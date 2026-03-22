'use strict';

const Invoice  = require('../../customers/models/Invoice.model');
const Customer = require('../../customers/models/Customer.model');
const AppError = require('../../../shared/errors/AppError');
const logger   = require('../../../shared/utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSort = (sortBy, sortOrder) => {
  const order = sortOrder === 'asc' ? 1 : -1;
  const sortMap = {
    dueDate:       { dueDate:       order },
    amount:        { amount:        order },
    createdAt:     { createdAt:     order },
    invoiceNumber: { invoiceNumber: order },
    name:          { name:          order },
  };
  return sortMap[sortBy] || { createdAt: -1 };
};

// ── Search invoices ───────────────────────────────────────────────────────────
// Spec: Search by invoice number, customer name, due date range, status, tags

const searchInvoices = async (userId, {
  q           = null,
  status      = null,
  tags        = null,
  dueDateFrom = null,
  dueDateTo   = null,
  sortBy      = 'createdAt',
  sortOrder   = 'desc',
  page        = 1,
  limit       = 20,
} = {}) => {
  const query = { userId };

  // Spec: Search by invoice number OR customer name (via populated join)
  if (q && q.trim().length > 0) {
    const safe = escapeRegex(q.trim());

    // Find matching customer IDs first for customer name search
    const matchingCustomers = await Customer.find({
      userId,
      $or: [
        { name:    { $regex: safe, $options: 'i' } },
        { company: { $regex: safe, $options: 'i' } },
        { email:   { $regex: safe, $options: 'i' } },
      ],
    }).select('_id').lean();

    const customerIds = matchingCustomers.map((c) => c._id);

    // Spec: Search by invoice number or customer name
    query.$or = [
      { invoiceNumber: { $regex: safe, $options: 'i' } },
      ...(customerIds.length > 0 ? [{ customerId: { $in: customerIds } }] : []),
    ];
  }

  // Spec: Filter by status
  if (status) query.status = status;

  // Spec: Filter by tags
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    query.tags     = { $in: tagArray };
  }

  // Spec: Filter by due date range
  if (dueDateFrom || dueDateTo) {
    query.dueDate = {};
    if (dueDateFrom) query.dueDate.$gte = new Date(dueDateFrom);
    if (dueDateTo)   query.dueDate.$lte = new Date(dueDateTo);
  }

  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(query);
  const sort  = buildSort(sortBy, sortOrder);

  const invoices = await Invoice.find(query)
    .populate('customerId', 'name email company phone timezone')
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    filters: { q, status, tags, dueDateFrom, dueDateTo, sortBy, sortOrder },
  };
};

// ── Search customers ──────────────────────────────────────────────────────────

const searchCustomers = async (userId, {
  q         = null,
  tags      = null,
  isActive  = null,
  sortBy    = 'createdAt',
  sortOrder = 'desc',
  page      = 1,
  limit     = 20,
} = {}) => {
  const query = { userId };

  if (q && q.trim().length > 0) {
    const safe = escapeRegex(q.trim());
    query.$or  = [
      { name:    { $regex: safe, $options: 'i' } },
      { email:   { $regex: safe, $options: 'i' } },
      { company: { $regex: safe, $options: 'i' } },
      { phone:   { $regex: safe, $options: 'i' } },
    ];
  }

  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    query.tags     = { $in: tagArray };
  }

  if (isActive !== null && isActive !== undefined) {
    query.isActive = isActive === 'true' || isActive === true;
  }

  const skip  = (page - 1) * limit;
  const total = await Customer.countDocuments(query);
  const sort  = buildSort(sortBy, sortOrder);

  const customers = await Customer.find(query)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    customers,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    filters: { q, tags, isActive, sortBy, sortOrder },
  };
};

// ── Global unified search ─────────────────────────────────────────────────────
// Spec: Unified search across invoices and customers in one request

const globalSearch = async (userId, {
  q           = null,
  type        = 'all',
  status      = null,
  tags        = null,
  dueDateFrom = null,
  dueDateTo   = null,
  sortBy      = 'createdAt',
  sortOrder   = 'desc',
  page        = 1,
  limit       = 20,
} = {}) => {
  if (!q || q.trim().length === 0) {
    throw new AppError('Search query is required.', 400, 'MISSING_SEARCH_QUERY');
  }

  const results = {};

  if (type === 'all' || type === 'invoices') {
    results.invoices = await searchInvoices(userId, {
      q, status, tags, dueDateFrom, dueDateTo, sortBy, sortOrder, page, limit,
    });
  }

  if (type === 'all' || type === 'customers') {
    results.customers = await searchCustomers(userId, {
      q, tags, sortBy, sortOrder, page, limit,
    });
  }

  const totalResults =
    (results.invoices?.pagination?.total   || 0) +
    (results.customers?.pagination?.total  || 0);

  logger.info(`Global search: userId=${userId} q="${q}" type=${type} total=${totalResults}`);

  return {
    query:        q,
    type,
    totalResults,
    ...results,
  };
};

// ── Filter invoices (standalone — no text query required) ─────────────────────

const filterInvoices = async (userId, {
  status      = null,
  tags        = null,
  dueDateFrom = null,
  dueDateTo   = null,
  customerId  = null,
  sortBy      = 'dueDate',
  sortOrder   = 'asc',
  page        = 1,
  limit       = 20,
} = {}) => {
  const query = { userId };

  if (status)     query.status     = status;
  if (customerId) query.customerId = customerId;

  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    query.tags     = { $in: tagArray };
  }

  if (dueDateFrom || dueDateTo) {
    query.dueDate = {};
    if (dueDateFrom) query.dueDate.$gte = new Date(dueDateFrom);
    if (dueDateTo)   query.dueDate.$lte = new Date(dueDateTo);
  }

  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(query);
  const sort  = buildSort(sortBy, sortOrder);

  const invoices = await Invoice.find(query)
    .populate('customerId', 'name email company phone timezone')
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    filters: { status, tags, dueDateFrom, dueDateTo, customerId, sortBy, sortOrder },
  };
};

// ── Get all available tags for the user ───────────────────────────────────────
// Helps the frontend populate tag filter dropdowns

const getAvailableTags = async (userId) => {
  const [invoiceTags, customerTags] = await Promise.all([
    Invoice.distinct('tags',  { userId }),
    Customer.distinct('tags', { userId }),
  ]);

  const allTags    = [...new Set([...invoiceTags, ...customerTags])].filter(Boolean).sort();
  const invoiceSet = [...new Set(invoiceTags)].filter(Boolean).sort();
  const customerSet = [...new Set(customerTags)].filter(Boolean).sort();

  return {
    all:       allTags,
    invoices:  invoiceSet,
    customers: customerSet,
  };
};

module.exports = {
  globalSearch,
  searchInvoices,
  searchCustomers,
  filterInvoices,
  getAvailableTags,
};

