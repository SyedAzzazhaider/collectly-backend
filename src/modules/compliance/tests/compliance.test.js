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
const { ConsentLog }        = require('../models/ConsentLog.model');
const { DncList }           = require('../models/DncList.model');
const { DataExportRequest } = require('../models/DataExportRequest.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Compliance Owner', email: 'compowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Compliance Agent', email: 'compagent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const adminFixture = {
  name: 'Compliance Admin', email: 'compadmin@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const otherOwnerFixture = {
  name: 'Other Owner', email: 'otherowner@test.dev',
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

const seedCustomer = async (userId, overrides = {}) => {
  const email = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;
  return Customer.create({
    userId,
    name:     'Test Customer',
    email,
    phone:    '+12345678901',
    timezone: 'UTC',
    preferences: {
      channels:     ['email', 'sms', 'whatsapp'],
      doNotContact: false,
    },
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

describe('Compliance auth guard', () => {
  it('should return 401 for GET /compliance/dnc without token', async () => {
    const res = await request(app).get('/api/v1/compliance/dnc');
    expect(res.status).toBe(401);
  });

  it('should return 401 for POST /compliance/dnc without token', async () => {
    const res = await request(app).post('/api/v1/compliance/dnc').send({});
    expect(res.status).toBe(401);
  });

  it('should return 401 for GET /compliance/gdpr/exports without token', async () => {
    const res = await request(app).get('/api/v1/compliance/gdpr/exports');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT — GET STATUS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/compliance/customers/:customerId/consent', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should return consent status for a customer', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveProperty('consents');
    expect(res.body.data).toHaveProperty('preferredChannels');
    expect(res.body.data).toHaveProperty('doNotContact');
    expect(res.body.data.consents).toHaveProperty('email_marketing');
    expect(res.body.data.consents).toHaveProperty('sms_marketing');
    expect(res.body.data.consents).toHaveProperty('whatsapp_marketing');
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/customers/507f1f77bcf86cd799439011/consent')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('should not return consent for another user customer', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    const otherCust  = await seedCustomer(otherUser._id);

    const res = await request(app)
      .get(`/api/v1/compliance/customers/${otherCust._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT — UPDATE
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/compliance/customers/:customerId/consent', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should grant SMS consent and add sms to channels', async () => {
    // First remove sms from channels
    await Customer.findByIdAndUpdate(customer._id, {
      'preferences.channels': ['email'],
    });

    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'sms_marketing', granted: true });

    expect(res.status).toBe(200);

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.channels).toContain('sms');
  });

  it('should revoke SMS consent and remove sms from channels', async () => {
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'sms_marketing', granted: false });

    expect(res.status).toBe(200);

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.channels).not.toContain('sms');
  });

  it('should revoke data_processing consent and set doNotContact=true', async () => {
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'data_processing', granted: false });

    expect(res.status).toBe(200);

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.doNotContact).toBe(true);
  });

  it('should create a consent log entry for audit trail', async () => {
    await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'whatsapp_marketing', granted: false });

    const log = await ConsentLog.findOne({
      customerId:  customer._id,
      consentType: 'whatsapp_marketing',
      action:      'revoked',
    });

    expect(log).not.toBeNull();
    expect(log.source).toBe('api');
  });

  it('should reject invalid consentType with 422', async () => {
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'invalid_type', granted: true });

    expect(res.status).toBe(422);
  });

  it('should reject missing granted field with 422', async () => {
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'sms_marketing' });

    expect(res.status).toBe(422);
  });

  it('should reject non-boolean granted with 422', async () => {
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'sms_marketing', granted: 'yes' });

    expect(res.status).toBe(422);
  });

  it('should return 403 for accountant role', async () => {
    const accToken = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'accountant');
    const res = await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${accToken}`);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT — HISTORY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/compliance/customers/:customerId/consent/history', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should return empty consent history when none exists', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/history`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return consent history after consent update', async () => {
    await request(app)
      .patch(`/api/v1/compliance/customers/${customer._id}/consent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ consentType: 'sms_marketing', granted: false });

    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/history`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.logs.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter history by consentType', async () => {
    await ConsentLog.create({
      userId, customerId: customer._id,
      consentType: 'sms_marketing', action: 'revoked', source: 'api',
    });
    await ConsentLog.create({
      userId, customerId: customer._id,
      consentType: 'email_marketing', action: 'granted', source: 'api',
    });

    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ consentType: 'sms_marketing' });

    expect(res.status).toBe(200);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.logs[0].consentType).toBe('sms_marketing');
  });

  it('should reject invalid consentType filter with 422', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/history`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ consentType: 'bad_type' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNSUBSCRIBE TOKEN
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/compliance/customers/:customerId/consent/token', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should generate an unsubscribe token and URL', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('unsubscribeUrl');
    expect(res.body.data.token).toHaveLength(64); // SHA-256 hex
  });

  it('should generate deterministic tokens — same inputs produce same token', async () => {
    const res1 = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const res2 = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res1.body.data.token).toBe(res2.body.data.token);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNSUBSCRIBE — PUBLIC ENDPOINT
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/compliance/unsubscribe/:customerId', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should successfully unsubscribe a customer with valid token', async () => {
    // Get valid token
    const tokenRes = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const { token } = tokenRes.body.data;

    // Use token to unsubscribe — no auth required
    const res = await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`)
      .query({ token });

    expect(res.status).toBe(200);
    expect(res.body.data.unsubscribed).toBe(true);
  });

  it('should set doNotContact=true after unsubscribe', async () => {
    const tokenRes = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`)
      .query({ token: tokenRes.body.data.token });

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.doNotContact).toBe(true);
  });

  it('should add customer to DNC list after unsubscribe', async () => {
    const tokenRes = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`)
      .query({ token: tokenRes.body.data.token });

    const dncEntry = await DncList.findOne({
      customerId: customer._id,
      isActive:   true,
    });

    expect(dncEntry).not.toBeNull();
    expect(dncEntry.reason).toBe('unsubscribe_link');
  });

  it('should reject invalid token with 400', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`)
      .query({ token: 'invalidtoken1234567890123456789012345678901234567890123456789012' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_UNSUBSCRIBE_TOKEN');
  });

  it('should reject missing token with 400', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`);

    expect(res.status).toBe(400);
  });

  it('should work without authentication — public endpoint', async () => {
    const tokenRes = await request(app)
      .get(`/api/v1/compliance/customers/${customer._id}/consent/token`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const res = await request(app)
      .get(`/api/v1/compliance/unsubscribe/${customer._id}`)
      .query({ token: tokenRes.body.data.token });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DNC LIST
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/compliance/dnc', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should return empty DNC list when none exist', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(0);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('should return DNC entries for the authenticated user', async () => {
    const customer = await seedCustomer(userId);
    await DncList.create({
      userId, customerId: customer._id,
      channels: ['all'], reason: 'customer_request', isActive: true,
    });

    const res = await request(app)
      .get('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(1);
  });

  it('should not return another user DNC entries', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    const otherCust  = await seedCustomer(otherUser._id);
    await DncList.create({
      userId: otherUser._id, customerId: otherCust._id,
      channels: ['all'], reason: 'customer_request', isActive: true,
    });

    const res = await request(app)
      .get('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.entries).toHaveLength(0);
  });

  it('should reject invalid page with 422', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .query({ page: 0 });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/compliance/dnc', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should add a customer to the DNC list', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        customerId: customer._id,
        channels:   ['sms', 'whatsapp'],
        reason:     'customer_request',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.dncEntry.isActive).toBe(true);
    expect(res.body.data.dncEntry.channels).toContain('sms');
  });

  it('should set doNotContact=true on customer when added to DNC', async () => {
    await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        customerId: customer._id,
        channels:   ['all'],
        reason:     'complaint',
      });

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.doNotContact).toBe(true);
  });

  it('should create a consent log when added to DNC', async () => {
    await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerId: customer._id, channels: ['all'], reason: 'legal' });

    const log = await ConsentLog.findOne({
      customerId:  customer._id,
      consentType: 'data_processing',
      action:      'revoked',
    });

    expect(log).not.toBeNull();
  });

  it('should reject missing customerId with 422', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ channels: ['all'] });

    expect(res.status).toBe(422);
  });

  it('should reject invalid channel with 422', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerId: customer._id, channels: ['fax'] });

    expect(res.status).toBe(422);
  });

  it('should reject invalid reason with 422', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ customerId: customer._id, reason: 'bad_reason' });

    expect(res.status).toBe(422);
  });

  it('should return 403 for accountant role', async () => {
    const accToken = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'accountant');

    const res = await request(app)
      .post('/api/v1/compliance/dnc')
      .set('Authorization', `Bearer ${accToken}`)
      .send({ customerId: customer._id, channels: ['all'] });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/compliance/dnc/:customerId', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should remove a customer from the DNC list', async () => {
    await DncList.create({
      userId, customerId: customer._id,
      channels: ['all'], reason: 'customer_request', isActive: true,
    });

    const res = await request(app)
      .delete(`/api/v1/compliance/dnc/${customer._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);

    const entry = await DncList.findOne({ customerId: customer._id });
    expect(entry.isActive).toBe(false);
    expect(entry.removedAt).not.toBeNull();
  });

  it('should set doNotContact=false after removal from DNC', async () => {
    await Customer.findByIdAndUpdate(customer._id, {
      'preferences.doNotContact': true,
    });
    await DncList.create({
      userId, customerId: customer._id,
      channels: ['all'], reason: 'customer_request', isActive: true,
    });

    await request(app)
      .delete(`/api/v1/compliance/dnc/${customer._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const updated = await Customer.findById(customer._id);
    expect(updated.preferences.doNotContact).toBe(false);
  });

  it('should return 404 if customer is not on DNC list', async () => {
    const res = await request(app)
      .delete(`/api/v1/compliance/dnc/${customer._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DNC_ENTRY_NOT_FOUND');
  });

  it('should return 403 for agent role', async () => {
    const agentToken = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'agent');

    const res = await request(app)
      .delete(`/api/v1/compliance/dnc/${customer._id}`)
      .set('Authorization', `Bearer ${agentToken}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/compliance/dnc/:customerId/check', () => {
  let ownerToken;
  let userId;
  let customer;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should return isOnDnc=false for customer not on DNC', async () => {
    const res = await request(app)
      .get(`/api/v1/compliance/dnc/${customer._id}/check`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isOnDnc).toBe(false);
  });

  it('should return isOnDnc=true for customer on DNC', async () => {
    await DncList.create({
      userId, customerId: customer._id,
      channels: ['sms', 'whatsapp'], reason: 'customer_request', isActive: true,
    });

    const res = await request(app)
      .get(`/api/v1/compliance/dnc/${customer._id}/check`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isOnDnc).toBe(true);
    expect(res.body.data.channels).toContain('sms');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GDPR DATA EXPORT
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/compliance/gdpr/export', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should create a full_account data export request', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'full_account' });

    expect(res.status).toBe(201);
    expect(res.body.data.exportRequest.exportType).toBe('full_account');
    expect(res.body.data.exportRequest.status).toBe('completed');
  });

  it('should create a customer_data export request', async () => {
    const customer = await seedCustomer(userId);

    const res = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'customer_data', customerId: customer._id });

    expect(res.status).toBe(201);
    expect(res.body.data.exportRequest.exportType).toBe('customer_data');
    expect(res.body.data.exportRequest.status).toBe('completed');
  });

  it('should reject invalid exportType with 422', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'invalid_type' });

    expect(res.status).toBe(422);
  });

  it('should reject customer_data export without customerId with 422', async () => {
    const res = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'customer_data' });

    expect(res.status).toBe(422);
  });

  it('should reject duplicate export when one is already in progress', async () => {
    await DataExportRequest.create({
      userId,
      exportType: 'full_account',
      status:     'processing',
      expiresAt:  new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'full_account' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPORT_ALREADY_IN_PROGRESS');
  });
});

describe('GET /api/v1/compliance/gdpr/exports', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should return empty list when no exports exist', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/gdpr/exports')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(0);
  });

  it('should return export requests for authenticated user', async () => {
    await DataExportRequest.create({
      userId, exportType: 'full_account',
      status: 'completed', expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .get('/api/v1/compliance/gdpr/exports')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(1);
  });

  it('should not return another user export requests', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });
    await DataExportRequest.create({
      userId: otherUser._id, exportType: 'full_account',
      status: 'completed', expiresAt: new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .get('/api/v1/compliance/gdpr/exports')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(0);
  });
});

describe('GET /api/v1/compliance/gdpr/exports/:id/download', () => {
  let ownerToken;
  let userId;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
  });

  it('should download completed export data', async () => {
    const exportReq = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'full_account' });

    const exportId = exportReq.body.data.exportRequest._id;

    const res = await request(app)
      .get(`/api/v1/compliance/gdpr/exports/${exportId}/download`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.exportData).toHaveProperty('exportedAt');
    expect(res.body.data.exportData).toHaveProperty('account');
    expect(res.body.data.exportData).toHaveProperty('customers');
    expect(res.body.data.exportData).toHaveProperty('invoices');
    expect(res.body.data.exportData).toHaveProperty('summary');
  });

  it('should not expose password in export data', async () => {
    const exportReq = await request(app)
      .post('/api/v1/compliance/gdpr/export')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ exportType: 'full_account' });

    const exportId = exportReq.body.data.exportRequest._id;

    const res = await request(app)
      .get(`/api/v1/compliance/gdpr/exports/${exportId}/download`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.exportData.account.password).toBeUndefined();
    expect(res.body.data.exportData.account.twoFactorSecret).toBeUndefined();
    expect(res.body.data.exportData.account.refreshTokens).toBeUndefined();
  });

  it('should return 404 for non-existent export', async () => {
    const res = await request(app)
      .get('/api/v1/compliance/gdpr/exports/507f1f77bcf86cd799439011/download')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });

  it('should not allow downloading another user export', async () => {
    const otherToken = await signupAndLogin(otherOwnerFixture);
    const otherUser  = await User.findOne({ email: otherOwnerFixture.email });

    const exportReq = await DataExportRequest.create({
      userId:     otherUser._id,
      exportType: 'full_account',
      status:     'completed',
      exportData: { test: true },
      expiresAt:  new Date(Date.now() + 86400000),
    });

    const res = await request(app)
      .get(`/api/v1/compliance/gdpr/exports/${exportReq._id}/download`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE SERVICE — isDeliveryAllowed
// ─────────────────────────────────────────────────────────────────────────────

describe('Compliance guard — isDeliveryAllowed', () => {
  const complianceService = require('../services/compliance.service');
  let userId;
  let customer;

  beforeEach(async () => {
    await signupAndLogin(ownerFixture);
    const user = await User.findOne({ email: ownerFixture.email });
    userId     = user._id;
    customer   = await seedCustomer(userId);
  });

  it('should allow delivery when customer is not on DNC and has opted in', async () => {
    const result = await complianceService.isDeliveryAllowed(
      userId, customer._id, 'email'
    );
    expect(result.allowed).toBe(true);
  });

  it('should block delivery when doNotContact=true', async () => {
    await Customer.findByIdAndUpdate(customer._id, {
      'preferences.doNotContact': true,
    });

    const result = await complianceService.isDeliveryAllowed(
      userId, customer._id, 'email'
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('do_not_contact');
  });

  it('should block delivery when customer is on DNC list for all channels', async () => {
    await DncList.create({
      userId, customerId: customer._id,
      channels: ['all'], reason: 'customer_request', isActive: true,
    });

    const result = await complianceService.isDeliveryAllowed(
      userId, customer._id, 'sms'
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('on_dnc_list');
  });

  it('should block SMS delivery when customer has not opted in to SMS', async () => {
    await Customer.findByIdAndUpdate(customer._id, {
      'preferences.channels': ['email'],
    });

    const result = await complianceService.isDeliveryAllowed(
      userId, customer._id, 'sms'
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('channel_not_opted_in');
  });

  it('should allow email delivery when only email channel is opted in', async () => {
    await Customer.findByIdAndUpdate(customer._id, {
      'preferences.channels': ['email'],
    });

    const result = await complianceService.isDeliveryAllowed(
      userId, customer._id, 'email'
    );
    expect(result.allowed).toBe(true);
  });
});



