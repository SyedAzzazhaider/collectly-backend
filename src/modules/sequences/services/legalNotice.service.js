'use strict';

const { LegalNotice } = require('../models/LegalNotice.model');
const AppError        = require('../../../shared/errors/AppError');
const logger          = require('../../../shared/utils/logger');

// ── Supported template variables ──────────────────────────────────────────────

const SUPPORTED_VARIABLES = [
  '{{customerName}}',
  '{{invoiceNumber}}',
  '{{amount}}',
  '{{dueDate}}',
  '{{companyName}}',
  '{{agentName}}',
];

// ── Render template with context ──────────────────────────────────────────────

const renderTemplate = (template, context = {}) => {
  let rendered = template;
  for (const [key, value] of Object.entries(context)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
  }
  return rendered;
};

// ── Create legal notice template ──────────────────────────────────────────────

const createTemplate = async (userId, data) => {
  const { name, subject, body } = data;

  const existing = await LegalNotice.findOne({ userId, name, isActive: true });
  if (existing) {
    throw new AppError(
      'A legal notice template with this name already exists.',
      409,
      'DUPLICATE_TEMPLATE_NAME'
    );
  }

  // Extract variables used in body
  const usedVariables = SUPPORTED_VARIABLES.filter(
    (v) => body.includes(v) || subject.includes(v)
  );

  const template = await LegalNotice.create({
    userId,
    name,
    subject,
    body,
    variables: usedVariables,
  });

  logger.info(`Legal notice template created: ${template._id} userId=${userId}`);
  return template;
};

// ── List templates ────────────────────────────────────────────────────────────

const listTemplates = async (userId, { page = 1, limit = 20, isActive } = {}) => {
  const filter = { userId };
  if (isActive !== undefined) filter.isActive = isActive === 'true' || isActive === true;

  const skip  = (page - 1) * limit;
  const total = await LegalNotice.countDocuments(filter);

  const templates = await LegalNotice.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return {
    templates,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
};

// ── Get single template ───────────────────────────────────────────────────────

const getTemplate = async (userId, templateId) => {
  const template = await LegalNotice.findOne({ _id: templateId, userId });
  if (!template) {
    throw new AppError('Legal notice template not found.', 404, 'TEMPLATE_NOT_FOUND');
  }
  return template;
};

// ── Update template ───────────────────────────────────────────────────────────

const updateTemplate = async (userId, templateId, data) => {
  const template = await LegalNotice.findOne({ _id: templateId, userId });
  if (!template) {
    throw new AppError('Legal notice template not found.', 404, 'TEMPLATE_NOT_FOUND');
  }

  const { name, subject, body, isActive } = data;

  if (name !== undefined)     template.name     = name;
  if (subject !== undefined)  template.subject  = subject;
  if (body !== undefined)     template.body     = body;
  if (isActive !== undefined) template.isActive = isActive;

  if (body || subject) {
    const checkBody    = body    || template.body;
    const checkSubject = subject || template.subject;
    template.variables = SUPPORTED_VARIABLES.filter(
      (v) => checkBody.includes(v) || checkSubject.includes(v)
    );
  }

  await template.save();
  logger.info(`Legal notice template updated: ${templateId}`);
  return template;
};

// ── Delete template ───────────────────────────────────────────────────────────

const deleteTemplate = async (userId, templateId) => {
  const template = await LegalNotice.findOne({ _id: templateId, userId });
  if (!template) {
    throw new AppError('Legal notice template not found.', 404, 'TEMPLATE_NOT_FOUND');
  }
  await template.deleteOne();
  logger.info(`Legal notice template deleted: ${templateId}`);
  return { deleted: true };
};

// ── Preview template with context ─────────────────────────────────────────────

const previewTemplate = async (userId, templateId, context = {}) => {
  const template = await getTemplate(userId, templateId);
  return {
    subject:  renderTemplate(template.subject, context),
    body:     renderTemplate(template.body,    context),
    template: template._id,
  };
};

module.exports = {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  renderTemplate,
  SUPPORTED_VARIABLES,
};