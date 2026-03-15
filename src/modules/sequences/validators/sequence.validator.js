'use strict';

const AppError = require('../../../shared/errors/AppError');
const { VALID_CHANNELS, VALID_PHASE_TYPES, VALID_REMINDER_TYPES } = require('../models/Sequence.model');

// ── Helpers ───────────────────────────────────────────────────────────────────

const validationError = (message, fields = {}) => {
  const err  = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

const sanitize = (v) => (typeof v === 'string' ? v.trim() : v);

// ── Validate message template ─────────────────────────────────────────────────

const validateMessageTemplate = (template, index) => {
  const errors = {};

  if (!template.channel || !VALID_CHANNELS.includes(template.channel)) {
    errors[`messageTemplates[${index}].channel`] =
      `Channel must be one of: ${VALID_CHANNELS.join(', ')}`;
  }

  if (!template.body || sanitize(String(template.body)).length === 0) {
    errors[`messageTemplates[${index}].body`] = 'Message body is required';
  } else if (String(template.body).length > 5000) {
    errors[`messageTemplates[${index}].body`] = 'Message body must be at most 5000 characters';
  }

  if (template.subject && String(template.subject).length > 300) {
    errors[`messageTemplates[${index}].subject`] = 'Subject must be at most 300 characters';
  }

  return errors;
};

// ── Validate trigger rule ─────────────────────────────────────────────────────

const validateTriggerRule = (rule, phaseIndex) => {
  const errors = {};

  if (rule === undefined || rule === null || typeof rule !== 'object') {
    errors[`phases[${phaseIndex}].triggerRule`] = 'Trigger rule is required';
    return errors;
  }

  if (rule.daysOffset === undefined || rule.daysOffset === null) {
    errors[`phases[${phaseIndex}].triggerRule.daysOffset`] = 'Days offset is required';
  } else {
    const n = Number(rule.daysOffset);
    if (isNaN(n) || n < -365 || n > 365) {
      errors[`phases[${phaseIndex}].triggerRule.daysOffset`] =
        'Days offset must be a number between -365 and 365';
    }
  }

  if (rule.minAmount !== undefined && rule.minAmount !== null) {
    if (Number(rule.minAmount) < 0) {
      errors[`phases[${phaseIndex}].triggerRule.minAmount`] =
        'Minimum amount cannot be negative';
    }
  }

  if (rule.maxAmount !== undefined && rule.maxAmount !== null) {
    if (Number(rule.maxAmount) < 0) {
      errors[`phases[${phaseIndex}].triggerRule.maxAmount`] =
        'Maximum amount cannot be negative';
    }
    if (
      rule.minAmount !== undefined &&
      rule.minAmount !== null &&
      Number(rule.maxAmount) < Number(rule.minAmount)
    ) {
      errors[`phases[${phaseIndex}].triggerRule.maxAmount`] =
        'Maximum amount cannot be less than minimum amount';
    }
  }

  if (rule.repeatEveryDays !== undefined && rule.repeatEveryDays !== null) {
    const n = Number(rule.repeatEveryDays);
    if (isNaN(n) || n < 1 || n > 30) {
      errors[`phases[${phaseIndex}].triggerRule.repeatEveryDays`] =
        'Repeat interval must be between 1 and 30 days';
    }
  }

  if (rule.maxRepeats !== undefined && rule.maxRepeats !== null) {
    const n = Number(rule.maxRepeats);
    if (isNaN(n) || n < 1 || n > 20) {
      errors[`phases[${phaseIndex}].triggerRule.maxRepeats`] =
        'Max repeats must be between 1 and 20';
    }
  }

  return errors;
};

// ── Validate single phase ─────────────────────────────────────────────────────

const validatePhase = (phase, index) => {
  let errors = {};

  if (!phase.phaseType || !VALID_PHASE_TYPES.includes(phase.phaseType)) {
    errors[`phases[${index}].phaseType`] =
      `Phase type must be one of: ${VALID_PHASE_TYPES.join(', ')}`;
  }

  if (phase.phaseNumber === undefined || phase.phaseNumber === null) {
    errors[`phases[${index}].phaseNumber`] = 'Phase number is required';
  } else {
    const n = Number(phase.phaseNumber);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      errors[`phases[${index}].phaseNumber`] = 'Phase number must be an integer between 1 and 5';
    }
  }

  if (!phase.reminderType || !VALID_REMINDER_TYPES.includes(phase.reminderType)) {
    errors[`phases[${index}].reminderType`] =
      `Reminder type must be one of: ${VALID_REMINDER_TYPES.join(', ')}`;
  }

  if (!phase.channels || !Array.isArray(phase.channels)) {
    errors[`phases[${index}].channels`] = 'Channels must be an array';
  } else if (phase.channels.length === 0) {
    errors[`phases[${index}].channels`] = 'At least one channel is required per phase';
  } else {
    const invalid = phase.channels.filter((c) => !VALID_CHANNELS.includes(c));
    if (invalid.length > 0) {
      errors[`phases[${index}].channels`] =
        `Invalid channels: ${invalid.join(', ')}. Valid: ${VALID_CHANNELS.join(', ')}`;
    }
  }

  // Validate message templates
  if (phase.messageTemplates && Array.isArray(phase.messageTemplates)) {
    if (phase.messageTemplates.length > 4) {
      errors[`phases[${index}].messageTemplates`] = 'Maximum 4 message templates per phase';
    } else {
      phase.messageTemplates.forEach((template, tIdx) => {
        const templateErrors = validateMessageTemplate(template, tIdx);
        Object.assign(errors, templateErrors);
      });
    }
  }

  // Validate trigger rule
  const triggerErrors = validateTriggerRule(phase.triggerRule, index);
  Object.assign(errors, triggerErrors);

  return errors;
};

// ── validateCreateSequence ────────────────────────────────────────────────────

const validateCreateSequence = (req, res, next) => {
  try {
    const { name, description, phases, isDefault } = req.body;
    let errors = {};

    // Name
    if (!name || sanitize(String(name)).length < 2) {
      errors.name = 'Sequence name is required and must be at least 2 characters';
    } else if (String(name).length > 150) {
      errors.name = 'Sequence name must be at most 150 characters';
    }

    // Description
    if (description !== undefined && String(description).length > 500) {
      errors.description = 'Description must be at most 500 characters';
    }

    // isDefault
    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      errors.isDefault = 'isDefault must be a boolean';
    }

    // Phases — required and must be array
    if (!phases || !Array.isArray(phases)) {
      errors.phases = 'Phases must be an array';
    } else if (phases.length === 0) {
      errors.phases = 'At least one phase is required';
    } else if (phases.length > 5) {
      errors.phases = 'A sequence can have at most 5 phases';
    } else {
      // Validate each phase
      phases.forEach((phase, idx) => {
        const phaseErrors = validatePhase(phase, idx);
        Object.assign(errors, phaseErrors);
      });

      // Check for duplicate phase numbers
      const phaseNumbers = phases.map((p) => p.phaseNumber);
      const unique       = new Set(phaseNumbers);
      if (unique.size !== phaseNumbers.length) {
        errors.phases = 'Each phase must have a unique phase number';
      }

      // Check for duplicate phase types
      const phaseTypes = phases.map((p) => p.phaseType);
      const uniqueTypes = new Set(phaseTypes);
      if (uniqueTypes.size !== phaseTypes.length) {
        errors.phases = 'Each phase type can only appear once in a sequence';
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Sequence validation failed', errors));
    }

    req.body.name = sanitize(String(name));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateUpdateSequence ────────────────────────────────────────────────────

const validateUpdateSequence = (req, res, next) => {
  try {
    const { name, description, phases, isActive, isDefault } = req.body;
    let errors = {};

    if (name !== undefined) {
      if (sanitize(String(name)).length < 2) {
        errors.name = 'Name must be at least 2 characters';
      } else if (String(name).length > 150) {
        errors.name = 'Name must be at most 150 characters';
      }
    }

    if (description !== undefined && String(description).length > 500) {
      errors.description = 'Description must be at most 500 characters';
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      errors.isActive = 'isActive must be a boolean';
    }

    if (isDefault !== undefined && typeof isDefault !== 'boolean') {
      errors.isDefault = 'isDefault must be a boolean';
    }

    if (phases !== undefined) {
      if (!Array.isArray(phases)) {
        errors.phases = 'Phases must be an array';
      } else if (phases.length === 0) {
        errors.phases = 'At least one phase is required';
      } else if (phases.length > 5) {
        errors.phases = 'A sequence can have at most 5 phases';
      } else {
        phases.forEach((phase, idx) => {
          const phaseErrors = validatePhase(phase, idx);
          Object.assign(errors, phaseErrors);
        });

        const phaseNumbers = phases.map((p) => p.phaseNumber);
        if (new Set(phaseNumbers).size !== phaseNumbers.length) {
          errors.phases = 'Each phase must have a unique phase number';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Sequence update validation failed', errors));
    }

    if (name) req.body.name = sanitize(String(name));
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── validateAssignSequence ────────────────────────────────────────────────────

const validateAssignSequence = (req, res, next) => {
  try {
    const { sequenceId, invoiceId } = req.body;
    const errors = {};

    if (!sequenceId) {
      errors.sequenceId = 'Sequence ID is required';
    } else if (!/^[a-f\d]{24}$/i.test(String(sequenceId))) {
      errors.sequenceId = 'Sequence ID must be a valid ID';
    }

    if (!invoiceId) {
      errors.invoiceId = 'Invoice ID is required';
    } else if (!/^[a-f\d]{24}$/i.test(String(invoiceId))) {
      errors.invoiceId = 'Invoice ID must be a valid ID';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Assignment validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateCreateSequence,
  validateUpdateSequence,
  validateAssignSequence,
};