'use strict';

const legalNoticeService = require('../services/legalNotice.service');
const AppError           = require('../../../shared/errors/AppError');

const sendSuccess = (res, statusCode, message, data = {}) =>
  res.status(statusCode).json({ status: 'success', message, data });

const createTemplate = async (req, res, next) => {
  try {
    const template = await legalNoticeService.createTemplate(req.user.id, req.body);
    sendSuccess(res, 201, 'Legal notice template created.', { template });
  } catch (err) { next(err); }
};

const listTemplates = async (req, res, next) => {
  try {
    const { page, limit, isActive } = req.query;
    const result = await legalNoticeService.listTemplates(req.user.id, {
      page:     parseInt(page)  || 1,
      limit:    parseInt(limit) || 20,
      isActive,
    });
    sendSuccess(res, 200, 'Legal notice templates retrieved.', result);
  } catch (err) { next(err); }
};

const getTemplate = async (req, res, next) => {
  try {
    const template = await legalNoticeService.getTemplate(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Legal notice template retrieved.', { template });
  } catch (err) { next(err); }
};

const updateTemplate = async (req, res, next) => {
  try {
    const template = await legalNoticeService.updateTemplate(
      req.user.id, req.params.id, req.body
    );
    sendSuccess(res, 200, 'Legal notice template updated.', { template });
  } catch (err) { next(err); }
};

const deleteTemplate = async (req, res, next) => {
  try {
    const result = await legalNoticeService.deleteTemplate(req.user.id, req.params.id);
    sendSuccess(res, 200, 'Legal notice template deleted.', result);
  } catch (err) { next(err); }
};

const previewTemplate = async (req, res, next) => {
  try {
    const preview = await legalNoticeService.previewTemplate(
      req.user.id, req.params.id, req.body.context || {}
    );
    sendSuccess(res, 200, 'Preview generated.', { preview });
  } catch (err) { next(err); }
};

const getSupportedVariables = (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Supported template variables.',
    data: { variables: legalNoticeService.SUPPORTED_VARIABLES },
  });
};

const sendLegalNotice = async (req, res, next) => {
  try {
    const { customerId, invoiceId, channel } = req.body;
    if (!customerId) return next(new AppError('customerId is required.', 400));
    const result = await legalNoticeService.sendLegalNotice(
      req.user.id, req.params.id, { customerId, invoiceId, channel }
    );
    sendSuccess(res, 200, 'Legal notice sent successfully.', result);
  } catch (err) { next(err); }
};

module.exports = {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  getSupportedVariables,
  sendLegalNotice,
};