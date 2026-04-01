'use strict';

const mongoose         = require('mongoose');
const Invoice          = require('../../customers/models/Invoice.model');
const { Notification } = require('../../notifications/models/Notification.model');
const { ReportCache }  = require('../models/ReportCache.model');
const AppError         = require('../../../shared/errors/AppError');
const logger           = require('../../../shared/utils/logger');
const crypto           = require('crypto');

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

// ── ReportCache utilities ─────────────────────────────────────────────────────

const hashParams = (params) =>
  crypto.createHash('md5').update(JSON.stringify(params)).digest('hex');

const getCached = async (userId, reportType, params) => {
  try {
    const paramsHash = hashParams(params);
    const cached = await ReportCache.findOne({
      userId,
      reportType,
      paramsHash,
      expiresAt: { $gt: new Date() },
      isStale:   false,
    }).lean();
    return cached?.data || null;
  } catch {
    return null;
  }
};

const setCache = async (userId, reportType, params, data, ttlSeconds = 120) => {
  try {
    const paramsHash = hashParams(params);
    await ReportCache.findOneAndUpdate(
      { userId, reportType, paramsHash },
      {
        userId,
        reportType,
        paramsHash,
        data,
        isStale:   false,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    logger.warn(`ReportCache write failed: ${err.message}`);
  }
};

// ── Overdue list ──────────────────────────────────────────────────────────────

const getOverdueList = async (userId, { page = 1, limit = 20, sortBy = 'dueDate' } = {}) => {
  const params     = { page, limit, sortBy };
  const reportType = 'agent_overdue_list';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

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

  const result = {
    invoices:   annotated,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    totals:     totalsAgg.reduce((acc, t) => {
      acc[t._id] = { totalOutstanding: t.totalOutstanding, count: t.count };
      return acc;
    }, {}),
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Payment history ───────────────────────────────────────────────────────────

const getPaymentHistory = async (userId, {
  period   = '30d',
  dateFrom,
  dateTo,
  page     = 1,
  limit    = 20,
} = {}) => {
  const params     = { period, dateFrom, dateTo, page, limit };
  const reportType = 'agent_payment_history';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

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

  const result = {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    recovered:  recoveredAgg.reduce((acc, r) => {
      acc[r._id] = r.totalRecovered;
      return acc;
    }, {}),
    period: dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Priority queue ────────────────────────────────────────────────────────────

const getPriorityQueue = async (userId, { page = 1, limit = 20 } = {}) => {
  const params     = { page, limit };
  const reportType = 'agent_priority_queue';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

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

  const result = {
    invoices,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Recovery rate ─────────────────────────────────────────────────────────────

// ── Recovery rate from ALL invoices (not just overdue) ─────────────────────────

const getRecoveryRate = async (userId, { period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'agent_recovery_rate';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

  // Use createdAt date range instead of dueDate
  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  // Get ALL invoices in the date range (created during period)
  const allInvoices = await Invoice.aggregate([
    {
      $match: {
        userId: toObjId(userId),
        createdAt: createdAt,
      }
    },
    {
      $group: {
        _id: null,
        totalAmount: { $sum: '$amount' },
        totalPaid: { $sum: '$amountPaid' },
        paidInvoices: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
        partialInvoices: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
        overdueInvoices: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
      }
    }
  ]);

  const totals = allInvoices[0] || { totalAmount: 0, totalPaid: 0, paidInvoices: 0, partialInvoices: 0, overdueInvoices: 0 };
  const recoveryRate = totals.totalAmount > 0 ? Math.round((totals.totalPaid / totals.totalAmount) * 100) : 0;

  const result = {
    recoveryRate,
    totalAmount: totals.totalAmount,
    totalPaid: totals.totalPaid,
    totalOverdue: totals.overdueInvoices,
    totalRecovered: totals.paidInvoices,
    totalPartial: totals.partialInvoices,
    period: dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};



// ── Reminder stats ────────────────────────────────────────────────────────────

const getReminderStats = async (userId, { period = '30d', dateFrom, dateTo } = {}) => {
  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const stats = await Notification.aggregate([
    {
      $match: {
        userId: toObjId(userId),
        createdAt: createdAt,
        type: 'payment_reminder'
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        delivered: { $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      }
    }
  ]);

  const result = stats[0] || { total: 0, sent: 0, delivered: 0, failed: 0 };
  
  return {
    totalSent: result.sent,
    totalDelivered: result.delivered,
    totalFailed: result.failed,
    totalReminders: result.total,
    period: dateFrom && dateTo ? 'custom' : period,
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

