'use strict';

const express    = require('express');
const router     = express.Router();

const customerController = require('../controllers/customer.controller');
const { protect, restrictTo } = require('../../../shared/middlewares/auth.middleware');
const {
  validateCreateCustomer,
  validateUpdateCustomer,
} = require('../validators/customer.validator');

// All customer routes require authentication
router.use(protect);

/**
 * GET  /api/v1/customers       — list customers with search & filters
 * POST /api/v1/customers       — create new customer
 */
router.route('/')
  .get(customerController.getCustomers)
  .post(validateCreateCustomer, customerController.createCustomer);

/**
 * GET /api/v1/customers/:id/summary — invoice summary for a customer
 * Must be defined before /:id to avoid being swallowed by dynamic segment
 */
router.get('/:id/summary', customerController.getCustomerSummary);

/**
 * GET    /api/v1/customers/:id — get single customer
 * PATCH  /api/v1/customers/:id — update customer
 * DELETE /api/v1/customers/:id — delete customer (owner/admin only)
 */
router.route('/:id')
  .get(customerController.getCustomerById)
  .patch(validateUpdateCustomer, customerController.updateCustomer)
  .delete(restrictTo('owner', 'admin'), customerController.deleteCustomer);

module.exports = router;