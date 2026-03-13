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

// All invoice routes require authentication
router.use(protect);

/**
 * GET /api/v1/invoices/overdue — overdue invoice list
 * Must be defined BEFORE /:id to avoid matching 'overdue' as a param
 */
router.get('/overdue', invoiceController.getOverdueInvoices);

/**
 * GET  /api/v1/invoices — list invoices with filters
 * POST /api/v1/invoices — create invoice
 */
router.route('/')
  .get(invoiceController.getInvoices)
  .post(validateCreateInvoice, invoiceController.createInvoice);

/**
 * GET    /api/v1/invoices/:id — get single invoice
 * PATCH  /api/v1/invoices/:id — update invoice
 * DELETE /api/v1/invoices/:id — delete invoice (owner/admin only)
 */
router.route('/:id')
  .get(invoiceController.getInvoiceById)
  .patch(validateUpdateInvoice, invoiceController.updateInvoice)
  .delete(restrictTo('owner', 'admin'), invoiceController.deleteInvoice);

/**
 * POST /api/v1/invoices/:id/payment — record payment
 */
router.post('/:id/payment', validateRecordPayment, invoiceController.recordPayment);

module.exports = router;