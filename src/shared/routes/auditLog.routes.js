'use strict';

const express  = require('express');
const router   = express.Router();
const { AuditLog } = require('../models/AuditLog.model');
const { protect, restrictTo } = require('../middlewares/auth.middleware');

router.use(protect);

// ── Valid filter values — prevents operator injection ──────────────────────────

const VALID_ACTIONS = [
  'user.signup', 'user.login', 'user.logout', 'user.logout_all',
  'user.password_change', 'user.password_reset', 'user.email_verify',
  'user.2fa_enable', 'user.2fa_disable',
  'billing.subscribe', 'billing.plan_change', 'billing.cancel', 'billing.reactivate',
  'customer.create', 'customer.update', 'customer.delete',
  'invoice.create', 'invoice.update', 'invoice.delete', 'invoice.payment',
  'sequence.create', 'sequence.update', 'sequence.delete', 'sequence.assign',
  'compliance.dnc_add', 'compliance.dnc_remove', 'compliance.gdpr_export',
  'compliance.unsubscribe', 'admin.user_view', 'admin.billing_view',
];

const VALID_STATUSES = ['success', 'failure'];

const isValidObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));

/**
 * GET /api/v1/audit-logs
 * Admin: list audit logs with filters
 */
router.get(
  '/',
  restrictTo('admin'),
  async (req, res, next) => {
    try {
      const {
        userId, action, status,
        page     = 1,
        limit    = 50,
        dateFrom,
        dateTo,
      } = req.query;

      // ── Input validation ──────────────────────────────────────────────────
      if (action && !VALID_ACTIONS.includes(action)) {
        return res.status(422).json({ status: 'fail', message: 'Invalid action filter.' });
      }
      if (status && !VALID_STATUSES.includes(status)) {
        return res.status(422).json({ status: 'fail', message: 'Invalid status filter.' });
      }
      if (userId && !isValidObjectId(userId)) {
        return res.status(422).json({ status: 'fail', message: 'Invalid userId format.' });
      }
      if (isNaN(Number(page)) || Number(page) < 1) {
        return res.status(422).json({ status: 'fail', message: 'Invalid page parameter.' });
      }
      if (isNaN(Number(limit)) || Number(limit) < 1 || Number(limit) > 200) {
        return res.status(422).json({ status: 'fail', message: 'Invalid limit. Max 200.' });
      }
      if (dateFrom && isNaN(new Date(dateFrom).getTime())) {
        return res.status(422).json({ status: 'fail', message: 'Invalid dateFrom format.' });
      }
      if (dateTo && isNaN(new Date(dateTo).getTime())) {
        return res.status(422).json({ status: 'fail', message: 'Invalid dateTo format.' });
      }

      // ── Build filter ──────────────────────────────────────────────────────
      const filter = {};
      if (userId) filter.userId = userId;
      if (action) filter.action = action;
      if (status) filter.status = status;
      if (dateFrom || dateTo) {
        filter.createdAt = {};
        if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
        if (dateTo)   filter.createdAt.$lte = new Date(dateTo);
      }

      const skip  = (Number(page) - 1) * Number(limit);
      const total = await AuditLog.countDocuments(filter);
      const logs  = await AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();

      res.status(200).json({
        status:  'success',
        message: 'Audit logs retrieved.',
        data: {
          logs,
          pagination: {
            total,
            page:  Number(page),
            limit: Number(limit),
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }
);

/**
 * GET /api/v1/audit-logs/my
 * Authenticated user: view own audit logs
 */
router.get(
  '/my',
  async (req, res, next) => {
    try {
      const { page = 1, limit = 20 } = req.query;

      if (isNaN(Number(page)) || Number(page) < 1) {
        return res.status(422).json({ status: 'fail', message: 'Invalid page parameter.' });
      }
      if (isNaN(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) {
        return res.status(422).json({ status: 'fail', message: 'Invalid limit. Max 100.' });
      }

      const skip  = (Number(page) - 1) * Number(limit);
      const total = await AuditLog.countDocuments({ userId: req.user.id });
      const logs  = await AuditLog.find({ userId: req.user.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();

      res.status(200).json({
        status:  'success',
        message: 'Your audit logs retrieved.',
        data: {
          logs,
          pagination: {
            total,
            page:  Number(page),
            limit: Number(limit),
            pages: Math.ceil(total / Number(limit)),
          },
        },
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;