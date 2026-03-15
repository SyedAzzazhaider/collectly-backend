'use strict';

const express = require('express');
const router  = express.Router();

const messageController     = require('../controllers/message.controller');
const cannedReplyController = require('../controllers/cannedReply.controller');
const paymentPlanController = require('../controllers/paymentPlan.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateSendMessage,
  validateCreateCannedReply,
  validateUpdateCannedReply,
  validateCreatePaymentPlan,
  validateFollowUp,
} = require('../validators/conversation.validator');

router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// INBOX & MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET  /api/v1/conversations/inbox
 * Agent inbox — all messages with filters
 */
router.get('/inbox', messageController.getInbox);

/**
 * POST /api/v1/conversations/messages
 * Send an outbound message to a customer
 */
router.post(
  '/messages',
  restrictTo('owner', 'admin', 'agent'),
  validateSendMessage,
  messageController.sendMessage
);

/**
 * POST /api/v1/conversations/messages/inbound
 * Record an inbound message from a customer
 */
router.post(
  '/messages/inbound',
  restrictTo('owner', 'admin', 'agent'),
  messageController.recordInbound
);

/**
 * GET /api/v1/conversations/thread/:customerId
 * Get full conversation thread for a customer
 */
router.get('/thread/:customerId', messageController.getThread);

/**
 * GET /api/v1/conversations/stats/:customerId
 * Get conversation statistics for a customer
 */
router.get('/stats/:customerId', messageController.getConversationStats);

/**
 * GET /api/v1/conversations/messages/:id
 * Get single message by ID
 */
router.get('/messages/:id', messageController.getMessageById);

/**
 * PATCH /api/v1/conversations/messages/:id/notes
 * Update notes and tags on a message
 */
router.patch('/messages/:id/notes', messageController.updateNotesTags);

/**
 * POST /api/v1/conversations/messages/:id/read
 * Mark a message as read
 */
router.post('/messages/:id/read', messageController.markAsRead);

/**
 * POST /api/v1/conversations/messages/:id/follow-up
 * Schedule a follow-up on a message
 */
router.post(
  '/messages/:id/follow-up',
  validateFollowUp,
  messageController.scheduleFollowUp
);

/**
 * POST /api/v1/conversations/messages/:id/follow-up/complete
 * Mark a follow-up as completed
 */
router.post('/messages/:id/follow-up/complete', messageController.completeFollowUp);

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/conversations/follow-ups
 * Get all pending follow-ups for authenticated user
 */
router.get('/follow-ups', messageController.getFollowUps);

/**
 * GET /api/v1/conversations/follow-ups/stats
 * Get follow-up statistics
 */
router.get('/follow-ups/stats', messageController.getFollowUpStats);

// ─────────────────────────────────────────────────────────────────────────────
// CANNED REPLIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET  /api/v1/conversations/canned-replies/categories
 * Must be before /:id to avoid param collision
 */
router.get('/canned-replies/categories', cannedReplyController.getCategories);

/**
 * GET  /api/v1/conversations/canned-replies
 * POST /api/v1/conversations/canned-replies
 */
router.route('/canned-replies')
  .get(cannedReplyController.getAll)
  .post(
    restrictTo('owner', 'admin', 'agent'),
    validateCreateCannedReply,
    cannedReplyController.create
  );

/**
 * GET    /api/v1/conversations/canned-replies/:id
 * PATCH  /api/v1/conversations/canned-replies/:id
 * DELETE /api/v1/conversations/canned-replies/:id
 */
router.route('/canned-replies/:id')
  .get(cannedReplyController.getById)
  .patch(
    restrictTo('owner', 'admin', 'agent'),
    validateUpdateCannedReply,
    cannedReplyController.update
  )
  .delete(
    restrictTo('owner', 'admin'),
    cannedReplyController.remove
  );

/**
 * POST /api/v1/conversations/canned-replies/:id/preview
 */
router.post('/canned-replies/:id/preview', cannedReplyController.preview);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT PLANS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET  /api/v1/conversations/payment-plans
 * POST /api/v1/conversations/payment-plans
 */
router.route('/payment-plans')
  .get(paymentPlanController.getAll)
  .post(
    restrictTo('owner', 'admin', 'agent'),
    validateCreatePaymentPlan,
    paymentPlanController.create
  );

/**
 * GET /api/v1/conversations/payment-plans/:id
 */
router.get('/payment-plans/:id', paymentPlanController.getById);

/**
 * POST /api/v1/conversations/payment-plans/:id/accept
 */
router.post(
  '/payment-plans/:id/accept',
  restrictTo('owner', 'admin', 'agent'),
  paymentPlanController.accept
);

/**
 * POST /api/v1/conversations/payment-plans/:id/reject
 */
router.post(
  '/payment-plans/:id/reject',
  restrictTo('owner', 'admin', 'agent'),
  paymentPlanController.reject
);

/**
 * POST /api/v1/conversations/payment-plans/:id/cancel
 */
router.post(
  '/payment-plans/:id/cancel',
  restrictTo('owner', 'admin'),
  paymentPlanController.cancel
);

/**
 * POST /api/v1/conversations/payment-plans/:id/installments/:number/pay
 */
router.post(
  '/payment-plans/:id/installments/:number/pay',
  restrictTo('owner', 'admin', 'agent'),
  paymentPlanController.recordPayment
);

module.exports = router;