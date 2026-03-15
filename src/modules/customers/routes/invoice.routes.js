'use strict';

const express    = require('express');
const router     = express.Router();

const invoiceController = require('../controllers/invoice.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateCreateInvoice,
  validateUpdateInvoice,
  validateRecordPayment,
} = require('../validators/invoice.validator');

const { createUploadMiddleware } = require('../../../shared/utils/s3.util');
const upload = createUploadMiddleware();

router.use(protect);

router.get('/overdue', invoiceController.getOverdueInvoices);

router.route('/')
  .get(invoiceController.getInvoices)
  .post(validateCreateInvoice, invoiceController.createInvoice);

router.post('/:id/payment',
  validateRecordPayment,
  invoiceController.recordPayment
);

router.post('/:id/attachments',
  restrictTo('owner', 'admin', 'agent'),
  upload.single('file'),
  invoiceController.uploadAttachment
);

router.get('/:id/attachments/:index/download',
  invoiceController.getAttachmentDownloadUrl
);

router.delete('/:id/attachments/:index',
  restrictTo('owner', 'admin'),
  invoiceController.removeAttachment
);

router.route('/:id')
  .get(invoiceController.getInvoiceById)
  .patch(validateUpdateInvoice, invoiceController.updateInvoice)
  .delete(restrictTo('owner', 'admin'), invoiceController.deleteInvoice);

module.exports = router;
