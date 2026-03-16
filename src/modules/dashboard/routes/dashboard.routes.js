'use strict';

const express    = require('express');
const router     = express.Router();

const dashboardController                                      = require('../controllers/dashboard.controller');
const { protect, restrictTo }                                  = require('../../../shared/middlewares/auth.middleware');
const { validateCustomerDashboard, validateAgentDashboard, validateAdminDashboard } = require('../validators/dashboard.validator');

// All dashboard routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER DASHBOARD — owner, agent, accountant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/dashboard/customer
 * Full customer dashboard: upcoming dues + reminder history + response rate
 */
router.get(
  '/customer',
  restrictTo('owner', 'agent', 'accountant'),
  validateCustomerDashboard,
  dashboardController.getCustomerDashboard
);

/**
 * GET /api/v1/dashboard/customer/upcoming-dues
 * Upcoming invoices due within N days
 */
router.get(
  '/customer/upcoming-dues',
  restrictTo('owner', 'agent', 'accountant'),
  validateCustomerDashboard,
  dashboardController.getUpcomingDues
);

/**
 * GET /api/v1/dashboard/customer/reminder-history
 * History of reminders sent, with channel breakdown
 */
router.get(
  '/customer/reminder-history',
  restrictTo('owner', 'agent', 'accountant'),
  validateCustomerDashboard,
  dashboardController.getReminderHistory
);

/**
 * GET /api/v1/dashboard/customer/response-rate
 * Rate at which reminded invoices were paid
 */
router.get(
  '/customer/response-rate',
  restrictTo('owner', 'agent', 'accountant'),
  validateCustomerDashboard,
  dashboardController.getResponseRate
);

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DASHBOARD — owner, agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/dashboard/agent
 * Full agent dashboard: overdue list + payment history + priority queue + recovery rate
 */
router.get(
  '/agent',
  restrictTo('owner', 'agent'),
  validateAgentDashboard,
  dashboardController.getAgentDashboard
);

/**
 * GET /api/v1/dashboard/agent/overdue
 * Overdue invoice list with days-overdue annotation
 */
router.get(
  '/agent/overdue',
  restrictTo('owner', 'agent'),
  validateAgentDashboard,
  dashboardController.getOverdueList
);

/**
 * GET /api/v1/dashboard/agent/payment-history
 * Recently paid invoices with recovered amounts
 */
router.get(
  '/agent/payment-history',
  restrictTo('owner', 'agent'),
  validateAgentDashboard,
  dashboardController.getPaymentHistory
);

/**
 * GET /api/v1/dashboard/agent/priority-queue
 * Overdue invoices ranked by priority score (amount × days overdue)
 */
router.get(
  '/agent/priority-queue',
  restrictTo('owner', 'agent'),
  validateAgentDashboard,
  dashboardController.getPriorityQueue
);

/**
 * GET /api/v1/dashboard/agent/recovery-rate
 * Percentage of overdue invoices recovered within the period
 */
router.get(
  '/agent/recovery-rate',
  restrictTo('owner', 'agent'),
  validateAgentDashboard,
  dashboardController.getRecoveryRate
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD — admin only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/dashboard/admin
 * Full admin dashboard: subscriptions + notifications + billing + SLA
 */
router.get(
  '/admin',
  restrictTo('admin'),
  validateAdminDashboard,
  dashboardController.getAdminDashboard
);

/**
 * GET /api/v1/dashboard/admin/subscriptions
 * Platform-wide subscription plan breakdown and new signups
 */
router.get(
  '/admin/subscriptions',
  restrictTo('admin'),
  validateAdminDashboard,
  dashboardController.getSubscriptionsOverview
);

/**
 * GET /api/v1/dashboard/admin/notifications-sent
 * Platform-wide notifications volume, by channel and status
 */
router.get(
  '/admin/notifications-sent',
  restrictTo('admin'),
  validateAdminDashboard,
  dashboardController.getNotificationsSent
);

/**
 * GET /api/v1/dashboard/admin/billing-usage
 * Active subscriptions, renewals upcoming, revenue by plan
 */
router.get(
  '/admin/billing-usage',
  restrictTo('admin'),
  validateAdminDashboard,
  dashboardController.getBillingUsage
);

/**
 * GET /api/v1/dashboard/admin/sla-performance
 * Delivery success rate, failure breakdown, avg attempts
 */
router.get(
  '/admin/sla-performance',
  restrictTo('admin'),
  validateAdminDashboard,
  dashboardController.getSlaPerformance
);

module.exports = router;