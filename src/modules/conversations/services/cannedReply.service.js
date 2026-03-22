'use strict';

const { CannedReply } = require('../models/CannedReply.model');
const AppError        = require('../../../shared/errors/AppError');
const logger          = require('../../../shared/utils/logger');

// ── Create canned reply ───────────────────────────────────────────────────────
// Document: Templates / Canned replies

const createCannedReply = async (userId, data) => {
  const { name, category = 'General', channel = 'all', subject = null, body, tags = [] } = data;

  const existing = await CannedReply.findOne({
    userId,
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
  });

  if (existing) {
    throw new AppError(
      'A canned reply with this name already exists.',
      409,
      'DUPLICATE_CANNED_REPLY_NAME'
    );
  }

  const cannedReply = await CannedReply.create({
    userId, name: name.trim(), category, channel, subject, body, tags,
  });

  logger.info(`Canned reply created: ${cannedReply._id} [${name}] by user ${userId}`);
  return cannedReply;
};

// ── Get all canned replies ────────────────────────────────────────────────────

const getCannedReplies = async (userId, {
  page     = 1,
  limit    = 20,
  channel  = null,
  category = null,
  isActive = null,
  search   = null,
} = {}) => {
  const query = { userId };

  if (channel)  query.channel  = channel;
  if (category) query.category = category;

  if (isActive !== null) {
    query.isActive = isActive === 'true' || isActive === true;
  }

  if (search) {
    query.$or = [
      { name:     { $regex: search, $options: 'i' } },
      { body:     { $regex: search, $options: 'i' } },
      { category: { $regex: search, $options: 'i' } },
    ];
  }

  const skip  = (page - 1) * limit;
  const total = await CannedReply.countDocuments(query);

  const cannedReplies = await CannedReply.find(query)
    .sort({ usageCount: -1, name: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    cannedReplies,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Get single canned reply ───────────────────────────────────────────────────

const getCannedReplyById = async (userId, cannedReplyId) => {
  const cannedReply = await CannedReply.findOne({ _id: cannedReplyId, userId });
  if (!cannedReply) {
    throw new AppError('Canned reply not found.', 404, 'CANNED_REPLY_NOT_FOUND');
  }
  return cannedReply;
};

// ── Update canned reply ───────────────────────────────────────────────────────

const updateCannedReply = async (userId, cannedReplyId, data) => {
  const cannedReply = await CannedReply.findOne({ _id: cannedReplyId, userId });
  if (!cannedReply) {
    throw new AppError('Canned reply not found.', 404, 'CANNED_REPLY_NOT_FOUND');
  }

  if (data.name && data.name.trim() !== cannedReply.name) {
    const duplicate = await CannedReply.findOne({
      userId,
      name: { $regex: `^${data.name.trim()}$`, $options: 'i' },
      _id:  { $ne: cannedReplyId },
    });
    if (duplicate) {
      throw new AppError('A canned reply with this name already exists.', 409, 'DUPLICATE_CANNED_REPLY_NAME');
    }
  }

  const allowedFields = ['name', 'category', 'channel', 'subject', 'body', 'tags', 'isActive'];
  allowedFields.forEach((field) => {
    if (data[field] !== undefined) cannedReply[field] = data[field];
  });

  await cannedReply.save();
  logger.info(`Canned reply updated: ${cannedReplyId} by user ${userId}`);
  return cannedReply;
};

// ── Delete canned reply ───────────────────────────────────────────────────────

const deleteCannedReply = async (userId, cannedReplyId) => {
  const cannedReply = await CannedReply.findOne({ _id: cannedReplyId, userId });
  if (!cannedReply) {
    throw new AppError('Canned reply not found.', 404, 'CANNED_REPLY_NOT_FOUND');
  }

  await CannedReply.deleteOne({ _id: cannedReplyId, userId });
  logger.info(`Canned reply deleted: ${cannedReplyId} by user ${userId}`);
  return { deleted: true, cannedReplyId };
};

// ── Preview canned reply with interpolation ───────────────────────────────────
// Document: Templates — interpolate placeholders

const previewCannedReply = async (userId, cannedReplyId, context = {}) => {
  const cannedReply = await CannedReply.findOne({ _id: cannedReplyId, userId });
  if (!cannedReply) {
    throw new AppError('Canned reply not found.', 404, 'CANNED_REPLY_NOT_FOUND');
  }

  const variables = {
    '{{customerName}}':  context.customerName  || '[Customer Name]',
    '{{invoiceNumber}}': context.invoiceNumber || '[Invoice Number]',
    '{{amount}}':        context.amount        || '[Amount]',
    '{{currency}}':      context.currency      || '[Currency]',
    '{{dueDate}}':       context.dueDate       || '[Due Date]',
    '{{companyName}}':   context.companyName   || 'Collectly',
    '{{agentName}}':     context.agentName     || '[Agent Name]',
    '{{paymentLink}}':   context.paymentLink   || '[Payment Link]',
  };

  let previewBody    = cannedReply.body;
  let previewSubject = cannedReply.subject || '';

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
    previewBody    = previewBody.replace(regex, value);
    previewSubject = previewSubject.replace(regex, value);
  });

  return {
    cannedReply,
    preview: {
      subject: previewSubject || null,
      body:    previewBody,
    },
  };
};

// ── Get categories list ───────────────────────────────────────────────────────

const getCannedReplyCategories = async (userId) => {
  const categories = await CannedReply.distinct('category', { userId });
  return categories.sort();
};

module.exports = {
  createCannedReply,
  getCannedReplies,
  getCannedReplyById,
  updateCannedReply,
  deleteCannedReply,
  previewCannedReply,
  getCannedReplyCategories,
};

