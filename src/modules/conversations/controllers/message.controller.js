'use strict';

const messageService = require('../services/message.service');
const followUpService = require('../services/followUp.service');
const AppError = require('../../../shared/errors/AppError');

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

// ── POST /conversations/messages ──────────────────────────────────────────────

const sendMessage = async (req, res, next) => {
  try {
    const message = await messageService.sendMessage(req.user.id, req.body);
    sendSuccess(res, 201, 'Message sent successfully.', { message });
  } catch (err) { next(err); }
};

// ── POST /conversations/messages/inbound ──────────────────────────────────────

const recordInbound = async (req, res, next) => {
  try {
    const message = await messageService.recordInboundMessage(req.user.id, req.body);
    sendSuccess(res, 201, 'Inbound message recorded.', { message });
  } catch (err) { next(err); }
};

// ── GET /conversations/inbox ──────────────────────────────────────────────────

const getInbox = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await messageService.getInbox(req.user.id, {
      page:        pagination.page,
      limit:       pagination.limit,
      customerId:  req.query.customerId  || null,
      invoiceId:   req.query.invoiceId   || null,
      direction:   req.query.direction   || null,
      channel:     req.query.channel     || null,
      type:        req.query.type        || null,
      status:      req.query.status      || null,
      hasFollowUp: req.query.hasFollowUp || null,
    });
    sendSuccess(res, 200, 'Inbox retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /conversations/thread/:customerId ─────────────────────────────────────

const getThread = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await messageService.getConversationThread(
      req.user.id,
      req.params.customerId,
      {
        page:      pagination.page,
        limit:     pagination.limit,
        invoiceId: req.query.invoiceId || null,
      }
    );
    sendSuccess(res, 200, 'Conversation thread retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /conversations/messages/:id ──────────────────────────────────────────

const getMessageById = async (req, res, next) => {
  try {
    const message = await messageService.getMessageById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Message retrieved.', { message });
  } catch (err) { next(err); }
};

// ── PATCH /conversations/messages/:id/notes ───────────────────────────────────

const updateNotesTags = async (req, res, next) => {
  try {
    const { notes, tags } = req.body;
    const message = await messageService.updateMessageNotesTags(
      req.user.id, req.params.id, { notes, tags }
    );
    sendSuccess(res, 200, 'Message notes and tags updated.', { message });
  } catch (err) { next(err); }
};

// ── POST /conversations/messages/:id/read ─────────────────────────────────────

const markAsRead = async (req, res, next) => {
  try {
    const message = await messageService.markAsRead(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Message marked as read.', { message });
  } catch (err) { next(err); }
};

// ── GET /conversations/follow-ups ─────────────────────────────────────────────

const getFollowUps = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await followUpService.getAllPendingFollowUps(req.user.id, {
      page:        pagination.page,
      limit:       pagination.limit,
      overdueOnly: req.query.overdueOnly === 'true',
      customerId:  req.query.customerId || null,
    });
    sendSuccess(res, 200, 'Follow-ups retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /conversations/follow-ups/stats ──────────────────────────────────────

const getFollowUpStats = async (req, res, next) => {
  try {
    const stats = await followUpService.getFollowUpStats(req.user.id);
    sendSuccess(res, 200, 'Follow-up statistics retrieved.', { stats });
  } catch (err) { next(err); }
};

// ── POST /conversations/messages/:id/follow-up ────────────────────────────────

const scheduleFollowUp = async (req, res, next) => {
  try {
    const message = await messageService.scheduleFollowUp(
      req.user.id, req.params.id, req.body
    );
    sendSuccess(res, 200, 'Follow-up scheduled.', { message });
  } catch (err) { next(err); }
};

// ── POST /conversations/messages/:id/follow-up/complete ───────────────────────

const completeFollowUp = async (req, res, next) => {
  try {
    const message = await messageService.completeFollowUp(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Follow-up completed.', { message });
  } catch (err) { next(err); }
};

// ── GET /conversations/stats/:customerId ──────────────────────────────────────

const getConversationStats = async (req, res, next) => {
  try {
    const stats = await messageService.getConversationStats(
      req.user.id, req.params.customerId
    );
    sendSuccess(res, 200, 'Conversation statistics retrieved.', { stats });
  } catch (err) { next(err); }
};

module.exports = {
  sendMessage,
  recordInbound,
  getInbox,
  getThread,
  getMessageById,
  updateNotesTags,
  markAsRead,
  getFollowUps,
  getFollowUpStats,
  scheduleFollowUp,
  completeFollowUp,
  getConversationStats,
};

