'use strict';

const Invoice  = require('../models/Invoice.model');
const Customer = require('../models/Customer.model');
const AppError = require('../../../shared/errors/AppError');
const logger   = require('../../../shared/utils/logger');
const alertService = require('../../alerts/services/alert.service');

// â”€â”€ Create invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const createInvoice = async (userId, data) => {
  const {
    customerId, invoiceNumber, amount, currency,
    dueDate, issueDate, tags, notes, attachments,
  } = data;

  // Verify customer belongs to this user
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  // Enforce unique invoice number per user
  const existing = await Invoice.findOne({ userId, invoiceNumber });
  if (existing) {
    throw new AppError(
      'An invoice with this number already exists in your account.',
      409,
      'DUPLICATE_INVOICE_NUMBER'
    );
  }

  const invoice = await Invoice.create({
    userId,
    customerId,
    invoiceNumber,
    amount,
    amountPaid:  0,
    currency:    currency   || 'USD',
    dueDate:     new Date(dueDate),
    issueDate:   issueDate  ? new Date(issueDate) : new Date(),
    tags:        tags       || [],
    notes:       notes      || null,
    attachments: attachments || [],
  });

  logger.info(`Invoice created: ${invoice._id} [${invoiceNumber}] by user: ${userId}`);
  return invoice;
};

// â”€â”€ Get all invoices (with filters) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getInvoices = async (userId, {
  page       = 1,
  limit      = 20,
  status     = null,
  customerId = null,
  search     = null,
  tags       = null,
  dueDateFrom = null,
  dueDateTo   = null,
} = {}) => {
  const query = { userId };

  // Document: Filter by status
  if (status)     query.status     = status;

  // Document: Filter by customer
  if (customerId) query.customerId = customerId;

  // Document: Search by invoice number
  if (search) {
    query.$or = [
      { invoiceNumber: { $regex: search, $options: 'i' } },
    ];
  }

  // Document: Filter by tags
  if (tags) {
    const tagArray = Array.isArray(tags) ? tags : [tags];
    query.tags     = { $in: tagArray };
  }

  // Document: Filter by due date range
  if (dueDateFrom || dueDateTo) {
    query.dueDate = {};
    if (dueDateFrom) query.dueDate.$gte = new Date(dueDateFrom);
    if (dueDateTo)   query.dueDate.$lte = new Date(dueDateTo);
  }

  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(query);

  const invoices = await Invoice.find(query)
    .populate('customerId', 'name email company')
    .sort({ dueDate: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    invoices,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  };
};

// â”€â”€ Get single invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getInvoiceById = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId })
    .populate('customerId', 'name email company phone timezone preferences');

  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  return invoice;
};

// â”€â”€ Update invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const updateInvoice = async (userId, invoiceId, data) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  if (['paid', 'cancelled'].includes(invoice.status) && !data.notes && !data.tags) {
    throw new AppError(
      `Cannot modify a ${invoice.status} invoice.`,
      400,
      'INVOICE_NOT_EDITABLE'
    );
  }

  // Prevent changing invoice number to a duplicate
  if (data.invoiceNumber && data.invoiceNumber !== invoice.invoiceNumber) {
    const duplicate = await Invoice.findOne({
      userId,
      invoiceNumber: data.invoiceNumber,
      _id: { $ne: invoiceId },
    });
    if (duplicate) {
      throw new AppError('Invoice number already exists.', 409, 'DUPLICATE_INVOICE_NUMBER');
    }
  }

  const allowedFields = [
    'invoiceNumber', 'amount', 'currency', 'dueDate',
    'issueDate', 'status', 'tags', 'notes', 'attachments',
  ];

  allowedFields.forEach((field) => {
    if (data[field] !== undefined) {
      invoice[field] = data[field];
    }
  });

  await invoice.save();

  logger.info(`Invoice updated: ${invoiceId} by user: ${userId}`);
  return invoice;
};

// â”€â”€ Delete invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const deleteInvoice = async (userId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  if (invoice.status === 'paid') {
    throw new AppError('Cannot delete a paid invoice.', 400, 'CANNOT_DELETE_PAID_INVOICE');
  }

  await Invoice.deleteOne({ _id: invoiceId, userId });

  logger.info(`Invoice deleted: ${invoiceId} by user: ${userId}`);
  return { deleted: true, invoiceId };
};

// â”€â”€ Record partial or full payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const recordPayment = async (userId, invoiceId, paymentAmount) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) {
    throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
  }

  if (invoice.status === 'paid') {
    throw new AppError('Invoice is already fully paid.', 400, 'INVOICE_ALREADY_PAID');
  }

  if (invoice.status === 'cancelled') {
    throw new AppError('Cannot record payment on a cancelled invoice.', 400, 'INVOICE_CANCELLED');
  }

  const newAmountPaid = invoice.amountPaid + paymentAmount;

  if (newAmountPaid > invoice.amount) {
    throw new AppError(
      `Payment of ${paymentAmount} exceeds outstanding balance of ${invoice.amount - invoice.amountPaid}.`,
      400,
      'PAYMENT_EXCEEDS_BALANCE'
    );
  }

  invoice.amountPaid = newAmountPaid;
  // Status auto-updated by pre-save hook
  await invoice.save();

  logger.info(`Payment recorded: invoice=${invoiceId} amount=${paymentAmount} user=${userId}`);

  // Module I — fire-and-forget alert (never blocks payment recording)
  alertService.triggerPaymentReceived(userId, { invoice, amount: paymentAmount }).catch(() => {});

  return invoice;
};

// â”€â”€ Mark invoice as overdue (called by scheduler) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const markOverdueInvoices = async () => {
  const result = await Invoice.updateMany(
    {
      status:  'pending',
      dueDate: { $lt: new Date() },
    },
    { $set: { status: 'overdue' } }
  );

  logger.info(`Marked ${result.modifiedCount} invoices as overdue`);
  return result.modifiedCount;
};

// â”€â”€ Get overdue invoices (for agent dashboard) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const getOverdueInvoices = async (userId, { page = 1, limit = 20 } = {}) => {
  const query = { userId, status: 'overdue' };
  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(query);

  const invoices = await Invoice.find(query)
    .populate('customerId', 'name email company phone')
    .sort({ dueDate: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// â”€â”€ Add attachment to invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const addAttachment = async (userId, invoiceId, fileData) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  if (invoice.status === 'cancelled') {
    throw new AppError('Cannot add attachments to a cancelled invoice.', 400, 'INVOICE_CANCELLED');
  }

  if (invoice.attachments.length >= 10) {
    throw new AppError('Maximum 10 attachments allowed per invoice.', 400, 'ATTACHMENT_LIMIT_REACHED');
  }

  // S3 upload stores URL in fileData.location (multer-s3)
  // Memory fallback stores original buffer â€” URL will be empty
  const attachmentUrl = fileData.key || '';
  invoice.attachments.push({
    filename:  fileData.originalname,
    url:       attachmentUrl,
    mimeType:  fileData.mimetype || 'application/pdf',
    sizeBytes: fileData.size     || 0,
  });

  await invoice.save({ validateBeforeSave: false });
  logger.info(`Attachment added to invoice ${invoiceId} by user ${userId}`);
  return invoice;
};

// â”€â”€ Remove attachment from invoice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const removeAttachment = async (userId, invoiceId, attachmentIndex) => {
  const { deleteFromS3 } = require('../../../shared/utils/s3.util');

  const invoice = await Invoice.findOne({ _id: invoiceId, userId });
  if (!invoice) throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');

  const idx = parseInt(attachmentIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= invoice.attachments.length) {
    throw new AppError(
      `Invalid attachment index. Invoice has ${invoice.attachments.length} attachment(s).`,
      400,
      'INVALID_ATTACHMENT_INDEX'
    );
  }

  const attachment = invoice.attachments[idx];

  // Delete from S3 if URL is an S3 key
  if (attachment.url && attachment.url.startsWith('attachments/')) {
    await deleteFromS3(attachment.url);
  }

  invoice.attachments.splice(idx, 1);
  await invoice.save({ validateBeforeSave: false });

  logger.info(`Attachment ${idx} removed from invoice ${invoiceId} by user ${userId}`);
  return invoice;
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  recordPayment,
  markOverdueInvoices,
  getOverdueInvoices,
  addAttachment,
  removeAttachment,
};
