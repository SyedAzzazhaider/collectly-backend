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

const request    = require('supertest');
const app        = require('../../../../app');
const User       = require('../../auth/models/User.model');
const Customer   = require('../../customers/models/Customer.model');
const Invoice    = require('../../customers/models/Invoice.model');
const { Alert }  = require('../models/Alert.model');
const { Billing } = require('../../billing/models/Billing.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Alert Owner', email: 'alertowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Alert Agent', email: 'alertagent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const adminFixture = {
  name: 'Alert Admin', email: 'alertadmin@test.dev',
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

const makeRole = async (email, role) => {
  await User.findOneAndUpdate({ email }, { role });
};

const seedAlert = async (userId, overrides = {}) => {
  return Alert.create({
    userId,
    type:    'payment_received',
    title:   'Test Alert',
    message: 'Test alert message',
    ...overrides,
  });
};

const seedCustomer = async (userId) => {
  const email = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  return Customer.create({
    userId,
    name:    'Test Customer',
    email,
    phone:   '+12345678901',
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

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe('Alert auth guard', () => {
  it('should return 401 for GET /alerts without token', async () => {
    const res = await request(app).get('/api/v1/alerts');
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /alerts/unread-count without token', async () => {
    const res = await request(app).get('/api/v1/alerts/unread-count');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /alerts
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/alerts', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return 200 with empty alerts list when none exist', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.alerts).toHaveLength(0);
    expect(res.body.data.pagination).toHaveProperty('total', 0);
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('should return alerts for the authenticated user', async () => {
    await seedAlert(userId);
    await seedAlert(userId);

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(2);
  });

  it('should not return alerts belonging to another user', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    await seedAlert(otherUser._id);

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(0);
  });

  it('should filter alerts by type', async () => {
    await seedAlert(userId, { type: 'payment_received' });
    await seedAlert(userId, { type: 'customer_reply' });

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ type: 'payment_received' });

    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(1);
    expect(res.body.data.alerts[0].type).toBe('payment_received');
  });

  it('should filter alerts by isRead=false', async () => {
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: true, readAt: new Date() });

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ isRead: 'false' });

    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(1);
    expect(res.body.data.alerts[0].isRead).toBe(false);
  });

  it('should filter alerts by isRead=true', async () => {
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: true, readAt: new Date() });

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ isRead: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.data.alerts).toHaveLength(1);
    expect(res.body.data.alerts[0].isRead).toBe(true);
  });

  it('should return unreadCount in response', async () => {
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: true, readAt: new Date() });

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('should reject invalid type with 422', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ type: 'invalid_type' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid isRead value with 422', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ isRead: 'maybe' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid page with 422', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ page: 0 });

    expect(res.status).toBe(422);
  });

  it('should reject limit > 100 with 422', async () => {
    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ limit: 101 });

    expect(res.status).toBe(422);
  });

  it('should return pagination metadata', async () => {
    for (let i = 0; i < 3; i++) await seedAlert(userId);

    const res = await request(app)
      .get('/api/v1/alerts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(3);
    expect(res.body.data.pagination.pages).toBe(2);
    expect(res.body.data.alerts).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /alerts/unread-count
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/alerts/unread-count', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return 0 when no alerts exist', async () => {
    const res = await request(app)
      .get('/api/v1/alerts/unread-count')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(0);
  });

  it('should return correct unread count', async () => {
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: true, readAt: new Date() });

    const res = await request(app)
      .get('/api/v1/alerts/unread-count')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('should only count unread alerts for authenticated user', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    await seedAlert(otherUser._id, { isRead: false });
    await seedAlert(otherUser._id, { isRead: false });

    const res = await request(app)
      .get('/api/v1/alerts/unread-count')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /alerts/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/alerts/:id', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should return a single alert by ID', async () => {
    const alert = await seedAlert(userId, { title: 'Specific Alert' });

    const res = await request(app)
      .get(`/api/v1/alerts/${alert._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alert.title).toBe('Specific Alert');
  });

  it('should return 404 for non-existent alert', async () => {
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .get(`/api/v1/alerts/${fakeId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ALERT_NOT_FOUND');
  });

  it('should return 404 when trying to access another user alert', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const alert      = await seedAlert(otherUser._id);

    const res = await request(app)
      .get(`/api/v1/alerts/${alert._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /alerts/:id/read
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/alerts/:id/read', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should mark an alert as read', async () => {
    const alert = await seedAlert(userId, { isRead: false });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert._id}/read`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alert.isRead).toBe(true);
    expect(res.body.data.alert.readAt).not.toBeNull();
  });

  it('should be idempotent — marking already-read alert as read returns 200', async () => {
    const alert = await seedAlert(userId, { isRead: true, readAt: new Date() });

    const res = await request(app)
      .post(`/api/v1/alerts/${alert._id}/read`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.alert.isRead).toBe(true);
  });

  it('should return 404 for another user alert', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const alert      = await seedAlert(otherUser._id);

    const res = await request(app)
      .post(`/api/v1/alerts/${alert._id}/read`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /alerts/read-all
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/alerts/read-all', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should mark all unread alerts as read', async () => {
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: false });
    await seedAlert(userId, { isRead: false });

    const res = await request(app)
      .post('/api/v1/alerts/read-all')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(3);

    const unread = await Alert.countDocuments({ userId, isRead: false });
    expect(unread).toBe(0);
  });

  it('should return updated=0 when no unread alerts exist', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/read-all')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBe(0);
  });

  it('should not affect another user alerts', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    await seedAlert(otherUser._id, { isRead: false });
    await seedAlert(otherUser._id, { isRead: false });

    await request(app)
      .post('/api/v1/alerts/read-all')
      .set('Authorization', `Bearer ${ownerToken}`);

    const otherUnread = await Alert.countDocuments({
      userId: otherUser._id,
      isRead: false,
    });
    expect(otherUnread).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /alerts/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/alerts/:id', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should delete an alert', async () => {
    const alert = await seedAlert(userId);

    const res = await request(app)
      .delete(`/api/v1/alerts/${alert._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const stillExists = await Alert.findById(alert._id);
    expect(stillExists).toBeNull();
  });

  it('should return 404 for non-existent alert', async () => {
    const fakeId = '507f1f77bcf86cd799439011';
    const res = await request(app)
      .delete(`/api/v1/alerts/${fakeId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });

  it('should not allow deleting another user alert', async () => {
    const otherToken = await signupAndLogin(agentFixture);
    const otherUser  = await User.findOne({ email: agentFixture.email });
    const alert      = await seedAlert(otherUser._id);

    const res = await request(app)
      .delete(`/api/v1/alerts/${alert._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);

    const stillExists = await Alert.findById(alert._id);
    expect(stillExists).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /alerts/check-subscriptions (admin only)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/alerts/check-subscriptions', () => {
  let adminToken;
  let ownerToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);

    await signupAndLogin(adminFixture);
    await makeRole(adminFixture.email, 'admin');
    adminToken = (await request(app).post('/api/v1/auth/login').send({
      email: adminFixture.email, password: adminFixture.password,
    })).body.data.accessToken;
  });

  it('should return 200 for admin', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/check-subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('checked');
    expect(res.body.data).toHaveProperty('created');
  });

  it('should return 403 for non-admin', async () => {
    const res = await request(app)
      .post('/api/v1/alerts/check-subscriptions')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
  });

  it('should create subscription_expiring alert for billing renewing within 7 days', async () => {
    const user = await User.findOne({ email: ownerFixture.email });

    await Billing.create({
      userId:      user._id,
      plan:        'pro',
      status:      'active',
      amount:      79,
      currency:    'usd',
      renewalDate: new Date(Date.now() + 2 * 86400000), // 2 days from now — triggers critical
      usage: {
        creditsUsed: 0, emailsSent: 0,
        smsSent: 0, whatsappSent: 0,
        periodStart: new Date(), periodEnd: new Date(),
      },
    });

    await request(app)
      .post('/api/v1/alerts/check-subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    const alert = await Alert.findOne({
      userId: user._id,
      type:   'subscription_expiring',
    });

    expect(alert).not.toBeNull();
    expect(alert.severity).toBe('critical'); // <= 2 days → critical, 3 days → warning
    expect(alert.metadata.plan).toBe('pro');
  });

  it('should not create duplicate subscription expiry alerts on same day', async () => {
    const user = await User.findOne({ email: ownerFixture.email });

    await Billing.create({
      userId:      user._id,
      plan:        'starter',
      status:      'active',
      amount:      29,
      currency:    'usd',
      renewalDate: new Date(Date.now() + 2 * 86400000),
      usage: {
        creditsUsed: 0, emailsSent: 0,
        smsSent: 0, whatsappSent: 0,
        periodStart: new Date(), periodEnd: new Date(),
      },
    });

    // Run twice
    await request(app)
      .post('/api/v1/alerts/check-subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    await request(app)
      .post('/api/v1/alerts/check-subscriptions')
      .set('Authorization', `Bearer ${adminToken}`);

    const count = await Alert.countDocuments({
      userId: user._id,
      type:   'subscription_expiring',
    });

    expect(count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT SERVICE — trigger helpers (integration via invoice payment)
// ─────────────────────────────────────────────────────────────────────────────

describe('Alert trigger — payment_received via POST /invoices/:id/payment', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should create a payment_received alert when payment is recorded via API', async () => {
    const customer = await seedCustomer(userId);
    const invoice  = await seedInvoice(userId, customer._id);

    await request(app)
      .post(`/api/v1/invoices/${invoice._id}/payment`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ amount: 500 });

    // Allow fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 100));

    const alert = await Alert.findOne({ userId, type: 'payment_received' });
    expect(alert).not.toBeNull();
    expect(alert.invoiceId.toString()).toBe(invoice._id.toString());
    expect(alert.metadata.amountPaid).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT TRIGGER — customer_reply via POST /conversations/messages/inbound
// ─────────────────────────────────────────────────────────────────────────────

describe('Alert trigger — customer_reply via POST /conversations/messages/inbound', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  it('should create a customer_reply alert when inbound message is recorded', async () => {
    const customer = await seedCustomer(userId);

    await request(app)
      .post('/api/v1/conversations/messages/inbound')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        customerId: customer._id,
        channel:    'email',
        body:       'Hello, when can I pay?',
      });

    await new Promise((r) => setTimeout(r, 100));

    const alert = await Alert.findOne({ userId, type: 'customer_reply' });
    expect(alert).not.toBeNull();
    expect(alert.customerId.toString()).toBe(customer._id.toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALERT MODEL — all valid types accepted
// ─────────────────────────────────────────────────────────────────────────────

describe('Alert model — all valid types', () => {
  let userId;

  beforeEach(async () => {
    await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId = user._id;
  });

  const validTypes = [
    'reminder_sent',
    'payment_received',
    'customer_reply',
    'escalation_triggered',
    'subscription_expiring',
  ];

  validTypes.forEach((type) => {
    it(`should accept alert type: ${type}`, async () => {
      const alert = await Alert.create({
        userId,
        type,
        title:   `Test ${type}`,
        message: `Test message for ${type}`,
      });
      expect(alert.type).toBe(type);
      expect(alert.isRead).toBe(false);
      expect(alert.emailSent).toBe(false);
    });
  });

  it('should reject invalid alert type', async () => {
    await expect(
      Alert.create({
        userId,
        type:    'invalid_type',
        title:   'Bad Alert',
        message: 'Should fail',
      })
    ).rejects.toThrow();
  });
});
