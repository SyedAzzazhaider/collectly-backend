'use strict';

process.env.NODE_ENV               = 'test';
process.env.JWT_ACCESS_SECRET      = 'test_access_secret_collectly_2024';
process.env.JWT_REFRESH_SECRET     = 'test_refresh_secret_collectly_2024';
process.env.JWT_ACCESS_EXPIRES_IN  = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.FRONTEND_URL           = 'http://localhost:3000';
process.env.API_BASE_URL           = 'http://localhost:5000';
process.env.GOOGLE_CLIENT_ID       = 'test_google_client_id';
process.env.GOOGLE_CLIENT_SECRET   = 'test_google_client_secret';
process.env.MICROSOFT_CLIENT_ID    = 'test_microsoft_client_id';
process.env.MICROSOFT_CLIENT_SECRET = 'test_microsoft_client_secret';

const request  = require('supertest');
const app      = require('../../../../app');
const Customer = require('../models/Customer.model');
const Invoice  = require('../models/Invoice.model');
const User     = require('../../auth/models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Owner User', email: 'owner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Agent User', email: 'agent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const customerFixture = {
  name:     'Acme Corp',
  email:    'acme@example.com',
  phone:    '+1234567890',
  company:  'Acme Corporation',
  timezone: 'America/New_York',
  preferences: { channels: ['email', 'sms'] },
  tags: ['vip', 'enterprise'],
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

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// CREATE CUSTOMER
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/customers', () => {
  let token;
  beforeEach(async () => { token = await signupAndLogin(ownerFixture); });

  it('should create a customer successfully', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.customer.name).toBe(customerFixture.name);
    expect(res.body.data.customer.email).toBe(customerFixture.email);
  });

  it('should store customer with correct userId', async () => {
    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    const user     = await User.findOne({ email: ownerFixture.email });
    const customer = await Customer.findOne({ email: customerFixture.email });
    expect(String(customer.userId)).toBe(String(user._id));
  });

  it('should store preferred channels correctly', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    expect(res.body.data.customer.preferences.channels).toContain('email');
    expect(res.body.data.customer.preferences.channels).toContain('sms');
  });

  it('should reject duplicate email for same user', async () => {
    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_CUSTOMER_EMAIL');
  });

  it('should allow same email for different users', async () => {
    const token2 = await signupAndLogin(agentFixture);

    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);

    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token2}`)
      .send(customerFixture);

    expect(res.status).toBe(201);
  });

  it('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...customerFixture, name: '' });
    expect(res.status).toBe(422);
  });

  it('should reject invalid email', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...customerFixture, email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('should reject invalid channel', async () => {
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...customerFixture, preferences: { channels: ['telegram'] } });
    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/customers').send(customerFixture);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET CUSTOMERS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/customers', () => {
  let token;
  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);
  });

  it('should return list of customers', async () => {
    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.customers.length).toBe(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should only return customers belonging to authenticated user', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token2}`)
      .send({ ...customerFixture, email: 'other@example.com' });

    const res = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.customers.length).toBe(1);
    expect(res.body.data.customers[0].email).toBe(customerFixture.email);
  });

  it('should search customers by name', async () => {
    const res = await request(app)
      .get('/api/v1/customers?search=Acme')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.customers.length).toBe(1);
  });

  it('should return empty when search has no match', async () => {
    const res = await request(app)
      .get('/api/v1/customers?search=NoMatch')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.customers.length).toBe(0);
  });

  it('should filter by tags', async () => {
    const res = await request(app)
      .get('/api/v1/customers?tags=vip')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.customers.length).toBe(1);
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/customers?page=1&limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.page).toBe(1);
    expect(res.body.data.pagination.limit).toBe(5);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/customers');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE CUSTOMER
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/customers/:id', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);
    customerId = res.body.data.customer._id;
  });

  it('should return customer by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.customer._id).toBe(customerId);
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await request(app)
      .get('/api/v1/customers/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('should not return another users customer', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .get(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET CUSTOMER SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/customers/:id/summary', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);
    customerId = res.body.data.customer._id;
  });

  it('should return customer summary with invoice stats', async () => {
    const res = await request(app)
      .get(`/api/v1/customers/${customerId}/summary`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeDefined();
    expect(res.body.data.summary.total).toBe(0);
    expect(res.body.data.customer).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE CUSTOMER
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/customers/:id', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);
    customerId = res.body.data.customer._id;
  });

  it('should update customer name', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Corp' });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.name).toBe('Updated Corp');
  });

  it('should update preferred channels', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { channels: ['email', 'whatsapp'] } });

    expect(res.status).toBe(200);
    expect(res.body.data.customer.preferences.channels).toContain('whatsapp');
  });

  it('should reject invalid channel on update', async () => {
    const res = await request(app)
      .patch(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { channels: ['fax'] } });

    expect(res.status).toBe(422);
  });

  it('should return 404 for non-existent customer on update', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE CUSTOMER
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/customers/:id', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send(customerFixture);
    customerId = res.body.data.customer._id;
  });

  it('should delete customer with no outstanding invoices', async () => {
    const res = await request(app)
      .delete(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const found = await Customer.findById(customerId);
    expect(found).toBeNull();
  });

  it('should reject deletion when outstanding invoices exist', async () => {
    const user = await User.findOne({ email: ownerFixture.email });
    await Invoice.create({
      userId:        user._id,
      customerId,
      invoiceNumber: 'INV-001',
      amount:        500,
      currency:      'USD',
      dueDate:       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status:        'pending',
    });

    const res = await request(app)
      .delete(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CUSTOMER_HAS_OUTSTANDING_INVOICES');
  });

  it('should reject non-owner from deleting customer', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await makeRole(agentFixture.email, 'agent');

    const res = await request(app)
      .delete(`/api/v1/customers/${customerId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated delete', async () => {
    const res = await request(app).delete(`/api/v1/customers/${customerId}`);
    expect(res.status).toBe(401);
  });
});
