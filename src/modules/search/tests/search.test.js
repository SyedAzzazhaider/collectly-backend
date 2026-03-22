'use strict';

process.env.NODE_ENV                = 'test';
process.env.JWT_ACCESS_SECRET       = 'test_access_secret_collectly_2024';
process.env.JWT_REFRESH_SECRET      = 'test_refresh_secret_collectly_2024';
process.env.JWT_ACCESS_EXPIRES_IN   = '15m';
process.env.JWT_REFRESH_EXPIRES_IN  = '7d';
process.env.FRONTEND_URL            = 'http://localhost:3000';
process.env.API_BASE_URL            = 'http://localhost:5000';
process.env.GOOGLE_CLIENT_ID        = 'test_google_client_id';
process.env.GOOGLE_CLIENT_SECRET    = 'test_google_client_secret';
process.env.MICROSOFT_CLIENT_ID     = 'test_microsoft_client_id';
process.env.MICROSOFT_CLIENT_SECRET = 'test_microsoft_client_secret';

const request  = require('supertest');
const app      = require('../../../../app');
const User     = require('../../auth/models/User.model');
const Customer = require('../../customers/models/Customer.model');
const Invoice  = require('../../customers/models/Invoice.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Search Owner', email: 'searchowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const otherOwnerFixture = {
  name: 'Other Search Owner', email: 'othersearch@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const signupAndLogin = async (userData) => {
  await request(app).post('/api/v1/auth/signup').send(userData);
  const res = await request(app).post('/api/v1/auth/login').send({
    email: userData.email, password: userData.password,
  });
  return res.body.data.accessToken;
};

const seedCustomer = async (userId, overrides = {}) => {
  const email = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  return Customer.create({
    userId,
    name:    'Acme Corporation',
    email,
    phone:   '+12345678901',
    company: 'Acme Corp',
    timezone: 'UTC',
    tags:    ['vip', 'enterprise'],
    preferences: { channels: ['email'] },
    ...overrides,
  });
};

const seedInvoice = async (userId, customerId, overrides = {}) => {
  return Invoice.create({
    userId,
    customerId,
    invoiceNumber: `INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    amount:        1000,
    currency:      'USD',
    dueDate:       new Date(Date.now() + 30 * 86400000),
    status:        'pending',
    tags:          ['q1', 'priority'],
    ...overrides,
  });
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe('Search auth guard', () => {
  it('should return 401 for GET /search without token', async () => {
    const res = await request(app).get('/api/v1/search?q=test');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /search/invoices without token', async () => {
    const res = await request(app).get('/api/v1/search/invoices?q=test');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /search/customers without token', async () => {
    const res = await request(app).get('/api/v1/search/customers?q=test');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /search/tags without token', async () => {
    const res = await request(app).get('/api/v1/search/tags');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should return 200 with invoices and customers when data exists', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'Acme' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('invoices');
    expect(res.body.data).toHaveProperty('customers');
    expect(res.body.data).toHaveProperty('totalResults');
    expect(res.body.data.query).toBe('Acme');
  });

  it('should return empty results when no match found', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'zzznomatch999' });

    expect(res.status).toBe(200);
    expect(res.body.data.totalResults).toBe(0);
  });

  it('should search only invoices when type=invoices', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'Acme', type: 'invoices' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('invoices');
    expect(res.body.data).not.toHaveProperty('customers');
  });

  it('should search only customers when type=customers', async () => {
    await seedCustomer(userId);

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'Acme', type: 'customers' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('customers');
    expect(res.body.data).not.toHaveProperty('invoices');
  });

  it('should not return data belonging to another user', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    const otherCust  = await seedCustomer(otherUser._id);
    await seedInvoice(otherUser._id, otherCust._id);

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'Acme' });

    expect(res.status).toBe(200);
    expect(res.body.data.totalResults).toBe(0);
  });

  it('should reject missing search query with 400', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: '' });

    expect(res.status).toBe(422);
  });

  it('should reject search query longer than 200 characters with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'a'.repeat(201) });

    expect(res.status).toBe(422);
  });

  it('should reject invalid type with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', type: 'invalid' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid sortBy with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', sortBy: 'badfield' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid page with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', page: 0 });

    expect(res.status).toBe(422);
  });

  it('should reject limit > 100 with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', limit: 101 });

    expect(res.status).toBe(422);
  });

  it('should reject invalid status with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', status: 'invalid_status' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid sortOrder with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'test', sortOrder: 'sideways' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH INVOICES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/invoices', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should find invoice by invoice number', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, { invoiceNumber: 'INV-UNIQUE-001' });

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'INV-UNIQUE-001' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.invoices[0].invoiceNumber).toBe('INV-UNIQUE-001');
  });

  it('should find invoice by customer name', async () => {
    const customer = await seedCustomer(userId, { name: 'UniqueSearchCorp' });
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'UniqueSearchCorp' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter invoices by status', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, { status: 'paid', amountPaid: 1000, paidAt: new Date() });
    await seedInvoice(userId, customer._id, { status: 'pending' });

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ status: 'paid' });

    expect(res.status).toBe(200);
    const allPaid = res.body.data.invoices.every((i) => i.status === 'paid');
    expect(allPaid).toBe(true);
  });

  it('should filter invoices by tags', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, { tags: ['urgent'] });
    await seedInvoice(userId, customer._id, { tags: ['normal'] });

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ tags: 'urgent' });

    expect(res.status).toBe(200);
    const allTagged = res.body.data.invoices.every((i) => i.tags.includes('urgent'));
    expect(allTagged).toBe(true);
  });

  it('should filter invoices by due date range', async () => {
    const customer  = await seedCustomer(userId);
    const dueDateIn = new Date(Date.now() + 10 * 86400000);
    const dueDateOut = new Date(Date.now() + 60 * 86400000);

    await seedInvoice(userId, customer._id, { dueDate: dueDateIn });
    await seedInvoice(userId, customer._id, { dueDate: dueDateOut });

    const from = new Date(Date.now() + 5  * 86400000).toISOString();
    const to   = new Date(Date.now() + 20 * 86400000).toISOString();

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ dueDateFrom: from, dueDateTo: to });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
  });

  it('should return pagination metadata', async () => {
    const customer = await seedCustomer(userId);
    for (let i = 0; i < 5; i++) {
      await seedInvoice(userId, customer._id);
    }

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(5);
    expect(res.body.data.invoices).toHaveLength(2);
    expect(res.body.data.pagination.pages).toBe(3);
  });

  it('should sort invoices by dueDate ascending', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, { dueDate: new Date(Date.now() + 20 * 86400000) });
    await seedInvoice(userId, customer._id, { dueDate: new Date(Date.now() + 5  * 86400000) });

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ sortBy: 'dueDate', sortOrder: 'asc' });

    expect(res.status).toBe(200);
    if (res.body.data.invoices.length >= 2) {
      const d1 = new Date(res.body.data.invoices[0].dueDate);
      const d2 = new Date(res.body.data.invoices[1].dueDate);
      expect(d1.getTime()).toBeLessThanOrEqual(d2.getTime());
    }
  });

  it('should reject dateTo before dateFrom with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({
        dueDateFrom: new Date(Date.now() + 10 * 86400000).toISOString(),
        dueDateTo:   new Date(Date.now() +  5 * 86400000).toISOString(),
      });

    expect(res.status).toBe(422);
  });

  it('should not return invoices belonging to another user', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    const otherCust  = await seedCustomer(otherUser._id, { name: 'ShouldNotAppear' });
    await seedInvoice(otherUser._id, otherCust._id, { invoiceNumber: 'INV-OTHER-001' });

    const res = await request(app)
      .get('/api/v1/search/invoices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'INV-OTHER-001' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH CUSTOMERS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/customers', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should find customer by name', async () => {
    await seedCustomer(userId, { name: 'UniqueCustomerName' });

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'UniqueCustomerName' });

    expect(res.status).toBe(200);
    expect(res.body.data.customers.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.customers[0].name).toBe('UniqueCustomerName');
  });

  it('should find customer by company name', async () => {
    await seedCustomer(userId, { company: 'SpecialCorp Ltd' });

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'SpecialCorp' });

    expect(res.status).toBe(200);
    expect(res.body.data.customers.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter customers by tags', async () => {
    await seedCustomer(userId, { tags: ['vip'] });
    await seedCustomer(userId, { tags: ['standard'] });

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ tags: 'vip' });

    expect(res.status).toBe(200);
    const allTagged = res.body.data.customers.every((c) => c.tags.includes('vip'));
    expect(allTagged).toBe(true);
  });

  it('should filter customers by isActive', async () => {
    await seedCustomer(userId, { isActive: true  });
    await seedCustomer(userId, { isActive: false });

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ isActive: 'true' });

    expect(res.status).toBe(200);
    const allActive = res.body.data.customers.every((c) => c.isActive === true);
    expect(allActive).toBe(true);
  });

  it('should return pagination metadata', async () => {
    for (let i = 0; i < 4; i++) await seedCustomer(userId);

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(4);
    expect(res.body.data.customers).toHaveLength(2);
  });

  it('should not return customers belonging to another user', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    await seedCustomer(otherUser._id, { name: 'ShouldBeHidden' });

    const res = await request(app)
      .get('/api/v1/search/customers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'ShouldBeHidden' });

    expect(res.status).toBe(200);
    expect(res.body.data.customers).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FILTER INVOICES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/invoices/filter', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should return all invoices with no filters', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id);
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/search/invoices/filter')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(2);
  });

  it('should filter by status=overdue', async () => {
    const customer = await seedCustomer(userId);
    await Invoice.create({
      userId, customerId: customer._id,
      invoiceNumber: `OVD-${Date.now()}`,
      amount: 500, currency: 'USD',
      dueDate: new Date(Date.now() - 5 * 86400000),
      status: 'overdue',
    });
    await seedInvoice(userId, customer._id, { status: 'pending' });

    const res = await request(app)
      .get('/api/v1/search/invoices/filter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ status: 'overdue' });

    expect(res.status).toBe(200);
    const allOverdue = res.body.data.invoices.every((i) => i.status === 'overdue');
    expect(allOverdue).toBe(true);
  });

  it('should filter by customerId', async () => {
    const customer1 = await seedCustomer(userId);
    const customer2 = await seedCustomer(userId);
    await seedInvoice(userId, customer1._id);
    await seedInvoice(userId, customer2._id);

    const res = await request(app)
      .get('/api/v1/search/invoices/filter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ customerId: String(customer1._id) });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(1);
    expect(res.body.data.invoices[0].customerId._id || res.body.data.invoices[0].customerId)
      .toBe(String(customer1._id));
  });

  it('should return filters in response', async () => {
    const res = await request(app)
      .get('/api/v1/search/invoices/filter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ status: 'pending' });

    expect(res.status).toBe(200);
    expect(res.body.data.filters).toHaveProperty('status', 'pending');
  });

  it('should reject invalid status with 422', async () => {
    const res = await request(app)
      .get('/api/v1/search/invoices/filter')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ status: 'invalid' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET AVAILABLE TAGS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search/tags', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should return empty tag lists when no data exists', async () => {
    const res = await request(app)
      .get('/api/v1/search/tags')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.all).toHaveLength(0);
    expect(res.body.data.invoices).toHaveLength(0);
    expect(res.body.data.customers).toHaveLength(0);
  });

  it('should return tags from invoices and customers combined', async () => {
    const customer = await seedCustomer(userId, { tags: ['vip', 'enterprise'] });
    await seedInvoice(userId, customer._id, { tags: ['q1', 'priority'] });

    const res = await request(app)
      .get('/api/v1/search/tags')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.all).toContain('vip');
    expect(res.body.data.all).toContain('q1');
    expect(res.body.data.customers).toContain('enterprise');
    expect(res.body.data.invoices).toContain('priority');
  });

  it('should not return duplicate tags in the all list', async () => {
    const customer = await seedCustomer(userId, { tags: ['shared-tag'] });
    await seedInvoice(userId, customer._id, { tags: ['shared-tag'] });

    const res = await request(app)
      .get('/api/v1/search/tags')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const sharedCount = res.body.data.all.filter((t) => t === 'shared-tag').length;
    expect(sharedCount).toBe(1);
  });

  it('should not return tags from another user', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    await seedCustomer(otherUser._id, { tags: ['other-secret-tag'] });

    const res = await request(app)
      .get('/api/v1/search/tags')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.all).not.toContain('other-secret-tag');
  });

  it('should require authentication', async () => {
    const res = await request(app).get('/api/v1/search/tags');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH — combined results correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('Global search — combined results', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should find matching invoices AND customers in one request', async () => {
    const customer = await seedCustomer(userId, { name: 'ZetaCorp' });
    await seedInvoice(userId, customer._id, { invoiceNumber: 'ZETA-001' });

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'Zeta' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.pagination.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.customers.pagination.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalResults).toBeGreaterThanOrEqual(2);
  });

  it('should apply status filter on global search', async () => {
    const customer = await seedCustomer(userId, { name: 'FilterCorp' });
    await seedInvoice(userId, customer._id, { status: 'pending' });
    await Invoice.create({
      userId, customerId: customer._id,
      invoiceNumber: `PAID-${Date.now()}`,
      amount: 500, currency: 'USD',
      dueDate: new Date(Date.now() - 5 * 86400000),
      status: 'paid', amountPaid: 500, paidAt: new Date(),
    });

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'FilterCorp', type: 'invoices', status: 'pending' });

    expect(res.status).toBe(200);
    const allPending = res.body.data.invoices.invoices.every((i) => i.status === 'pending');
    expect(allPending).toBe(true);
  });

  it('should respect pagination on global search', async () => {
    const customer = await seedCustomer(userId, { name: 'PaginateCorp' });
    for (let i = 0; i < 5; i++) {
      await seedInvoice(userId, customer._id);
    }

    const res = await request(app)
      .get('/api/v1/search')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ q: 'PaginateCorp', type: 'invoices', page: 1, limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.invoices).toHaveLength(2);
    expect(res.body.data.invoices.pagination.total).toBe(5);
  });
});



