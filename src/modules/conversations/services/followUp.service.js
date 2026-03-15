'use strict';

const { Message } = require('../models/Message.model');
const Customer    = require('../../customers/models/Customer.model');
const AppError    = require('../../../shared/errors/AppError');
const logger      = require('../../../shared/utils/logger');

// ── Get all pending follow-ups for user ───────────────────────────────────────
// Document: Follow-ups scheduling — agent priority queue

const getAllPendingFollowUps = async (userId, {
  page        = 1,
  limit       = 20,
  overdueOnly = false,
  customerId  = null,
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

  if (customerId) {
    query.customerId = customerId;
  }

  const skip  = (page - 1) * limit;
  const total = await Message.countDocuments(query);

  const messages = await Message.find(query)
    .populate('customerId', 'name email company phone')
    .populate('invoiceId',  'invoiceNumber amount status dueDate')
    .sort({ followUpAt: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    followUps: messages,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    overdueCount: await Message.countDocuments({
      userId,
      followUpAt:        { $lte: now, $ne: null },
      followUpCompleted: false,
    }),
  };
};

// ── Get follow-up stats ───────────────────────────────────────────────────────

const getFollowUpStats = async (userId) => {
  const now  = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [total, overdue, dueToday, upcoming] = await Promise.all([
    Message.countDocuments({ userId, followUpAt: { $ne: null }, followUpCompleted: false }),
    Message.countDocuments({ userId, followUpAt: { $lte: now, $ne: null }, followUpCompleted: false }),
    Message.countDocuments({
      userId,
      followUpAt:        { $gte: now, $lt: tomorrow },
      followUpCompleted: false,
    }),
    Message.countDocuments({
      userId,
      followUpAt:        { $gte: tomorrow },
      followUpCompleted: false,
    }),
  ]);

  return { total, overdue, dueToday, upcoming };
};

module.exports = {
  getAllPendingFollowUps,
  getFollowUpStats,
};