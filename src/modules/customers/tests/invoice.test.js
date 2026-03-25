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
const Invoice  = require('../models/Invoice.model');
const Customer = require('../models/Customer.model');
const User     = require('../../auth/models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const ownerFixture = {
  name: 'Invoice Owner', email: 'invoiceowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const customerFixture = {
  name: 'Test Customer', email: 'testcustomer@example.com',
  phone: '+1234567890', company: 'Test Co',
};

const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const pastDate   = new Date(Date.now() - 5  * 24 * 60 * 60 * 1000).toISOString();

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const signupAndLogin = async (userData) => {
  await request(app).post('/api/v1/auth/signup').send({ ...userData, tosAccepted: true });
  const res = await request(app).post('/api/v1/auth/login').send({
    email: userData.email, password: userData.password,
  });
  return res.body.data.accessToken;
};

const createCustomer = async (token, data = customerFixture) => {
  const res = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${token}`)
    .send(data);
  return res.body.data.customer._id;
};

const createInvoice = async (token, customerId, overrides = {}) => {
  const res = await request(app)
    .post('/api/v1/invoices')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      invoiceNumber: `INV-${Date.now()}`,
      amount:        1000,
      currency:      'USD',
      dueDate:       futureDate,
      ...overrides,
    });
  return res;
};

// â”€â”€ Setup / Teardown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CREATE INVOICE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('POST /api/v1/invoices', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token      = await signupAndLogin(ownerFixture);
    customerId = await createCustomer(token);
  });

  it('should create invoice successfully', async () => {
    const res = await createInvoice(token, customerId);
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.amount).toBe(1000);
    expect(res.body.data.invoice.status).toBe('pending');
    expect(res.body.data.invoice.currency).toBe('USD');
  });

  it('should link invoice to correct customer', async () => {
    const res = await createInvoice(token, customerId);
    expect(String(res.body.data.invoice.customerId)).toBe(customerId);
  });

  it('should auto-set status to overdue for past due dates', async () => {
    const res = await createInvoice(token, customerId, { dueDate: pastDate });
    expect(res.status).toBe(201);
    expect(res.body.data.invoice.status).toBe('overdue');
  });

  it('should reject duplicate invoice number for same user', async () => {
    const invoiceNumber = 'INV-DUPLICATE';
    await createInvoice(token, customerId, { invoiceNumber });
    const res = await createInvoice(token, customerId, { invoiceNumber });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_INVOICE_NUMBER');
  });

  it('should reject invoice for non-existent customer', async () => {
    const res = await createInvoice(token, '000000000000000000000000');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('should reject invoice for another users customer', async () => {
    const token2      = await signupAndLogin({ ...ownerFixture, email: 'other@test.dev', confirmPassword: ownerFixture.password });
    const customerId2 = await createCustomer(token2, { ...customerFixture, email: 'other@example.com' });
    const res         = await createInvoice(token, customerId2);
    expect(res.status).toBe(404);
  });

  it('should reject missing customerId', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceNumber: 'INV-X', amount: 100, dueDate: futureDate });
    expect(res.status).toBe(422);
  });

  it('should reject negative amount', async () => {
    const res = await createInvoice(token, customerId, { amount: -100 });
    expect(res.status).toBe(422);
  });

  it('should reject invalid currency', async () => {
    const res = await createInvoice(token, customerId, { currency: 'XYZ' });
    expect(res.status).toBe(422);
  });

  it('should reject missing due date', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, invoiceNumber: 'INV-ND', amount: 100 });
    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/invoices').send({});
    expect(res.status).toBe(401);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET INVOICES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('GET /api/v1/invoices', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token      = await signupAndLogin(ownerFixture);
    customerId = await createCustomer(token);
    await createInvoice(token, customerId, { invoiceNumber: 'INV-001', tags: ['urgent'] });
    await createInvoice(token, customerId, { invoiceNumber: 'INV-002' });
  });

  it('should return all invoices for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBe(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  it('should filter invoices by status', async () => {
    const res = await request(app)
      .get('/api/v1/invoices?status=pending')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    res.body.data.invoices.forEach((inv) => {
      expect(inv.status).toBe('pending');
    });
  });

  it('should filter invoices by customerId', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBe(2);
  });

  it('should search invoices by invoice number', async () => {
    const res = await request(app)
      .get('/api/v1/invoices?search=INV-001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBe(1);
    expect(res.body.data.invoices[0].invoiceNumber).toBe('INV-001');
  });

  it('should filter invoices by tags', async () => {
    const res = await request(app)
      .get('/api/v1/invoices?tags=urgent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBe(1);
  });

  it('should populate customer data in invoice list', async () => {
    const res = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`);

    const inv = res.body.data.invoices[0];
    expect(inv.customerId).toBeDefined();
    expect(inv.customerId.name).toBeDefined();
  });

  it('should only return invoices belonging to authenticated user', async () => {
    const token2      = await signupAndLogin({ ...ownerFixture, email: 'other2@test.dev', confirmPassword: ownerFixture.password });
    const customerId2 = await createCustomer(token2, { ...customerFixture, email: 'other2@example.com' });
    await createInvoice(token2, customerId2, { invoiceNumber: 'INV-OTHER' });

    const res = await request(app)
      .get('/api/v1/invoices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.invoices.length).toBe(2);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET SINGLE INVOICE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('GET /api/v1/invoices/:id', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token      = await signupAndLogin(ownerFixture);
    const cid  = await createCustomer(token);
    const res  = await createInvoice(token, cid);
    invoiceId  = res.body.data.invoice._id;
  });

  it('should return invoice by ID with customer data', async () => {
    const res = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoice._id).toBe(invoiceId);
    expect(res.body.data.invoice.customerId).toBeDefined();
  });

  it('should return 404 for non-existent invoice', async () => {
    const res = await request(app)
      .get('/api/v1/invoices/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('INVOICE_NOT_FOUND');
  });

  it('should not return another users invoice', async () => {
    const token2 = await signupAndLogin({ ...ownerFixture, email: 'other3@test.dev', confirmPassword: ownerFixture.password });
    const res    = await request(app)
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// UPDATE INVOICE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PATCH /api/v1/invoices/:id', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token     = await signupAndLogin(ownerFixture);
    const cid = await createCustomer(token);
    const res = await createInvoice(token, cid);
    invoiceId = res.body.data.invoice._id;
  });

  it('should update invoice amount', async () => {
    const res = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 2000 });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.amount).toBe(2000);
  });

  it('should update invoice tags', async () => {
    const res = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tags: ['priority', 'q1'] });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.tags).toContain('priority');
  });

  it('should reject invalid status', async () => {
    const res = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'deleted' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid currency on update', async () => {
    const res = await request(app)
      .patch(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'XYZ' });

    expect(res.status).toBe(422);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DELETE INVOICE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DELETE /api/v1/invoices/:id', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token     = await signupAndLogin(ownerFixture);
    const cid = await createCustomer(token);
    const res = await createInvoice(token, cid);
    invoiceId = res.body.data.invoice._id;
  });

  it('should delete a pending invoice', async () => {
    const res = await request(app)
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const found = await Invoice.findById(invoiceId);
    expect(found).toBeNull();
  });

  it('should reject deletion of a paid invoice', async () => {
    await Invoice.findByIdAndUpdate(invoiceId, { status: 'paid', amountPaid: 1000 });

    const res = await request(app)
      .delete(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANNOT_DELETE_PAID_INVOICE');
  });

  it('should reject unauthenticated delete', async () => {
    const res = await request(app).delete(`/api/v1/invoices/${invoiceId}`);
    expect(res.status).toBe(401);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RECORD PAYMENT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('POST /api/v1/invoices/:id/payment', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token     = await signupAndLogin(ownerFixture);
    const cid = await createCustomer(token);
    const res = await createInvoice(token, cid, { amount: 1000 });
    invoiceId = res.body.data.invoice._id;
  });

  it('should record a partial payment', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 400 });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.amountPaid).toBe(400);
    expect(res.body.data.invoice.status).toBe('partial');
  });

  it('should mark invoice as paid on full payment', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice.status).toBe('paid');
    expect(res.body.data.invoice.amountPaid).toBe(1000);
  });

  it('should reject payment exceeding balance', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1500 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_EXCEEDS_BALANCE');
  });

  it('should reject payment on already paid invoice', async () => {
    await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVOICE_ALREADY_PAID');
  });

  it('should reject negative payment amount', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: -100 });

    expect(res.status).toBe(422);
  });

  it('should reject missing payment amount', async () => {
    const res = await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OVERDUE INVOICES
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('GET /api/v1/invoices/overdue', () => {
  let token;

  beforeEach(async () => {
    token     = await signupAndLogin(ownerFixture);
    const cid = await createCustomer(token);
    await createInvoice(token, cid, { invoiceNumber: 'INV-FUTURE', dueDate: futureDate });
    await createInvoice(token, cid, { invoiceNumber: 'INV-PAST',   dueDate: pastDate   });
  });

  it('should return only overdue invoices', async () => {
    const res = await request(app)
      .get('/api/v1/invoices/overdue')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.invoices.length).toBe(1);
    expect(res.body.data.invoices[0].status).toBe('overdue');
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/invoices/overdue');
    expect(res.status).toBe(401);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SECURITY
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Security â€” Module C data isolation', () => {
  it('should never return another users customers', async () => {
    const token1 = await signupAndLogin(ownerFixture);
    const token2 = await signupAndLogin({ ...ownerFixture, email: 'sec@test.dev', confirmPassword: ownerFixture.password });

    await request(app).post('/api/v1/customers').set('Authorization', `Bearer ${token1}`).send(customerFixture);
    await request(app).post('/api/v1/customers').set('Authorization', `Bearer ${token2}`).send({ ...customerFixture, email: 'sec@example.com' });

    const res1 = await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${token1}`);
    const res2 = await request(app).get('/api/v1/customers').set('Authorization', `Bearer ${token2}`);

    expect(res1.body.data.customers.length).toBe(1);
    expect(res2.body.data.customers.length).toBe(1);
    expect(res1.body.data.customers[0].email).not.toBe(res2.body.data.customers[0].email);
  });

  it('should never return another users invoices', async () => {
    const token1    = await signupAndLogin(ownerFixture);
    const token2    = await signupAndLogin({ ...ownerFixture, email: 'secinv@test.dev', confirmPassword: ownerFixture.password });
    const cid1      = await createCustomer(token1);
    const cid2      = await createCustomer(token2, { ...customerFixture, email: 'secinv@example.com' });

    await createInvoice(token1, cid1, { invoiceNumber: 'SEC-INV-001' });
    await createInvoice(token2, cid2, { invoiceNumber: 'SEC-INV-002' });

    const res1 = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${token1}`);
    const res2 = await request(app).get('/api/v1/invoices').set('Authorization', `Bearer ${token2}`);

    expect(res1.body.data.invoices.length).toBe(1);
    expect(res2.body.data.invoices.length).toBe(1);
    expect(res1.body.data.invoices[0].invoiceNumber).toBe('SEC-INV-001');
    expect(res2.body.data.invoices[0].invoiceNumber).toBe('SEC-INV-002');
  });
});



