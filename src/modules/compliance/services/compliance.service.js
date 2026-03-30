'use strict';

const crypto     = require('crypto');
const mongoose   = require('mongoose');
const { ConsentLog }        = require('../models/ConsentLog.model');
const { DncList }           = require('../models/DncList.model');
const { DataExportRequest } = require('../models/DataExportRequest.model');
const Customer  = require('../../customers/models/Customer.model');
const Invoice   = require('../../customers/models/Invoice.model');
const User      = require('../../auth/models/User.model');
const AppError  = require('../../../shared/errors/AppError');
const logger    = require('../../../shared/utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

const toObjId = (id) => new mongoose.Types.ObjectId(String(id));

const extractMeta = (req) => ({
  ipAddress: req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
             || req?.socket?.remoteAddress
             || null,
  userAgent: req?.headers?.['user-agent'] || null,
});

// ── Generate unsubscribe token ────────────────────────────────────────────────
// HMAC-based — ties token to userId+customerId so it cannot be forged

const generateUnsubscribeToken = (userId, customerId) => {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_ACCESS_SECRET;
  // SECURITY: Hard-fail if no secret is configured in production.
  // A missing secret means ALL unsubscribe tokens are forgeable — treat as fatal.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError(
        'UNSUBSCRIBE_SECRET is not configured. Set this env var before going live.',
        500,
        'CONFIG_MISSING'
      );
    }
    // Dev/test: warn loudly but allow operation so tests don't halt
    logger.warn('UNSUBSCRIBE_SECRET not set — unsubscribe tokens are using JWT_ACCESS_SECRET as fallback. Set UNSUBSCRIBE_SECRET in .env.');
  }
  const resolvedSecret = secret || 'dev_only_not_for_production';
  const payload = `${userId}:${customerId}:unsubscribe`;
  return crypto
    .createHmac('sha256', resolvedSecret)
    .update(payload)
    .digest('hex');
};

const verifyUnsubscribeToken = (token, userId, customerId) => {
  const expected = generateUnsubscribeToken(userId, customerId);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// ── Update consent for a customer ────────────────────────────────────────────

const updateConsent = async (userId, customerId, {
  consentType,
  granted,
  source    = 'api',
  notes     = null,
  ipAddress = null,
  userAgent = null,
} = {}) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  // Map consentType to customer preference channel
  const channelMap = {
    sms_marketing:       'sms',
    whatsapp_marketing:  'whatsapp',
    email_marketing:     'email',
    data_processing:     null, // No direct channel mapping — GDPR general consent
  };

  const channel = channelMap[consentType];

  // Update customer preferences channels based on consent
  if (channel) {
    const currentChannels = customer.preferences?.channels || ['email'];

    if (granted && !currentChannels.includes(channel)) {
      customer.preferences.channels = [...currentChannels, channel];
    } else if (!granted) {
      customer.preferences.channels = currentChannels.filter((c) => c !== channel);
    }

    await customer.save({ validateBeforeSave: false });
  }

  // If revoking all consent — set doNotContact
  if (!granted && consentType === 'data_processing') {
    customer.preferences.doNotContact = true;
    await customer.save({ validateBeforeSave: false });
  }

  // Log the consent action for GDPR audit trail
  const consentLog = await ConsentLog.create({
    userId,
    customerId,
    consentType,
    action:    granted ? 'granted' : 'revoked',
    source,
    ipAddress,
    userAgent,
    notes,
  });

  logger.info(
    `Consent ${granted ? 'granted' : 'revoked'}: customerId=${customerId} type=${consentType} userId=${userId}`
  );

  return { customer, consentLog };
};

// ── Get consent status for a customer ────────────────────────────────────────

const getConsentStatus = async (userId, customerId) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  const channels = customer.preferences?.channels || ['email'];

  return {
    customerId,
    doNotContact:      customer.preferences?.doNotContact || false,
    consents: {
      email_marketing:      channels.includes('email'),
      sms_marketing:        channels.includes('sms'),
      whatsapp_marketing:   channels.includes('whatsapp'),
      data_processing:      !customer.preferences?.doNotContact,
    },
    preferredChannels: channels,
  };
};

// ── Get consent history for a customer ───────────────────────────────────────

const getConsentHistory = async (userId, customerId, {
  page        = 1,
  limit       = 20,
  consentType = null,
} = {}) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  const query = { userId, customerId };
  if (consentType) query.consentType = consentType;

  const skip  = (page - 1) * limit;
  const total = await ConsentLog.countDocuments(query);

  const logs = await ConsentLog.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    logs,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DNC LIST MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// ── Add customer to DNC list ──────────────────────────────────────────────────

const addToDnc = async (userId, {
  customerId,
  channels = ['all'],
  reason   = 'customer_request',
  notes    = null,
} = {}) => {
  const customer = await Customer.findOne({ _id: customerId, userId });
  if (!customer) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');

  // Upsert — if already on DNC, update it
  const existing = await DncList.findOne({ userId, customerId });

  if (existing) {
    existing.channels  = channels;
    existing.reason    = reason;
    existing.notes     = notes;
    existing.isActive  = true;
    existing.removedAt = null;
    existing.removedBy = null;
    await existing.save({ validateBeforeSave: false });

    // Also set doNotContact on customer
    customer.preferences.doNotContact = true;
    await customer.save({ validateBeforeSave: false });

    logger.info(`DNC updated: customerId=${customerId} userId=${userId}`);
    return existing;
  }

  const dncEntry = await DncList.create({
    userId,
    customerId,
    channels,
    reason,
    notes,
    isActive: true,
  });

  // Set doNotContact flag on customer
  customer.preferences.doNotContact = true;
  await customer.save({ validateBeforeSave: false });

  // Log consent revocation
  await ConsentLog.create({
    userId,
    customerId,
    consentType: 'data_processing',
    action:      'revoked',
    source:      'admin',
    notes:       `Added to DNC list. Reason: ${reason}`,
  });

  logger.info(`Customer added to DNC: customerId=${customerId} userId=${userId} reason=${reason}`);
  return dncEntry;
};

// ── Remove customer from DNC list ────────────────────────────────────────────

const removeFromDnc = async (userId, customerId, removedByUserId) => {
  const dncEntry = await DncList.findOne({ userId, customerId, isActive: true });
  if (!dncEntry) {
    throw new AppError('Customer is not on the DNC list.', 404, 'DNC_ENTRY_NOT_FOUND');
  }

  dncEntry.isActive  = false;
  dncEntry.removedAt = new Date();
  dncEntry.removedBy = removedByUserId;
  await dncEntry.save({ validateBeforeSave: false });

  // Re-enable doNotContact = false on customer
  await Customer.findOneAndUpdate(
    { _id: customerId, userId },
    { 'preferences.doNotContact': false }
  );

  logger.info(`Customer removed from DNC: customerId=${customerId} userId=${userId}`);
  return dncEntry;
};

// ── Get DNC list ──────────────────────────────────────────────────────────────

const getDncList = async (userId, { page = 1, limit = 20 } = {}) => {
  const query = { userId, isActive: true };
  const skip  = (page - 1) * limit;
  const total = await DncList.countDocuments(query);

  const entries = await DncList.find(query)
    .populate('customerId', 'name email phone company')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    entries,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Check if customer is on DNC list ─────────────────────────────────────────

const isOnDncList = async (userId, customerId) => {
  const entry = await DncList.findOne({ userId, customerId, isActive: true });
  return {
    isOnDnc:  !!entry,
    channels: entry?.channels || [],
    reason:   entry?.reason   || null,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// UNSUBSCRIBE MECHANISM
// ─────────────────────────────────────────────────────────────────────────────

// ── Get unsubscribe token for a customer ──────────────────────────────────────

const getUnsubscribeToken = (userId, customerId) => {
  return generateUnsubscribeToken(String(userId), String(customerId));
};

// ── Process unsubscribe via token ─────────────────────────────────────────────
// Public endpoint — no authentication required

const processUnsubscribe = async (token, customerId) => {
  // Find which user owns this customer
  const customer = await Customer.findById(customerId)
    .select('userId name email preferences');

  if (!customer) {
    throw new AppError('Invalid unsubscribe link.', 400, 'INVALID_UNSUBSCRIBE_TOKEN');
  }

  const userId = String(customer.userId);

  // Verify HMAC token
  const isValid = verifyUnsubscribeToken(token, userId, String(customerId));
  if (!isValid) {
    throw new AppError('Invalid or expired unsubscribe link.', 400, 'INVALID_UNSUBSCRIBE_TOKEN');
  }

  // Add to DNC list
  await addToDnc(userId, {
    customerId:  String(customerId),
    channels:    ['all'],
    reason:      'unsubscribe_link',
    notes:       'Customer unsubscribed via email link',
  });

  // Log consent revocation
  await ConsentLog.create({
    userId,
    customerId,
    consentType: 'email_marketing',
    action:      'revoked',
    source:      'unsubscribe',
    notes:       'Unsubscribed via link in email',
  });

  logger.info(`Customer unsubscribed: customerId=${customerId} userId=${userId}`);

  return {
    unsubscribed: true,
    customerName: customer.name,
    message:      'You have been successfully unsubscribed from all communications.',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// GDPR — DATA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

// ── Request a GDPR data export ────────────────────────────────────────────────


// ── Request a GDPR data export ────────────────────────────────────────────────

const requestDataExport = async (userId, {
  exportType = 'full_account',
  customerId = null,
  ipAddress  = null,
} = {}) => {
  const existing = await DataExportRequest.findOne({
    userId,
    status: { $in: ['pending', 'processing'] },
  });

  if (existing) {
    throw new AppError(
      'A data export request is already in progress. Please wait for it to complete.',
      409,
      'EXPORT_ALREADY_IN_PROGRESS'
    );
  }

  const exportRequest = await DataExportRequest.create({
    userId,
    exportType,
    customerId: customerId || null,
    status:     'pending',
    ipAddress,
    expiresAt:  new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  logger.info(`Data export requested: userId=${userId} type=${exportType}`);

  // QUALITY-01 FIX: run export asynchronously in production to avoid blocking
  // the HTTP response on large accounts. In test mode run synchronously so
  // tests can assert on the completed state without polling.
  if (process.env.NODE_ENV === 'test') {
    await processDataExport(exportRequest._id);
    const completed = await DataExportRequest.findById(exportRequest._id);
    return completed;
  }

  setImmediate(() => {
    processDataExport(exportRequest._id).catch((err) => {
      logger.error(
        `Background data export failed: exportRequestId=${exportRequest._id} error=${err.message}`
      );
    });
  });

  return exportRequest;
};




// ── Process the data export ───────────────────────────────────────────────────

const processDataExport = async (exportRequestId) => {
  const exportRequest = await DataExportRequest.findById(exportRequestId);
  if (!exportRequest) return;

  exportRequest.status = 'processing';
  await exportRequest.save({ validateBeforeSave: false });

  try {
    const userId = exportRequest.userId;
    let exportData = {};

    if (exportRequest.exportType === 'full_account') {
      // Collect all data for the account
      const [user, customers, invoices, consentLogs, dncEntries] = await Promise.all([
        User.findById(userId).select('-password -twoFactorSecret -refreshTokens -emailVerifyToken -passwordResetToken').lean(),
        Customer.find({ userId }).lean(),
        Invoice.find({ userId }).lean(),
        ConsentLog.find({ userId }).lean(),
        DncList.find({ userId }).lean(),
      ]);

      exportData = {
        exportedAt:   new Date().toISOString(),
        exportType:   'full_account',
        account:      user,
        customers,
        invoices,
        consentLogs,
        dncEntries,
        summary: {
          totalCustomers:  customers.length,
          totalInvoices:   invoices.length,
          totalConsentLogs: consentLogs.length,
          totalDncEntries: dncEntries.length,
        },
      };
    } else if (exportRequest.exportType === 'customer_data') {
      const customerId = exportRequest.customerId;
      const [customer, invoices, consentLogs] = await Promise.all([
        Customer.findOne({ _id: customerId, userId }).lean(),
        Invoice.find({ customerId, userId }).lean(),
        ConsentLog.find({ customerId, userId }).lean(),
      ]);

      exportData = {
        exportedAt:  new Date().toISOString(),
        exportType:  'customer_data',
        customer,
        invoices,
        consentLogs,
      };
    }

    exportRequest.status      = 'completed';
    exportRequest.exportData  = exportData;
    exportRequest.completedAt = new Date();
    await exportRequest.save({ validateBeforeSave: false });

    logger.info(`Data export completed: exportRequestId=${exportRequestId}`);
  } catch (err) {
    exportRequest.status       = 'failed';
    exportRequest.errorMessage = err.message;
    await exportRequest.save({ validateBeforeSave: false });

    logger.error(`Data export failed: exportRequestId=${exportRequestId} error=${err.message}`);
  }
};

// ── Get export request status ─────────────────────────────────────────────────

const getExportStatus = async (userId, exportRequestId) => {
  const exportRequest = await DataExportRequest.findOne({
    _id:    exportRequestId,
    userId,
  });

  if (!exportRequest) {
    throw new AppError('Export request not found.', 404, 'EXPORT_NOT_FOUND');
  }

  return exportRequest;
};

// ── Download export data ──────────────────────────────────────────────────────

const downloadExportData = async (userId, exportRequestId) => {
  const exportRequest = await DataExportRequest.findOne({
    _id:    exportRequestId,
    userId,
  }).select('+exportData');

  if (!exportRequest) {
    throw new AppError('Export request not found.', 404, 'EXPORT_NOT_FOUND');
  }

  if (exportRequest.status !== 'completed') {
    throw new AppError(
      `Export is not ready. Current status: ${exportRequest.status}`,
      400,
      'EXPORT_NOT_READY'
    );
  }

  if (exportRequest.expiresAt && exportRequest.expiresAt < new Date()) {
    exportRequest.status = 'expired';
    await exportRequest.save({ validateBeforeSave: false });
    throw new AppError('Export has expired. Please request a new export.', 410, 'EXPORT_EXPIRED');
  }

  logger.info(`Data export downloaded: exportRequestId=${exportRequestId} userId=${userId}`);
  return exportRequest.exportData;
};

// ── Get all export requests for user ─────────────────────────────────────────

const getExportRequests = async (userId, { page = 1, limit = 10 } = {}) => {
  const skip  = (page - 1) * limit;
  const total = await DataExportRequest.countDocuments({ userId });

  const requests = await DataExportRequest.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    requests,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE GUARD — used by delivery engine
// ─────────────────────────────────────────────────────────────────────────────

// ── Check if sending is allowed for this customer + channel ───────────────────

const isDeliveryAllowed = async (userId, customerId, channel) => {
  const customer = await Customer.findOne({ _id: customerId, userId })
    .select('preferences');

  if (!customer) return { allowed: false, reason: 'customer_not_found' };

  // Check doNotContact flag
  if (customer.preferences?.doNotContact) {
    return { allowed: false, reason: 'do_not_contact' };
  }

  // Check DNC list
  const dncEntry = await DncList.findOne({
    userId,
    customerId,
    isActive: true,
  });

  if (dncEntry) {
    const blocksAll     = dncEntry.channels.includes('all');
    const blocksChannel = dncEntry.channels.includes(channel);

    if (blocksAll || blocksChannel) {
      return { allowed: false, reason: 'on_dnc_list', dncChannels: dncEntry.channels };
    }
  }

  // Check channel-specific opt-in
  const channelConsentMap = {
    sms:      'sms_marketing',
    whatsapp: 'whatsapp_marketing',
    email:    'email_marketing',
  };

  const requiredConsent = channelConsentMap[channel];
  if (requiredConsent) {
    const allowedChannels = customer.preferences?.channels || ['email'];
    if (!allowedChannels.includes(channel)) {
      return { allowed: false, reason: 'channel_not_opted_in', channel };
    }
  }

  return { allowed: true };
};

module.exports = {
  updateConsent,
  getConsentStatus,
  getConsentHistory,
  addToDnc,
  removeFromDnc,
  getDncList,
  isOnDncList,
  getUnsubscribeToken,
  processUnsubscribe,
  requestDataExport,
  getExportStatus,
  downloadExportData,
  getExportRequests,
  isDeliveryAllowed,
};

