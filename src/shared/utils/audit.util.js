'use strict';

const { AuditLog } = require('../models/AuditLog.model');
const logger       = require('./logger');

const createAuditLog = async (action, options = {}) => {
  try {
    const {
      userId,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      metadata = {},
      status   = 'success',
    } = options;

    await AuditLog.create({
      userId,
      action,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      metadata,
      status,
    });
  } catch (err) {
    // Audit log failure must never break the main request flow
    logger.error(`Audit log write failed: action=${action} error=${err.message}`);
  }
};

// Helper to extract request metadata
const auditFromReq = (req) => ({
  userId:    req.user?.id || null,
  ipAddress: req.ip      || null,
  userAgent: req.headers['user-agent'] || null,
});

module.exports = { createAuditLog, auditFromReq };

