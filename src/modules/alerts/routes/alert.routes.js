'use strict';

const express = require('express');
const router  = express.Router();

const alertController              = require('../controllers/alert.controller');
const { protect, restrictTo }      = require('../../../shared/middlewares/auth.middleware');
const { validateGetAlerts }        = require('../validators/alert.validator');

// All alert routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// STATIC NAMED ROUTES — must be before /:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/alerts/unread-count
 * Get count of unread alerts for authenticated user
 */
router.get('/unread-count', alertController.getUnreadCount);

/**
 * POST /api/v1/alerts/read-all
 * Mark all alerts as read for authenticated user
 */
router.post('/read-all', alertController.markAllAsRead);

/**
 * POST /api/v1/alerts/check-subscriptions
 * Admin: manually trigger subscription expiry check
 */
router.post(
  '/check-subscriptions',
  restrictTo('admin'),
  alertController.checkSubscriptionExpiry
);

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION ROUTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/alerts
 * List alerts with optional filters (type, isRead, pagination)
 */
router.get('/', validateGetAlerts, alertController.getAlerts);

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC :id ROUTES — must be last
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/alerts/:id
 * Get single alert by ID
 */
router.get('/:id', alertController.getAlertById);

/**
 * POST /api/v1/alerts/:id/read
 * Mark a single alert as read
 */
router.post('/:id/read', alertController.markAsRead);

/**
 * DELETE /api/v1/alerts/:id
 * Delete a single alert
 */
router.delete('/:id', alertController.deleteAlert);

module.exports = router;

