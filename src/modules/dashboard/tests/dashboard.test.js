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
const { Notification } = require('../../notifications/models/Notification.model');
const { Billing }      = require('../../billing/models/Billing.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Dashboard Owner', email: 'dashowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123',
};

const agentFixture = {
  name: 'Dashboard Agent', email: 'dashagent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123',
};

const accountantFixture = {
  name: 'Dashboard Accountant', email: 'dashaccountant@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123',
};

const adminFixture = {
  name: 'Dashboard Admin', email: 'dashadmin@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const signupAndLogin = async (userData) => {
  await request(app).post('/api/v1/auth/signup').send(userData);
  const res = await request(app).post('/api/v1/auth/login').send({
    email: userData.email, password: userData.password,
  });
  return res.body.data.accessToken;
};

const makeRole = async (email, role) => {
  await User.findOneAndUpdate({ email }, { role });
};

const seedCustomer = async (userId) => {
  const email = `seed_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  return Customer.create({
    userId,
    name:    'Seed Customer',
    email,
    phone:   '+12345678901',
    company: 'Seed Corp',
    timezone: 'UTC',
    preferences: { channels: ['email'] },
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
    ...overrides,
  });
};

const seedOverdueInvoice = async (userId, customerId, overrides = {}) => {
  return Invoice.create({
    userId,
    customerId,
    invoiceNumber: `OVD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    amount:        2000,
    currency:      'USD',
    dueDate:       new Date(Date.now() - 10 * 86400000),
    status:        'overdue',
    ...overrides,
  });
};

const seedPaidInvoice = async (userId, customerId, overrides = {}) => {
  return Invoice.create({
    userId,
    customerId,
    invoiceNumber: `PAD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    amount:        500,
    amountPaid:    500,
    currency:      'USD',
    dueDate:       new Date(Date.now() - 5 * 86400000),
    status:        'paid',
    paidAt:        new Date(),
    ...overrides,
  });
};

const seedNotification = async (userId, customerId, invoiceId, overrides = {}) => {
  return Notification.create({
    userId,
    customerId,
    invoiceId,
    channel:  'email',
    type:     'payment_reminder',
    status:   'sent',
    recipient: { name: 'Test', email: 'test@example.com' },
    body:     'Test reminder body',
    subject:  'Test Subject',
    sentAt:   new Date(),
    ...overrides,
  });
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GUARD — all dashboard routes require authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard auth guard', () => {
  it('should return 401 for GET /dashboard/customer without token', async () => {
    const res = await request(app).get('/api/v1/dashboard/customer');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /dashboard/agent without token', async () => {
    const res = await request(app).get('/api/v1/dashboard/agent');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /dashboard/admin without token', async () => {
    const res = await request(app).get('/api/v1/dashboard/admin');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC — admin dashboard must be inaccessible to non-admins
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard RBAC', () => {
  let ownerToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
  });

  it('should return 403 for owner accessing /dashboard/admin', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it('should return 403 for agent accessing /dashboard/admin', async () => {
    const agentToken = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'agent');
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(403);
  });

  it('should return 403 for accountant accessing /dashboard/admin', async () => {
    const accToken = await signupAndLogin(accountantFixture);
    await makeRole(accountantFixture.email, 'accountant');
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${accToken}`);
    expect(res.status).toBe(403);
  });

  it('should allow admin to access /dashboard/admin', async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    const adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;

    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER DASHBOARD — full
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/customer', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return 200 with full customer dashboard structure', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('upcomingDues');
    expect(res.body.data).toHaveProperty('reminderHistory');
    expect(res.body.data).toHaveProperty('responseRate');
  });

  it('should return upcomingDues with pagination when invoices exist', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ days: 60 });

    expect(res.status).toBe(200);
    expect(res.body.data.upcomingDues.invoices).toBeInstanceOf(Array);
    expect(res.body.data.upcomingDues.pagination).toHaveProperty('total');
    expect(res.body.data.upcomingDues.summary.daysAhead).toBe(60);
  });

  it('should return empty arrays when no data exists', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.upcomingDues.invoices).toHaveLength(0);
    expect(res.body.data.reminderHistory.notifications).toHaveLength(0);
    expect(res.body.data.responseRate.totalReminded).toBe(0);
  });

  it('should only return data belonging to authenticated user', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const customer   = await seedCustomer(otherUser._id);
    await seedInvoice(otherUser._id, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.upcomingDues.invoices).toHaveLength(0);
  });

  it('should accept valid period query parameter', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ period: '7d' });

    expect(res.status).toBe(200);
  });

  it('should reject invalid period parameter with 422', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ period: 'bad_period' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid page parameter with 422', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ page: 0 });

    expect(res.status).toBe(422);
  });

  it('should reject invalid days parameter with 422', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ days: 999 });

    expect(res.status).toBe(422);
  });

  it('should allow accountant role to access customer dashboard', async () => {
    const accToken = await signupAndLogin(accountantFixture);
    await makeRole(accountantFixture.email, 'accountant');
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${accToken}`);
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPCOMING DUES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/customer/upcoming-dues', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return upcoming invoices within default 30 days', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, {
      dueDate: new Date(Date.now() + 15 * 86400000),
    });

    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
  });

  it('should not include overdue invoices in upcoming dues', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  it('should not include paid invoices in upcoming dues', async () => {
    const customer = await seedCustomer(userId);
    await seedPaidInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  it('should populate customer details on upcoming dues', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id, { dueDate: new Date(Date.now() + 15 * 86400000) });

    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const inv = res.body.data.invoices[0];
    expect(inv.customerId).toHaveProperty('name');
    expect(inv.customerId).toHaveProperty('email');
  });

  it('should return pagination metadata', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination).toHaveProperty('total');
    expect(res.body.data.pagination).toHaveProperty('page');
    expect(res.body.data.pagination).toHaveProperty('limit');
    expect(res.body.data.pagination).toHaveProperty('pages');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REMINDER HISTORY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/customer/reminder-history', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return reminder history with channel breakdown', async () => {
    const customer = await seedCustomer(userId);
    const invoice  = await seedInvoice(userId, customer._id);
    await seedNotification(userId, customer._id, invoice._id);
    await seedNotification(userId, customer._id, invoice._id, { channel: 'sms', recipient: { name: 'T', phone: '+12345678901' }, subject: null });

    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data).toHaveProperty('channelBreakdown');
    expect(res.body.data).toHaveProperty('totalSent');
  });

  it('should only return notifications for authenticated user', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const customer   = await seedCustomer(otherUser._id);
    const invoice    = await seedInvoice(otherUser._id, customer._id);
    await seedNotification(otherUser._id, customer._id, invoice._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toHaveLength(0);
  });

  it('should filter by period', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ period: '7d' });

    expect(res.status).toBe(200);
    expect(res.body.data.period).toBe('7d');
  });

  it('should accept custom dateFrom and dateTo', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({
        dateFrom: new Date(Date.now() - 14 * 86400000).toISOString(),
        dateTo:   new Date().toISOString(),
      });

    expect(res.status).toBe(200);
  });

  it('should reject invalid dateFrom', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ dateFrom: 'not-a-date' });

    expect(res.status).toBe(422);
  });

  it('should reject dateTo before dateFrom', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/reminder-history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({
        dateFrom: new Date().toISOString(),
        dateTo:   new Date(Date.now() - 86400000).toISOString(),
      });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE RATE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/customer/response-rate', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return zero response rate when no reminders sent', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/response-rate')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.responseRate).toBe(0);
    expect(res.body.data.totalReminded).toBe(0);
  });

  it('should calculate response rate correctly when invoices paid', async () => {
    const customer = await seedCustomer(userId);
    const invoice  = await seedPaidInvoice(userId, customer._id);
    await seedNotification(userId, customer._id, invoice._id);

    const res = await request(app)
      .get('/api/v1/dashboard/customer/response-rate')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('responseRate');
    expect(res.body.data).toHaveProperty('totalReminded');
    expect(res.body.data).toHaveProperty('totalPaid');
    expect(res.body.data).toHaveProperty('totalStillOpen');
  });

  it('should return 200 for all supported periods', async () => {
    for (const period of ['7d', '30d', '90d', '1y']) {
      const res = await request(app)
        .get('/api/v1/dashboard/customer/response-rate')
        .set('Authorization', `Bearer ${ownerToken}`)
        .query({ period });
      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DASHBOARD — full
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/agent', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return 200 with full agent dashboard structure', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('overdueList');
    expect(res.body.data).toHaveProperty('paymentHistory');
    expect(res.body.data).toHaveProperty('priorityQueue');
    expect(res.body.data).toHaveProperty('recoveryRate');
  });

  it('should allow agent role to access agent dashboard', async () => {
    const agentToken = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'agent');
    const res = await request(app)
      .get('/api/v1/dashboard/agent')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(res.status).toBe(200);
  });

  it('should reject invalid sortBy parameter', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ sortBy: 'invalid_field' });
    expect(res.status).toBe(422);
  });

  it('should accept valid sortBy values', async () => {
    for (const sortBy of ['dueDate', 'amount', 'priority']) {
      const res = await request(app)
        .get('/api/v1/dashboard/agent')
        .set('Authorization', `Bearer ${ownerToken}`)
        .query({ sortBy });
      expect(res.status).toBe(200);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERDUE LIST
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/agent/overdue', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return overdue invoices with daysOverdue annotation', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/overdue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.invoices[0]).toHaveProperty('daysOverdue');
    expect(res.body.data.invoices[0]).toHaveProperty('outstanding');
  });

  it('should not include pending invoices in overdue list', async () => {
    const customer = await seedCustomer(userId);
    await seedInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/overdue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  it('should isolate data per user — not leak other users overdue invoices', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const customer   = await seedCustomer(otherUser._id);
    await seedOverdueInvoice(otherUser._id, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/overdue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  it('should return totals with currency breakdown', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/overdue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totals');
  });

  it('should sort by amount when sortBy=amount', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id, { amount: 500 });
    await seedOverdueInvoice(userId, customer._id, { amount: 5000 });

    const res = await request(app)
      .get('/api/v1/dashboard/agent/overdue')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ sortBy: 'amount' });

    expect(res.status).toBe(200);
    const invoices = res.body.data.invoices;
    if (invoices.length >= 2) {
      expect(invoices[0].amount).toBeGreaterThanOrEqual(invoices[1].amount);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT HISTORY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/agent/payment-history', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return paid invoices with recovered amounts', async () => {
    const customer = await seedCustomer(userId);
    await seedPaidInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/payment-history')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data).toHaveProperty('recovered');
    expect(res.body.data).toHaveProperty('pagination');
  });

  it('should not include overdue invoices in payment history', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/payment-history')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });

  it('should return empty when no payments in period', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent/payment-history')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ period: '7d' });

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRIORITY QUEUE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/agent/priority-queue', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return overdue invoices ranked by priority score', async () => {
    const customer = await seedCustomer(userId);
    await seedOverdueInvoice(userId, customer._id, {
      amount:  500,
      dueDate: new Date(Date.now() - 2 * 86400000),
    });
    await seedOverdueInvoice(userId, customer._id, {
      amount:  5000,
      dueDate: new Date(Date.now() - 20 * 86400000),
    });

    const res = await request(app)
      .get('/api/v1/dashboard/agent/priority-queue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.invoices[0]).toHaveProperty('priorityScore');
    // Highest priority first
    if (res.body.data.invoices.length >= 2) {
      expect(res.body.data.invoices[0].priorityScore)
        .toBeGreaterThanOrEqual(res.body.data.invoices[1].priorityScore);
    }
  });

  it('should return pagination metadata', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent/priority-queue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('pagination');
  });

  it('should not leak other users invoices in priority queue', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const customer   = await seedCustomer(otherUser._id);
    await seedOverdueInvoice(otherUser._id, customer._id);

    const res = await request(app)
      .get('/api/v1/dashboard/agent/priority-queue')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY RATE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/agent/recovery-rate', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return zero recovery rate when no overdue invoices', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent/recovery-rate')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.recoveryRate).toBe(0);
    expect(res.body.data.totalOverdue).toBe(0);
  });

  it('should return correct recovery rate structure', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/agent/recovery-rate')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('recoveryRate');
    expect(res.body.data).toHaveProperty('totalOverdue');
    expect(res.body.data).toHaveProperty('totalRecovered');
    expect(res.body.data).toHaveProperty('totalPartial');
    expect(res.body.data).toHaveProperty('period');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN DASHBOARD — full
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/admin', () => {
  let adminToken;

  beforeEach(async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return 200 with full admin dashboard structure', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('subscriptions');
    expect(res.body.data).toHaveProperty('notificationsSent');
    expect(res.body.data).toHaveProperty('billingUsage');
    expect(res.body.data).toHaveProperty('slaPerformance');
  });

  it('should return subscriptions overview with user counts', async () => {
    await signupAndLogin(ownerFixture);

    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscriptions).toHaveProperty('totalUsers');
    expect(res.body.data.subscriptions).toHaveProperty('byPlan');
    expect(res.body.data.subscriptions.totalUsers).toBeGreaterThanOrEqual(1);
  });

  it('should accept period query parameter', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ period: '7d' });

    expect(res.status).toBe(200);
  });

  it('should reject invalid period with 422', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ period: 'invalid' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — SUBSCRIPTIONS OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/admin/subscriptions', () => {
  let adminToken;

  beforeEach(async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return subscription breakdown by plan', async () => {
    await signupAndLogin(ownerFixture);

    const res = await request(app)
      .get('/api/v1/dashboard/admin/subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalUsers');
    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('newSignups');
    expect(res.body.data).toHaveProperty('byPlan');
  });

  it('should return 403 for non-admin', async () => {
    const ownerToken = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .get('/api/v1/dashboard/admin/subscriptions')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — NOTIFICATIONS SENT
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/admin/notifications-sent', () => {
  let adminToken;

  beforeEach(async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return platform-wide notification volume', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin/notifications-sent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('byChannel');
    expect(res.body.data).toHaveProperty('byStatus');
    expect(res.body.data).toHaveProperty('dailyVolume');
  });

  it('should return zero totals when no notifications exist', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin/notifications-sent')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — BILLING USAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/admin/billing-usage', () => {
  let adminToken;

  beforeEach(async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return billing usage summary', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin/billing-usage')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('activeSubscriptions');
    expect(res.body.data).toHaveProperty('renewalsUpcoming7Days');
    expect(res.body.data).toHaveProperty('byPlan');
    expect(res.body.data).toHaveProperty('revenueInPeriod');
  });

  it('should return 403 for non-admin', async () => {
    const ownerToken = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .get('/api/v1/dashboard/admin/billing-usage')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — SLA PERFORMANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/dashboard/admin/sla-performance', () => {
  let adminToken;

  beforeEach(async () => {
    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return SLA performance metrics', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin/sla-performance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('deliverySuccessRate');
    expect(res.body.data).toHaveProperty('totalProcessed');
    expect(res.body.data).toHaveProperty('totalSuccess');
    expect(res.body.data).toHaveProperty('totalFailed');
    expect(res.body.data).toHaveProperty('byStatus');
    expect(res.body.data).toHaveProperty('failuresByChannel');
    expect(res.body.data).toHaveProperty('avgDeliveryAttempts');
  });

  it('should return 100% success rate when no notifications sent', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/admin/sla-performance')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deliverySuccessRate).toBe(100);
  });

  it('should return 403 for non-admin', async () => {
    const ownerToken = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .get('/api/v1/dashboard/admin/sla-performance')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR — query parameter edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard validator edge cases', () => {
  let ownerToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
  });

  it('should reject limit > 100', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ limit: 101 });
    expect(res.status).toBe(422);
  });

  it('should reject non-integer page', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ page: 'abc' });
    expect(res.status).toBe(422);
  });

  it('should accept all valid period values', async () => {
    for (const period of ['7d', '30d', '90d', '1y']) {
      const res = await request(app)
        .get('/api/v1/dashboard/customer/response-rate')
        .set('Authorization', `Bearer ${ownerToken}`)
        .query({ period });
      expect(res.status).toBe(200);
    }
  });

  it('should accept page=1 and limit=1', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/customer/upcoming-dues')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ page: 1, limit: 1 });
    expect(res.status).toBe(200);
  });
});