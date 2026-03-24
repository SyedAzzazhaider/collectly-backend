'use strict';

const express              = require('express');
const router               = express.Router();
const legalNoticeController = require('../controllers/legalNotice.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');

router.use(protect);

/**
 * GET /api/v1/sequences/legal-notices/variables
 * Get supported template variables
 */
router.get('/variables', legalNoticeController.getSupportedVariables);

/**
 * GET  /api/v1/sequences/legal-notices
 * POST /api/v1/sequences/legal-notices
 */
router.route('/')
  .get(legalNoticeController.listTemplates)
  .post(
    restrictTo('owner', 'admin', 'agent'),
    legalNoticeController.createTemplate
  );

/**
 * GET    /api/v1/sequences/legal-notices/:id
 * PATCH  /api/v1/sequences/legal-notices/:id
 * DELETE /api/v1/sequences/legal-notices/:id
 */
router.route('/:id')
  .get(legalNoticeController.getTemplate)
  .patch(restrictTo('owner', 'admin', 'agent'), legalNoticeController.updateTemplate)
  .delete(restrictTo('owner', 'admin'),         legalNoticeController.deleteTemplate);

/**
 * POST /api/v1/sequences/legal-notices/:id/preview
 */
router.post(
  '/:id/preview',
  restrictTo('owner', 'admin', 'agent'),
  legalNoticeController.previewTemplate
);
router.post(
  '/:id/send',
  restrictTo('owner', 'admin', 'agent'),
  legalNoticeController.sendLegalNotice
);
module.exports = router;

