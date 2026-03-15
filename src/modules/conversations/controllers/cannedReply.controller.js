'use strict';

const cannedReplyService = require('../services/cannedReply.service');
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

// ── POST /conversations/canned-replies ────────────────────────────────────────

const create = async (req, res, next) => {
  try {
    const cannedReply = await cannedReplyService.createCannedReply(req.user.id, req.body);
    sendSuccess(res, 201, 'Canned reply created successfully.', { cannedReply });
  } catch (err) { next(err); }
};

// ── GET /conversations/canned-replies ─────────────────────────────────────────

const getAll = async (req, res, next) => {
  try {
    const pagination = parsePageParams(req.query);
    if (!pagination) {
      return next(new AppError('Invalid pagination parameters.', 400, 'INVALID_PAGINATION'));
    }
    const result = await cannedReplyService.getCannedReplies(req.user.id, {
      page:     pagination.page,
      limit:    pagination.limit,
      channel:  req.query.channel  || null,
      category: req.query.category || null,
      isActive: req.query.isActive ?? null,
      search:   req.query.search   || null,
    });
    sendSuccess(res, 200, 'Canned replies retrieved.', result);
  } catch (err) { next(err); }
};

// ── GET /conversations/canned-replies/categories ──────────────────────────────

const getCategories = async (req, res, next) => {
  try {
    const categories = await cannedReplyService.getCannedReplyCategories(req.user.id);
    sendSuccess(res, 200, 'Categories retrieved.', { categories });
  } catch (err) { next(err); }
};

// ── GET /conversations/canned-replies/:id ─────────────────────────────────────

const getById = async (req, res, next) => {
  try {
    const cannedReply = await cannedReplyService.getCannedReplyById(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Canned reply retrieved.', { cannedReply });
  } catch (err) { next(err); }
};

// ── PATCH /conversations/canned-replies/:id ───────────────────────────────────

const update = async (req, res, next) => {
  try {
    const cannedReply = await cannedReplyService.updateCannedReply(
      req.user.id, req.params.id, req.body
    );
    sendSuccess(res, 200, 'Canned reply updated.', { cannedReply });
  } catch (err) { next(err); }
};

// ── DELETE /conversations/canned-replies/:id ──────────────────────────────────

const remove = async (req, res, next) => {
  try {
    const result = await cannedReplyService.deleteCannedReply(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Canned reply deleted.', result);
  } catch (err) { next(err); }
};

// ── POST /conversations/canned-replies/:id/preview ────────────────────────────

const preview = async (req, res, next) => {
  try {
    const result = await cannedReplyService.previewCannedReply(
      req.user.id, req.params.id, req.body
    );
    sendSuccess(res, 200, 'Canned reply preview generated.', result);
  } catch (err) { next(err); }
};

module.exports = { create, getAll, getCategories, getById, update, remove, preview };