'use strict';

const express  = require('express');
const router   = express.Router();
const { AuditLog } = require('../models/AuditLog.model');
const { protect, restrictTo } = require('../middlewares/auth.middleware');
const AppError = require('../errors/AppError');

router.use(protect);

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
        page  = 1,
        limit = 50,
        dateFrom, dateTo,
      } = req.query;

      const filter = {};
      if (userId)   filter.userId = userId;
      if (action)   filter.action = action;
      if (status)   filter.status = status;
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