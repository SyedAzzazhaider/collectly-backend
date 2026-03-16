'use strict';

const mongoose         = require('mongoose');
const User             = require('../../auth/models/User.model');
const Invoice          = require('../../customers/models/Invoice.model');
const Customer         = require('../../customers/models/Customer.model');
const { Notification } = require('../../notifications/models/Notification.model');
const { Billing }      = require('../../billing/models/Billing.model');
const AppError         = require('../../../shared/errors/AppError');
const logger           = require('../../../shared/utils/logger');
const { ReportCache }  = require('../models/ReportCache.model');
const crypto           = require('crypto');

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const getCached = async (reportType, params) => {
  try {
    const paramsHash = hashParams(params);
    const cached = await ReportCache.findOne({
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

const setCache = async (reportType, params, data, ttlSeconds = 300) => {
  try {
    const paramsHash = hashParams(params);
    await ReportCache.findOneAndUpdate(
      { reportType, paramsHash },
      {
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

// ── Subscriptions overview ────────────────────────────────────────────────────

const getSubscriptionsOverview = async ({ period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'admin_subscriptions';

  const cached = await getCached(reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const [planBreakdown, activeBreakdown, newSignups, totalUsers] = await Promise.all([
    User.aggregate([
      { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } },
    ]),
    User.aggregate([
      { $group: { _id: '$isActive', count: { $sum: 1 } } },
    ]),
    User.countDocuments({ createdAt }),
    User.countDocuments({}),
  ]);

  const byPlan = planBreakdown.reduce((acc, p) => {
    acc[p._id || 'none'] = p.count;
    return acc;
  }, {});

  const activeCount   = activeBreakdown.find((s) => s._id === true)?.count  || 0;
  const inactiveCount = activeBreakdown.find((s) => s._id === false)?.count || 0;

  const result = {
    totalUsers,
    active:     activeCount,
    inactive:   inactiveCount,
    newSignups,
    byPlan,
    period:     dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(reportType, params, result, 300);
  return result;
};

// ── Notifications sent (platform-wide) ───────────────────────────────────────

const getNotificationsSent = async ({ period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'admin_notifications_sent';

  const cached = await getCached(reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const [total, byChannel, byStatus, dailyVolume] = await Promise.all([
    Notification.countDocuments({ createdAt }),
    Notification.aggregate([
      { $match: { createdAt } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: { createdAt } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: { createdAt } },
      {
        $group: {
          _id: {
            year:  { $year:  '$createdAt' },
            month: { $month: '$createdAt' },
            day:   { $dayOfMonth: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
    ]),
  ]);

  const result = {
    total,
    byChannel:   byChannel.reduce((acc, c)  => { acc[c._id]  = c.count;  return acc; }, {}),
    byStatus:    byStatus.reduce( (acc, s)  => { acc[s._id]  = s.count;  return acc; }, {}),
    dailyVolume: dailyVolume.map((d) => ({
      date:  `${d._id.year}-${String(d._id.month).padStart(2,'0')}-${String(d._id.day).padStart(2,'0')}`,
      count: d.count,
    })),
    period:      dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(reportType, params, result, 300);
  return result;
};

// ── Billing usage ─────────────────────────────────────────────────────────────

const getBillingUsage = async ({ period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'admin_billing_usage';

  const cached = await getCached(reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const [activeCount, byPlan, renewalsUpcoming, revenueInPeriod] = await Promise.all([
    Billing.countDocuments({ status: { $in: ['active', 'trialing'] } }),
    Billing.aggregate([
      { $match: { status: { $in: ['active', 'trialing'] } } },
      {
        $group: {
          _id:     '$plan',
          count:   { $sum: 1 },
          revenue: { $sum: '$amount' },
        },
      },
    ]),
    Billing.countDocuments({
      status:      { $in: ['active', 'trialing'] },
      renewalDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 86400000) },
    }),
    Billing.aggregate([
      { $match: { createdAt, status: { $in: ['active', 'trialing'] } } },
      { $group: { _id: '$currency', total: { $sum: '$amount' } } },
    ]),
  ]);

  const result = {
    activeSubscriptions:   activeCount,
    renewalsUpcoming7Days: renewalsUpcoming,
    byPlan: byPlan.reduce((acc, p) => {
      acc[p._id] = { count: p.count, revenue: p.revenue };
      return acc;
    }, {}),
    revenueInPeriod: revenueInPeriod.reduce((acc, r) => {
      acc[r._id] = r.total;
      return acc;
    }, {}),
    period: dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(reportType, params, result, 600);
  return result;
};

// ── SLA performance ───────────────────────────────────────────────────────────

const getSlaPerformance = async ({ period = '30d', dateFrom, dateTo } = {}) => {
  const params     = { period, dateFrom, dateTo };
  const reportType = 'admin_sla_performance';

  const cached = await getCached(reportType, params);
  if (cached) {
    logger.info(`ReportCache HIT: ${reportType}`);
    return cached;
  }

  const createdAt = buildDateRange({ period, dateFrom, dateTo });

  const [deliveryBreakdown, failuresByChannel, avgAttempts, totalCustomers, totalInvoices] = await Promise.all([
    Notification.aggregate([
      { $match: { createdAt } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: { createdAt, status: 'failed' } },
      { $group: { _id: '$channel', count: { $sum: 1 } } },
    ]),
    Notification.aggregate([
      { $match: { createdAt } },
      { $group: { _id: null, avgAttempts: { $avg: '$attemptCount' } } },
    ]),
    Customer.countDocuments({ createdAt }),
    Invoice.countDocuments({ createdAt }),
  ]);

  const statusMap      = deliveryBreakdown.reduce((acc, s) => { acc[s._id] = s.count; return acc; }, {});
  const totalSuccess   = (statusMap.sent || 0) + (statusMap.delivered || 0);
  const totalFailed    = statusMap.failed || 0;
  const totalProcessed = totalSuccess + totalFailed;

  const result = {
    deliverySuccessRate: totalProcessed > 0
      ? Math.round((totalSuccess / totalProcessed) * 100)
      : 100,
    totalProcessed,
    totalSuccess,
    totalFailed,
    byStatus:             statusMap,
    failuresByChannel:    failuresByChannel.reduce((acc, f) => { acc[f._id] = f.count; return acc; }, {}),
    avgDeliveryAttempts:  Math.round((avgAttempts[0]?.avgAttempts || 0) * 100) / 100,
    newCustomersInPeriod: totalCustomers,
    newInvoicesInPeriod:  totalInvoices,
    period:               dateFrom && dateTo ? 'custom' : period,
  };

  await setCache(reportType, params, result, 300);
  return result;
};

// ── Full admin dashboard ──────────────────────────────────────────────────────

const getAdminDashboard = async (params = {}) => {
  const { period = '30d', dateFrom, dateTo } = params;

  const [subscriptions, notificationsSent, billingUsage, slaPerformance] = await Promise.all([
    getSubscriptionsOverview({ period, dateFrom, dateTo }),
    getNotificationsSent(    { period, dateFrom, dateTo }),
    getBillingUsage(         { period, dateFrom, dateTo }),
    getSlaPerformance(       { period, dateFrom, dateTo }),
  ]);

  logger.info('Admin dashboard retrieved');

  return { subscriptions, notificationsSent, billingUsage, slaPerformance };
};

module.exports = {
  getAdminDashboard,
  getSubscriptionsOverview,
  getNotificationsSent,
  getBillingUsage,
  getSlaPerformance,
};