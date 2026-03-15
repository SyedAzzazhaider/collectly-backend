'use strict';

const express    = require('express');
const router     = express.Router();

const notificationController = require('../controllers/notification.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateSendNotification,
  validateSendBulk,
  validateGetNotifications,
} = require('../validators/notification.validator');

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// STATIC NAMED ROUTES — must be before /:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/stats
 * Get notification statistics for authenticated user
 */
router.get('/stats', notificationController.getStats);

/**
 * GET /api/v1/notifications/delivery-stats
 * Get delivery statistics per channel for authenticated user
 */
router.get('/delivery-stats', notificationController.getDeliveryStats);

/**
 * POST /api/v1/notifications/send
 * Send a single notification
 */
router.post(
  '/send',
  restrictTo('owner', 'admin', 'agent'),
  validateSendNotification,
  notificationController.send
);

/**
 * POST /api/v1/notifications/send-bulk
 * Send multiple notifications in one request
 */
router.post(
  '/send-bulk',
  restrictTo('owner', 'admin', 'agent'),
  validateSendBulk,
  notificationController.sendBulk
);

/**
 * GET /api/v1/notifications/invoice/:invoiceId
 * Get all notifications for a specific invoice
 */
router.get(
  '/invoice/:invoiceId',
  notificationController.getInvoiceNotifications
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/admin
 * Admin: list all notifications across all users
 */
router.get(
  '/admin',
  restrictTo('admin'),
  notificationController.getAllNotificationsAdmin
);

/**
 * POST /api/v1/notifications/retry-failed
 * Admin: trigger retry batch for failed notifications
 */
router.post(
  '/retry-failed',
  restrictTo('admin'),
  notificationController.retryFailedBatch
);

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION ROUTE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications
 * List notifications with filters
 */
router.get('/', validateGetNotifications, notificationController.getNotifications);

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC :id ROUTES — must be last
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/notifications/:id
 * Get single notification by ID
 */
router.get('/:id', notificationController.getNotificationById);

/**
 * POST /api/v1/notifications/:id/cancel
 * Cancel a pending notification
 */
router.post('/:id/cancel', notificationController.cancelNotification);

/**
 * POST /api/v1/notifications/:id/retry
 * Manually retry a failed notification
 */
router.post(
  '/:id/retry',
  restrictTo('owner', 'admin', 'agent'),
  notificationController.retryNotification
);

module.exports = router;