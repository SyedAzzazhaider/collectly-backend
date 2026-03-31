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

// ── Upcoming dues ─────────────────────────────────────────────────────────────

const getUpcomingDues = async (userId, { days = 30, page = 1, limit = 20 } = {}) => {
  const params     = { days, page, limit };
  const reportType = 'customer_upcoming_dues';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

  const now    = new Date();
  const future = new Date();
  future.setDate(future.getDate() + Number(days) + 1);

  const filter = {
    userId,
    status:  { $in: ['pending', 'partial'] },
    dueDate: { $gte: now, $lte: future },
  };

  const skip  = (page - 1) * limit;
  const total = await Invoice.countDocuments(filter);

  const invoices = await Invoice.find(filter)
    .populate('customerId', 'name email phone company timezone')
    .sort({ dueDate: 1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const amountAgg = await Invoice.aggregate([
    {
      $match: {
        userId:  toObjId(userId),
        status:  { $in: ['pending', 'partial'] },
        dueDate: { $gte: now, $lte: future },
      },
    },
    {
      $group: {
        _id:             '$currency',
        totalOutstanding: { $sum: { $subtract: ['$amount', '$amountPaid'] } },
      },
    },
  ]);

  const result = {
    invoices,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    summary: {
      count:            total,
      amountByCurrency: amountAgg.reduce((acc, a) => { acc[a._id] = a.totalOutstanding; return acc; }, {}),
      daysAhead:        Number(days),
    },
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Reminder history ──────────────────────────────────────────────────────────

const getReminderHistory = async (userId, {
  period   = '30d',
  dateFrom,
  dateTo,
  page     = 1,
  limit    = 20,
} = {}) => {
  const params     = { period, dateFrom, dateTo, page, limit };
  const reportType = 'customer_reminder_history';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const filter = { userId, createdAt };
  const skip   = (page - 1) * limit;
  const total  = await Notification.countDocuments(filter);

  const notifications = await Notification.find(filter)
    .populate('customerId', 'name email')
    .populate('invoiceId',  'invoiceNumber amount dueDate status currency')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const breakdown = await Notification.aggregate([
    { $match: { userId: toObjId(userId), createdAt } },
    {
      $group: {
        _id:   { channel: '$channel', status: '$status' },
        count: { $sum: 1 },
      },
    },
  ]);

  const channelBreakdown = {};
  for (const b of breakdown) {
    const ch = b._id.channel;
    if (!channelBreakdown[ch]) {
      channelBreakdown[ch] = { total: 0, sent: 0, delivered: 0, failed: 0, pending: 0, cancelled: 0 };
    }
    const st = b._id.status;
    channelBreakdown[ch][st]    = (channelBreakdown[ch][st] || 0) + b.count;
    channelBreakdown[ch].total += b.count;
  }

  const result = {
    notifications,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    channelBreakdown,
    totalSent: total,
    period:    dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Response rate ─────────────────────────────────────────────────────────────

const getResponseRate = async (userId, { period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'customer_response_rate';

  const cached = await getCached(userId, reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType} userId=${userId}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  // Get ALL invoices created in this period (not just reminded ones)
  const allInvoices = await Invoice.find({
    userId,
    createdAt,
  }).lean();

  const totalAmount = allInvoices.reduce((sum, inv) => sum + inv.amount, 0);
  const totalPaid = allInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0);
  
  const recoveryRate = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

  // Also get reminder count for the "Reminders Sent" metric
  const reminderCount = await Notification.countDocuments({
    userId,
    createdAt,
    type: 'payment_reminder',
  });

  const result = {
    responseRate:   recoveryRate,
    totalReminded:  reminderCount,
    totalPaid:      allInvoices.filter(inv => inv.status === 'paid').length,
    totalPartial:   allInvoices.filter(inv => inv.status === 'partial').length,
    totalStillOpen: allInvoices.filter(inv => inv.status === 'pending').length,
    totalAmount,
    totalPaidAmount: totalPaid,
    period:         dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(userId, reportType, params, result, 120);
  return result;
};

// ── Full customer dashboard ───────────────────────────────────────────────────

const getCustomerDashboard = async (userId, params = {}) => {
  const {
    period   = '30d',
    dateFrom,
    dateTo,
    page     = 1,
    limit    = 20,
    days     = 30,
  } = params;

  if (!userId) throw new AppError('User ID is required', 400, 'MISSING_USER_ID');

  const [upcomingDues, reminderHistory, responseRate] = await Promise.all([
    getUpcomingDues(userId,    { days: Number(days), page: Number(page), limit: Number(limit) }),
    getReminderHistory(userId, { period, dateFrom, dateTo, page: Number(page), limit: Number(limit) }),
    getResponseRate(userId,    { period, dateFrom, dateTo }),
  ]);

  logger.info(`Customer dashboard retrieved for user: ${userId}`);

  return { upcomingDues, reminderHistory, responseRate };
};

module.exports = {
  getCustomerDashboard,
  getUpcomingDues,
  getReminderHistory,
  getResponseRate,
};

