'use strict';

const mongoose         = require('mongoose');
const Invoice          = require('../../customers/models/Invoice.model');
const { Notification } = require('../../notifications/models/Notification.model');
const AppError         = require('../../../shared/errors/AppError');
const logger           = require('../../../shared/utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

const toObjId = (id) => new mongoose.Types.ObjectId(String(id));

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

const buildDateRange = ({ period = '30d', dateFrom, dateTo }) => {
  if (dateFrom && dateTo) {
    return { $gte: new Date(dateFrom), $lte: new Date(dateTo) };
  }
  const now  = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (PERIOD_DAYS[period] || 30));
  return { $gte: from, $lte: now };
};

const SORT_MAP = {
  dueDate:  { dueDate: 1 },
  amount:   { amount: -1 },
  priority: { amount: -1, dueDate: 1 },
};

// ── Overdue list ──────────────────────────────────────────────────────────────

const getOverdueList = async (userId, { page = 1, limit = 20, sortBy = 'dueDate' } = {}) => {
  const filter = { userId, status: 'overdue' };
  const skip   = (page - 1) * limit;
  const total  = await Invoice.countDocuments(filter);
  const sort   = SORT_MAP[sortBy] || SORT_MAP.dueDate;

  const invoices = await Invoice.find(filter)
    .populate('customerId', 'name email phone company timezone preferences')
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .lean();

  const now = Date.now();
  const annotated = invoices.map((inv) => ({
    ...inv,
    daysOverdue: Math.max(0, Math.floor((now - new Date(inv.dueDate).getTime()) / 86400000)),
    outstanding: inv.amount - inv.amountPaid,
  }));

  const totalsAgg = await Invoice.aggregate([
    { $match: { userId: toObjId(userId), status: 'overdue' } },
    {
      $group: {
        _id:              '$currency',
        totalOutstanding: { $sum: { $subtract: ['$amount', '$amountPaid'] } },
        count:            { $sum: 1 },
      },
    },
  ]);

  return {
    invoices:   annotated,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    totals:     totalsAgg.reduce((acc, t) => {
      acc[t._id] = { totalOutstanding: t.totalOutstanding, count: t.count };
      return acc;
    }, {}),
  };
};

// ── Payment history ───────────────────────────────────────────────────────────

const getPaymentHistory = async (userId, {
  period   = '30d',
  dateFrom,
  dateTo,
  page     = 1,
  limit    = 20,
} = {}) => {
  const paidAt = buildDateRange({ period, dateFrom, dateTo });

  const filter = { userId, status: 'paid', paidAt };
  const skip   = (page - 1) * limit;
  const total  = await Invoice.countDocuments(filter);

  const invoices = await Invoice.find(filter)
    .populate('customerId', 'name email company')
    .sort({ paidAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const recoveredAgg = await Invoice.aggregate([
    { $match: { userId: toObjId(userId), status: 'paid', paidAt } },
    { $group: { _id: '$currency', totalRecovered: { $sum: '$amount' } } },
  ]);

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    recovered:  recoveredAgg.reduce((acc, r) => {
      acc[r._id] = r.totalRecovered;
      return acc;
    }, {}),
    period: dateFrom && dateTo ? 'custom' : period,
  };
};

// ── Priority queue ────────────────────────────────────────────────────────────
// Priority score = outstanding amount × days overdue (higher = more urgent)

const getPriorityQueue = async (userId, { page = 1, limit = 20 } = {}) => {
  const now   = new Date();
  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments({ userId, status: 'overdue' });

  const invoices = await Invoice.aggregate([
    { $match: { userId: toObjId(userId), status: 'overdue' } },
    {
      $addFields: {
        outstanding: { $subtract: ['$amount', '$amountPaid'] },
        daysOverdue: {
          $max: [
            0,
            { $divide: [{ $subtract: [now, '$dueDate'] }, 86400000] },
          ],
        },
      },
    },
    {
      $addFields: {
        priorityScore: { $multiply: ['$outstanding', '$daysOverdue'] },
      },
    },
    { $sort: { priorityScore: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from:         'customers',
        localField:   'customerId',
        foreignField: '_id',
        as:           'customer',
        pipeline: [
          { $project: { name: 1, email: 1, phone: 1, company: 1, timezone: 1, preferences: 1 } },
        ],
      },
    },
    {
      $addFields: {
        customer: { $arrayElemAt: ['$customer', 0] },
      },
    },
    { $project: { reminderHistory: 0, __v: 0 } },
  ]);

  return {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Recovery rate ─────────────────────────────────────────────────────────────

const getRecoveryRate = async (userId, { period = '30d', dateFrom, dateTo } = {}) => {
  const dueDate = buildDateRange({ period, dateFrom, dateTo });

  // Invoices whose due date fell within the period (were or became overdue)
  const totalOverdue = await Invoice.countDocuments({
    userId,
    status:  { $in: ['overdue', 'paid', 'partial', 'cancelled'] },
    dueDate,
  });

  if (totalOverdue === 0) {
    return {
      recoveryRate:   0,
      totalOverdue:   0,
      totalRecovered: 0,
      totalPartial:   0,
      period:         dateFrom && dateTo ? 'custom' : period,
    };
  }

  const [recovered, partial] = await Promise.all([
    Invoice.countDocuments({ userId, status: 'paid',    dueDate }),
    Invoice.countDocuments({ userId, status: 'partial', dueDate }),
  ]);

  return {
    recoveryRate:   Math.round((recovered / totalOverdue) * 100),
    totalOverdue,
    totalRecovered: recovered,
    totalPartial:   partial,
    period:         dateFrom && dateTo ? 'custom' : period,
  };
};

// ── Full agent dashboard ──────────────────────────────────────────────────────

const getAgentDashboard = async (userId, params = {}) => {
  const {
    period   = '30d',
    dateFrom,
    dateTo,
    page     = 1,
    limit    = 20,
    sortBy   = 'dueDate',
  } = params;

  if (!userId) throw new AppError('User ID is required', 400, 'MISSING_USER_ID');

  const [overdueList, paymentHistory, priorityQueue, recoveryRate] = await Promise.all([
    getOverdueList(userId,    { page: Number(page), limit: Number(limit), sortBy }),
    getPaymentHistory(userId, { period, dateFrom, dateTo, page: Number(page), limit: Number(limit) }),
    getPriorityQueue(userId,  { page: Number(page), limit: Number(limit) }),
    getRecoveryRate(userId,   { period, dateFrom, dateTo }),
  ]);

  logger.info(`Agent dashboard retrieved for user: ${userId}`);

  return { overdueList, paymentHistory, priorityQueue, recoveryRate };
};

module.exports = {
  getAgentDashboard,
  getOverdueList,
  getPaymentHistory,
  getPriorityQueue,
  getRecoveryRate,
};