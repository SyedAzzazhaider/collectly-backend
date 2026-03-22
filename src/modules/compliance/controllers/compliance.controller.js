'use strict';

const complianceService = require('../services/compliance.service');
const AppError          = require('../../../shared/errors/AppError');
const { createAuditLog, auditFromReq } = require('../../../shared/utils/audit.util');

const sendSuccess = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ status: 'success', message, data });

const parsePageParams = (query) => {
  const rawPage  = parseInt(query.page,  10);
  const rawLimit = parseInt(query.limit, 10);
  if (query.page  !== undefined && (!Number.isInteger(rawPage)  || rawPage  < 1)) return null;
  if (query.limit !== undefined && (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100)) return null;
  return {
    page:  query.page  !== undefined ? rawPage  : 1,
    limit: query.limit !== undefined ? rawLimit : 20,
  };
};

const extractMeta = (req) => ({
  ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress
             || null,
  userAgent: req.headers['user-agent'] || null,
});

// ── GET /compliance/customers/:customerId/consent ─────────────────────────────

const getConsentStatus = async (req, res, next) => {
  try {
    const result = await complianceService.getConsentStatus(
      req.user.id,
      req.params.customerId
    );
    sendSuccess(res, 200, 'Consent status retrieved.', result);
  } catch (err) { next(err); }
};

// ── PATCH /compliance/customers/:customerId/consent ───────────────────────────

const updateConsent = async (req, res, next) => {
  try {
    const { ipAddress, userAgent } = extractMeta(req);
    const result = await complianceService.updateConsent(
      req.user.id,
      req.params.customerId,
      {
        consentType: req.body.consentType,
        granted:     req.body.granted,
        source:      req.body.source     || 'api',
        notes:       req.body.notes      || null,
        ipAddress,
        userAgent,
      }
    );
    sendSuccess(res, 200, 'Consent updated successfully.', result);
  } catch (err) { next(err); }
};

// ── GET /compliance/customers/:customerId/consent/history ─────────────────────

const getConsentHistory = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await complianceService.getConsentHistory(
      req.user.id,
      req.params.customerId,
      {
        page:        pagination.page,
        limit:       pagination.limit,
        consentType: req.query.consentType || null,
      }
    );
    sendSuccess(res, 200, 'Consent history retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /compliance/customers/:customerId/consent/token ───────────────────────

const getUnsubscribeToken = async (req, res, next) => {
  try {
    const token = complianceService.getUnsubscribeToken(
      req.user.id,
      req.params.customerId
    );
    const unsubscribeUrl = `${process.env.FRONTEND_URL}/unsubscribe/${req.params.customerId}?token=${token}`;
    sendSuccess(res, 200, 'Unsubscribe token generated.', { token, unsubscribeUrl });
  } catch (err) { next(err); }
};

// ── GET /compliance/unsubscribe/:customerId — PUBLIC ──────────────────────────

const processUnsubscribe = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) {
      return next(new AppError('Unsubscribe token is required.', 400, 'MISSING_TOKEN'));
    }
    const result = await complianceService.processUnsubscribe(
      token,
      req.params.customerId
    );
    sendSuccess(res, 200, result.message, { unsubscribed: result.unsubscribed });
  } catch (err) { next(err); }
};

// ── GET /compliance/dnc ───────────────────────────────────────────────────────

const getDncList = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await complianceService.getDncList(req.user.id, {
      page:  pagination.page,
      limit: pagination.limit,
    });
    sendSuccess(res, 200, 'DNC list retrieved.', result);
  } catch (err) { next(err); }
};

// ── POST /compliance/dnc ──────────────────────────────────────────────────────

const addToDnc = async (req, res, next) => {
  try {
    const result = await complianceService.addToDnc(req.user.id, {
      customerId: req.body.customerId,
      channels:   req.body.channels || ['all'],
      reason:     req.body.reason   || 'customer_request',
      notes:      req.body.notes    || null,
    });
    
    await createAuditLog('compliance.dnc_add', {
      ...auditFromReq(req),
      userId:       req.user.id,
      resourceType: 'compliance',
      resourceId:   req.body.customerId,
    });
    
    sendSuccess(res, 201, 'Customer added to DNC list.', { dncEntry: result });
  } catch (err) { next(err); }
};

// ── DELETE /compliance/dnc/:customerId ────────────────────────────────────────

const removeFromDnc = async (req, res, next) => {
  try {
    const result = await complianceService.removeFromDnc(
      req.user.id,
      req.params.customerId,
      req.user.id
    );
    
    await createAuditLog('compliance.dnc_remove', {
      ...auditFromReq(req),
      userId:       req.user.id,
      resourceType: 'compliance',
      resourceId:   req.params.customerId,
    });
    
    sendSuccess(res, 200, 'Customer removed from DNC list.', { dncEntry: result });
  } catch (err) { next(err); }
};

// ── GET /compliance/dnc/:customerId/check ─────────────────────────────────────

const checkDncStatus = async (req, res, next) => {
  try {
    const result = await complianceService.isOnDncList(
      req.user.id,
      req.params.customerId
    );
    sendSuccess(res, 200, 'DNC status retrieved.', result);
  } catch (err) { next(err); }
};

// ── POST /compliance/gdpr/export ──────────────────────────────────────────────

const requestDataExport = async (req, res, next) => {
  try {
    const { ipAddress } = extractMeta(req);
    const result = await complianceService.requestDataExport(req.user.id, {
      exportType: req.body.exportType || 'full_account',
      customerId: req.body.customerId || null,
      ipAddress,
    });
    
    await createAuditLog('compliance.gdpr_export', {
      ...auditFromReq(req),
      userId:       req.user.id,
      resourceType: 'compliance',
      metadata:     { requestedBy: req.user.id },
    });
    
    sendSuccess(res, 201, 'Data export request submitted.', { exportRequest: result });
  } catch (err) { next(err); }
};

// ── GET /compliance/gdpr/exports ─────────────────────────────────────────────

const getExportRequests = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await complianceService.getExportRequests(req.user.id, {
      page:  pagination.page,
      limit: pagination.limit,
    });
    sendSuccess(res, 200, 'Export requests retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /compliance/gdpr/exports/:id ─────────────────────────────────────────

const getExportStatus = async (req, res, next) => {
  try {
    const result = await complianceService.getExportStatus(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Export status retrieved.', { exportRequest: result });
  } catch (err) { next(err); }
};

// ── GET /compliance/gdpr/exports/:id/download ────────────────────────────────

const downloadExport = async (req, res, next) => {
  try {
    const data = await complianceService.downloadExportData(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Export data retrieved.', { exportData: data });
  } catch (err) { next(err); }
};

module.exports = {
  getConsentStatus,
  updateConsent,
  getConsentHistory,
  getUnsubscribeToken,
  processUnsubscribe,
  getDncList,
  addToDnc,
  removeFromDnc,
  checkDncStatus,
  requestDataExport,
  getExportRequests,
  getExportStatus,
  downloadExport,
};

