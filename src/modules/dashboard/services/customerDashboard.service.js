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

// ── Upcoming dues ─────────────────────────────────────────────────────────────

const getUpcomingDues = async (userId, { days = 30, page = 1, limit = 20 } = {}) => {
  const now    = new Date();
  const future = new Date();
  future.setDate(future.getDate() + Number(days) + 1); // +1 day buffer for boundary safety

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
    { $match: { userId: toObjId(userId), status: { $in: ['pending', 'partial'] }, dueDate: { $gte: now, $lte: future } } },
    { $group: { _id: '$currency', totalOutstanding: { $sum: { $subtract: ['$amount', '$amountPaid'] } } } },
  ]);

  return {
    invoices,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
    summary: {
      count:           total,
      amountByCurrency: amountAgg.reduce((acc, a) => { acc[a._id] = a.totalOutstanding; return acc; }, {}),
      daysAhead:       Number(days),
    },
  };
};

// ── Reminder history ──────────────────────────────────────────────────────────

const getReminderHistory = async (userId, {
  period   = '30d',
  dateFrom,
  dateTo,
  page     = 1,
  limit    = 20,
} = {}) => {
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

  // Channel + status breakdown
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

  return {
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
};

// ── Response rate ─────────────────────────────────────────────────────────────

const getResponseRate = async (userId, { period = '30d', dateFrom, dateTo } = {}) => {
  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  // All invoice IDs that received at least one reminder in the period
  const remindedInvoiceIds = await Notification.distinct('invoiceId', {
    userId,
    invoiceId: { $ne: null },
    createdAt,
  });

  const totalReminded = remindedInvoiceIds.length;

  if (totalReminded === 0) {
    return {
      responseRate:   0,
      totalReminded:  0,
      totalPaid:      0,
      totalPartial:   0,
      totalStillOpen: 0,
      period:         dateFrom && dateTo ? 'custom' : period,
    };
  }

  const [paidCount, partialCount] = await Promise.all([
    Invoice.countDocuments({ _id: { $in: remindedInvoiceIds }, userId, status: 'paid' }),
    Invoice.countDocuments({ _id: { $in: remindedInvoiceIds }, userId, status: 'partial' }),
  ]);

  return {
    responseRate:   Math.round((paidCount / totalReminded) * 100),
    totalReminded,
    totalPaid:      paidCount,
    totalPartial:   partialCount,
    totalStillOpen: totalReminded - paidCount - partialCount,
    period:         dateFrom && dateTo ? 'custom' : period,
  };
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