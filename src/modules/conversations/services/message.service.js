'use strict';

const { Message }  = require('../models/Message.model');
const { CannedReply } = require('../models/CannedReply.model');
const Customer     = require('../../customers/models/Customer.model');
const Invoice      = require('../../customers/models/Invoice.model');
const AppError     = require('../../../shared/errors/AppError');
const logger       = require('../../../shared/utils/logger');
const alertService = require('../../alerts/services/alert.service');

// ── Send a message ────────────────────────────────────────────────────────────
// Document: Message inbox — outbound messages sent by agent

const sendMessage = async (userId, data) => {
  const {
    customerId, invoiceId = null, channel, type = 'custom',
    subject = null, body, cannedReplyId = null, paymentPlanId = null,
    paymentLink = null, attachments = [], notes = null, tags = [],
    followUpAt = null, followUpNote = null,
  } = data;

  // Verify customer belongs to user
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  // Verify invoice if provided
  if (invoiceId) {
    const invoice = await Invoice.findOne({ _id: invoiceId, userId });
    if (!invoice) {
      throw new AppError('Invoice not found.', 404, 'INVOICE_NOT_FOUND');
    }
  }

  // Track canned reply usage
  if (cannedReplyId) {
    await CannedReply.findByIdAndUpdate(cannedReplyId, {
      $inc: { usageCount: 1 },
      $set: { lastUsedAt: new Date() },
    });
  }

  const message = await Message.create({
    userId,
    customerId,
    invoiceId,
    direction: 'outbound',
    channel,
    type,
    status:        'sent',
    subject,
    body,
    cannedReplyId,
    paymentPlanId,
    paymentLink,
    attachments,
    notes,
    tags,
    followUpAt,
    followUpNote,
    sentBy:  userId,
    sentAt:  new Date(),
  });

  logger.info(`Message sent: ${message._id} channel=${channel} customer=${customerId} user=${userId}`);
  return message;
};

// ── Record inbound message (customer reply) ───────────────────────────────────
// Document: Inbound messages — track customer responses

const recordInboundMessage = async (userId, data) => {
  const {
    customerId, invoiceId = null, channel,
    subject = null, body, providerMessageId = null,
  } = data;

  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const message = await Message.create({
    userId,
    customerId,
    invoiceId,
    direction:         'inbound',
    channel,
    type:              'custom',
    status:            'delivered',
    subject,
    body,
    providerMessageId,
    deliveredAt:       new Date(),
    readAt:            null,
  });

  logger.info(`Inbound message recorded: ${message._id} customer=${customerId}`);

  // Module I — fire-and-forget alert (never blocks message recording)
  alertService.triggerCustomerReply(userId, { customer, message }).catch(() => {});

  return message;
};


// ── Get inbox (all messages for user) ────────────────────────────────────────
// Document: Agent inbox — filterable by customer, invoice, direction, channel

const getInbox = async (userId, {
  page       = 1,
  limit      = 20,
  customerId = null,
  invoiceId  = null,
  direction  = null,
  channel    = null,
  type       = null,
  status     = null,
  hasFollowUp = null,
} = {}) => {
  const query = { userId };

  if (customerId)  query.customerId = customerId;
  if (invoiceId)   query.invoiceId  = invoiceId;
  if (direction)   query.direction  = direction;
  if (channel)     query.channel    = channel;
  if (type)        query.type       = type;
  if (status)      query.status     = status;

  if (hasFollowUp === 'true' || hasFollowUp === true) {
    query.followUpAt       = { $ne: null };
    query.followUpCompleted = false;
  }

  const skip  = (page - 1) * limit;
  const total = await Message.countDocuments(query);

  const messages = await Message.find(query)
    .populate('customerId', 'name email company')
    .populate('invoiceId',  'invoiceNumber amount status')
    .populate('sentBy',     'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    messages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Get conversation thread for a customer ────────────────────────────────────
// Document: Conversation thread — all messages for a specific customer

const getConversationThread = async (userId, customerId, {
  page      = 1,
  limit     = 50,
  invoiceId = null,
} = {}) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const query = { userId, customerId };
  if (invoiceId) query.invoiceId = invoiceId;

  const skip  = (page - 1) * limit;
  const total = await Message.countDocuments(query);

  const messages = await Message.find(query)
    .populate('invoiceId',  'invoiceNumber amount status')
    .populate('sentBy',     'name email')
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    customer,
    messages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Get single message ────────────────────────────────────────────────────────

const getMessageById = async (userId, messageId) => {
  const message = await Message.findOne({ _id: messageId, userId })
    .populate('customerId', 'name email company')
    .populate('invoiceId',  'invoiceNumber amount status')
    .populate('sentBy',     'name email');

  if (!message) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }
  return message;
};

// ── Update message notes and tags ─────────────────────────────────────────────
// Document: Notes & tags on messages

const updateMessageNotesTags = async (userId, messageId, { notes, tags }) => {
  const message = await Message.findOne({ _id: messageId, userId });
  if (!message) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  if (notes !== undefined) message.notes = notes;
  if (tags  !== undefined) message.tags  = tags;

  await message.save();
  logger.info(`Message notes/tags updated: ${messageId} by user ${userId}`);
  return message;
};

// ── Mark message as read ──────────────────────────────────────────────────────

const markAsRead = async (userId, messageId) => {
  const message = await Message.findOne({ _id: messageId, userId });
  if (!message) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  if (!message.readAt) {
    message.status = 'read';
    message.readAt = new Date();
    await message.save();
  }

  return message;
};

// ── Get pending follow-ups ────────────────────────────────────────────────────
// Document: Follow-ups scheduling

const getPendingFollowUps = async (userId, {
  page       = 1,
  limit      = 20,
  overdueOnly = false,
} = {}) => {
  const now   = new Date();
  const query = {
    userId,
    followUpAt:        { $ne: null },
    followUpCompleted: false,
  };

  if (overdueOnly) {
    query.followUpAt = { $lte: now };
  }

  const skip  = (page - 1) * limit;
  const total = await Message.countDocuments(query);

  const messages = await Message.find(query)
    .populate('customerId', 'name email company')
    .populate('invoiceId',  'invoiceNumber amount status')
    .sort({ followUpAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    messages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Schedule follow-up ────────────────────────────────────────────────────────
// Document: Follow-ups scheduling

const scheduleFollowUp = async (userId, messageId, { followUpAt, followUpNote }) => {
  const message = await Message.findOne({ _id: messageId, userId });
  if (!message) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  message.followUpAt        = new Date(followUpAt);
  message.followUpNote      = followUpNote || null;
  message.followUpCompleted = false;

  await message.save();
  logger.info(`Follow-up scheduled: message=${messageId} followUpAt=${followUpAt}`);
  return message;
};

// ── Complete follow-up ────────────────────────────────────────────────────────

const completeFollowUp = async (userId, messageId) => {
  const message = await Message.findOne({ _id: messageId, userId });
  if (!message) {
    throw new AppError('Message not found.', 404, 'MESSAGE_NOT_FOUND');
  }

  if (!message.followUpAt) {
    throw new AppError('No follow-up scheduled for this message.', 400, 'NO_FOLLOW_UP_SCHEDULED');
  }

  if (message.followUpCompleted) {
    throw new AppError('Follow-up already completed.', 400, 'FOLLOW_UP_ALREADY_COMPLETED');
  }

  message.followUpCompleted  = true;
  message.followUpCompletedAt = new Date();

  await message.save();
  logger.info(`Follow-up completed: message=${messageId} by user ${userId}`);
  return message;
};

// ── Get conversation stats for a customer ─────────────────────────────────────

const getConversationStats = async (userId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) {
    throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
  }

  const mongoose = require('mongoose');
  const oid = mongoose.Types.ObjectId.createFromHexString(String(userId));
  const cid = mongoose.Types.ObjectId.createFromHexString(String(customerId));

  const stats = await Message.aggregate([
    { $match: { userId: oid, customerId: cid } },
    {
      $group: {
        _id:       '$direction',
        count:     { $sum: 1 },
        channels:  { $addToSet: '$channel' },
        lastAt:    { $max: '$createdAt' },
      },
    },
  ]);

  const result = {
    totalMessages:    0,
    outbound:         0,
    inbound:          0,
    lastOutboundAt:   null,
    lastInboundAt:    null,
    pendingFollowUps: 0,
  };

  stats.forEach((s) => {
    result.totalMessages += s.count;
    if (s._id === 'outbound') {
      result.outbound      = s.count;
      result.lastOutboundAt = s.lastAt;
    } else {
      result.inbound      = s.count;
      result.lastInboundAt = s.lastAt;
    }
  });

  result.pendingFollowUps = await Message.countDocuments({
    userId:            oid,
    customerId:        cid,
    followUpAt:        { $ne: null },
    followUpCompleted: false,
  });

  return result;
};

module.exports = {
  sendMessage,
  recordInboundMessage,
  getInbox,
  getConversationThread,
  getMessageById,
  updateMessageNotesTags,
  markAsRead,
  getPendingFollowUps,
  scheduleFollowUp,
  completeFollowUp,
  getConversationStats,
};

