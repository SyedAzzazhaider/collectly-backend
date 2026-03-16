'use strict';

const express = require('express');
const router  = express.Router();

const searchController                             = require('../controllers/search.controller');
const { protect }                                  = require('../../../shared/middlewares/auth.middleware');
const { validateSearch, validateInvoiceFilters }   = require('../validators/search.validator');

// All search routes require authentication
router.use(protect);

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search?q=&type=&status=&tags=&dueDateFrom=&dueDateTo=&sortBy=&sortOrder=&page=&limit=
 * Unified search across invoices and customers
 * Spec: Search by invoice number, customer name, due date range, status, tags
 */
router.get(
  '/',
  validateSearch,
  searchController.globalSearch
);

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY-SPECIFIC SEARCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search/invoices?q=&status=&tags=&dueDateFrom=&dueDateTo=
 * Search invoices by number, customer name, due date range, status, tags
 * Spec: All Module H search criteria applied to invoices
 */
router.get(
  '/invoices',
  validateSearch,
  searchController.searchInvoices
);

/**
 * GET /api/v1/search/customers?q=&tags=&isActive=
 * Search customers by name, email, company, phone, tags
 */
router.get(
  '/customers',
  validateSearch,
  searchController.searchCustomers
);

// ─────────────────────────────────────────────────────────────────────────────
// FILTER — no text query required
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search/invoices/filter?status=&tags=&dueDateFrom=&dueDateTo=&customerId=
 * Filter invoices without a text query — by status, tags, date range
 * Spec: Filter by due date range, status, tags
 */
router.get(
  '/invoices/filter',
  validateInvoiceFilters,
  searchController.filterInvoices
);

// ─────────────────────────────────────────────────────────────────────────────
// TAGS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/search/tags
 * Get all available tags across invoices and customers for the authenticated user
 */
router.get(
  '/tags',
  searchController.getAvailableTags
);

module.exports = router;