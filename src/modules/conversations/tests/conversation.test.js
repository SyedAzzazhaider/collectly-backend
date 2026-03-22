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
const { Message }     = require('../models/Message.model');
const { CannedReply } = require('../models/CannedReply.model');
const { PaymentPlan } = require('../models/PaymentPlan.model');
const User     = require('../../auth/models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Conv Owner', email: 'convowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Conv Agent', email: 'convagent@test.dev',
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

const makeAdmin = async (email) => {
  await User.findOneAndUpdate({ email }, { role: 'admin' });
};

const createCustomerAndInvoice = async (token) => {
  const email = `cust_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;

  const custRes = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Test Customer', email, phone: '+12345678901' });

  const customerId = custRes.body.data.customer._id;

  const invRes = await request(app)
    .post('/api/v1/invoices')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      invoiceNumber: `INV-${Date.now()}`,
      amount:        5000,
      currency:      'USD',
      dueDate:       new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

  return { customerId, invoiceId: invRes.body.data.invoice._id };
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/conversations/messages', () => {
  let token;
  let customerId;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    ({ customerId, invoiceId } = await createCustomerAndInvoice(token));
  });

  it('should send an email message successfully', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        channel: 'email',
        type:    'custom',
        subject: 'Invoice Reminder',
        body:    'Dear customer, please settle your invoice.',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.message.channel).toBe('email');
    expect(res.body.data.message.direction).toBe('outbound');
    expect(res.body.data.message.status).toBe('sent');
  });

  it('should send message with invoice link', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        invoiceId,
        channel: 'sms',
        body:    'Your invoice is due. Please pay now.',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.message.invoiceId).toBe(invoiceId);
  });

  it('should send message with follow-up scheduled', async () => {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        channel:    'email',
        subject:    'Follow up',
        body:       'Please respond to this message.',
        followUpAt,
        followUpNote: 'Check if customer replied',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.message.followUpAt).toBeDefined();
  });

  it('should store userId on message', async () => {
    await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'sms', body: 'Test message.' });

    const user    = await User.findOne({ email: ownerFixture.email });
    const message = await Message.findOne({ customerId });
    expect(String(message.userId)).toBe(String(user._id));
  });

  it('should reject missing customerId', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', subject: 'Test', body: 'Test body.' });

    expect(res.status).toBe(422);
  });

  it('should reject invalid channel', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'telegram', body: 'Test body.' });

    expect(res.status).toBe(422);
  });

  it('should reject email without subject', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'email', body: 'Test body.' });

    expect(res.status).toBe(422);
  });

  it('should reject missing body', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'sms' });

    expect(res.status).toBe(422);
  });

  it('should reject message to another users customer', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token2}`)
      .send({ customerId, channel: 'sms', body: 'Test body.' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/messages')
      .send({ customerId, channel: 'sms', body: 'Test body.' });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/conversations/inbox', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    ({ customerId } = await createCustomerAndInvoice(token));
    await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'sms', body: 'Test message.' });
  });

  it('should return inbox messages', async () => {
    const res = await request(app)
      .get('/api/v1/conversations/inbox')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.length).toBe(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should filter by channel', async () => {
    await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'email', subject: 'Test', body: 'Email body.' });

    const res = await request(app)
      .get('/api/v1/conversations/inbox?channel=sms')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    res.body.data.messages.forEach((m) => expect(m.channel).toBe('sms'));
  });

  it('should filter by customerId', async () => {
    const res = await request(app)
      .get(`/api/v1/conversations/inbox?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.length).toBe(1);
  });

  it('should only return authenticated users messages', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .get('/api/v1/conversations/inbox')
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.length).toBe(0);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/conversations/inbox');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONVERSATION THREAD
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/conversations/thread/:customerId', () => {
  let token;
  let customerId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    ({ customerId } = await createCustomerAndInvoice(token));
    await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'email', subject: 'Test', body: 'First message.' });
    await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'sms', body: 'Second message.' });
  });

  it('should return full conversation thread for customer', async () => {
    const res = await request(app)
      .get(`/api/v1/conversations/thread/${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.messages.length).toBe(2);
    expect(res.body.data.customer).toBeDefined();
  });

  it('should return 404 for non-existent customer', async () => {
    const res = await request(app)
      .get('/api/v1/conversations/thread/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should not return another users thread', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .get(`/api/v1/conversations/thread/${customerId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UPS
// ─────────────────────────────────────────────────────────────────────────────

describe('Follow-up scheduling', () => {
  let token;
  let customerId;
  let messageId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    ({ customerId } = await createCustomerAndInvoice(token));
    const msgRes = await request(app)
      .post('/api/v1/conversations/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, channel: 'sms', body: 'Test message.' });
    messageId = msgRes.body.data.message._id;
  });

  it('should schedule a follow-up on a message', async () => {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ followUpAt, followUpNote: 'Check response' });

    expect(res.status).toBe(200);
    expect(res.body.data.message.followUpAt).toBeDefined();
    expect(res.body.data.message.followUpCompleted).toBe(false);
  });

  it('should complete a follow-up', async () => {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ followUpAt });

    const res = await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.message.followUpCompleted).toBe(true);
    expect(res.body.data.message.followUpCompletedAt).toBeDefined();
  });

  it('should reject follow-up with past date', async () => {
    const res = await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ followUpAt: '2020-01-01T00:00:00.000Z' });

    expect(res.status).toBe(422);
  });

  it('should reject completing already completed follow-up', async () => {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ followUpAt });
    await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up/complete`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up/complete`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FOLLOW_UP_ALREADY_COMPLETED');
  });

  it('should return pending follow-ups list', async () => {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post(`/api/v1/conversations/messages/${messageId}/follow-up`)
      .set('Authorization', `Bearer ${token}`)
      .send({ followUpAt });

    const res = await request(app)
      .get('/api/v1/conversations/follow-ups')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.followUps.length).toBe(1);
  });

  it('should return follow-up stats', async () => {
    const res = await request(app)
      .get('/api/v1/conversations/follow-ups/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeDefined();
    expect(res.body.data.stats.total).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANNED REPLIES
// ─────────────────────────────────────────────────────────────────────────────

describe('Canned replies', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
  });

  const validCannedReply = {
    name:     'Payment Overdue',
    category: 'Collections',
    channel:  'email',
    subject:  'Your invoice {{invoiceNumber}} is overdue',
    body:     'Dear {{customerName}}, your invoice {{invoiceNumber}} for {{currency}} {{amount}} is overdue.',
    tags:     ['overdue', 'collections'],
  };

  it('should create a canned reply', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    expect(res.status).toBe(201);
    expect(res.body.data.cannedReply.name).toBe('Payment Overdue');
    expect(res.body.data.cannedReply.usageCount).toBe(0);
  });

  it('should reject duplicate canned reply name', async () => {
    await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const res = await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_CANNED_REPLY_NAME');
  });

  it('should list canned replies', async () => {
    await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const res = await request(app)
      .get('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cannedReplies.length).toBe(1);
  });

  it('should filter canned replies by channel', async () => {
    const res = await request(app)
      .get('/api/v1/conversations/canned-replies?channel=email')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('should search canned replies', async () => {
    await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const res = await request(app)
      .get('/api/v1/conversations/canned-replies?search=Payment')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.cannedReplies.length).toBe(1);
  });

  it('should get categories', async () => {
    await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const res = await request(app)
      .get('/api/v1/conversations/canned-replies/categories')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.categories).toContain('Collections');
  });

  it('should update a canned reply', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const id  = createRes.body.data.cannedReply._id;
    const res = await request(app)
      .patch(`/api/v1/conversations/canned-replies/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name', isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.cannedReply.name).toBe('Updated Name');
    expect(res.body.data.cannedReply.isActive).toBe(false);
  });

  it('should preview a canned reply with context', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const id  = createRes.body.data.cannedReply._id;
    const res = await request(app)
      .post(`/api/v1/conversations/canned-replies/${id}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName:  'Acme Corp',
        invoiceNumber: 'INV-001',
        amount:        '5000',
        currency:      'USD',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.preview.body).toContain('Acme Corp');
    expect(res.body.data.preview.body).toContain('INV-001');
  });

  it('should delete a canned reply', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const id  = createRes.body.data.cannedReply._id;
    const res = await request(app)
      .delete(`/api/v1/conversations/canned-replies/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
  });

  it('should only return own canned replies', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await request(app)
      .post('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token}`)
      .send(validCannedReply);

    const res = await request(app)
      .get('/api/v1/conversations/canned-replies')
      .set('Authorization', `Bearer ${token2}`);

    expect(res.body.data.cannedReplies.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT PLANS
// ─────────────────────────────────────────────────────────────────────────────

describe('Payment plans', () => {
  let token;
  let customerId;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    ({ customerId, invoiceId } = await createCustomerAndInvoice(token));
  });

  const buildPlanData = (customerId, invoiceId) => ({
    customerId,
    invoiceId,
    totalAmount:          3000,
    currency:             'USD',
    numberOfInstallments: 3,
    frequency:            'monthly',
    startDate:            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    notes:                'Agreed with customer on 3 monthly installments',
  });

  it('should create a payment plan with installments', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    expect(res.status).toBe(201);
    expect(res.body.data.plan.status).toBe('proposed');
    expect(res.body.data.plan.installments.length).toBe(3);
    expect(res.body.data.plan.numberOfInstallments).toBe(3);
    expect(res.body.data.plan.totalAmount).toBe(3000);
  });

  it('should generate correct installment amounts', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const installments = res.body.data.plan.installments;
    const total = installments.reduce((sum, i) => sum + i.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(3000);
  });

  it('should reject duplicate active plan for same invoice', async () => {
    await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PAYMENT_PLAN_EXISTS');
  });

  it('should accept a proposed payment plan', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const planId = createRes.body.data.plan._id;
    const res    = await request(app)
      .post(`/api/v1/conversations/payment-plans/${planId}/accept`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.plan.status).toBe('active');
    expect(res.body.data.plan.acceptedAt).toBeDefined();
  });

  it('should reject a proposed payment plan', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const planId = createRes.body.data.plan._id;
    const res    = await request(app)
      .post(`/api/v1/conversations/payment-plans/${planId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ rejectionReason: 'Customer cannot afford this amount' });

    expect(res.status).toBe(200);
    expect(res.body.data.plan.status).toBe('rejected');
    expect(res.body.data.plan.rejectionReason).toBe('Customer cannot afford this amount');
  });

  it('should record installment payment', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const planId = createRes.body.data.plan._id;

    await request(app)
      .post(`/api/v1/conversations/payment-plans/${planId}/accept`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/conversations/payment-plans/${planId}/installments/1/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.data.plan.amountPaid).toBe(1000);
  });

  it('should mark plan as completed when fully paid', async () => {
    const createRes = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const planId      = createRes.body.data.plan._id;
    const installments = createRes.body.data.plan.installments;

    await request(app)
      .post(`/api/v1/conversations/payment-plans/${planId}/accept`)
      .set('Authorization', `Bearer ${token}`);

    for (const inst of installments) {
      await request(app)
        .post(`/api/v1/conversations/payment-plans/${planId}/installments/${inst.installmentNumber}/pay`)
        .set('Authorization', `Bearer ${token}`)
        .send({ amount: inst.amount });
    }

    const res = await request(app)
      .get(`/api/v1/conversations/payment-plans/${planId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.plan.status).toBe('completed');
    expect(res.body.data.plan.completedAt).toBeDefined();
  });

  it('should reject plan creation for paid invoice', async () => {
    await request(app)
      .post(`/api/v1/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 5000 });

    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVOICE_NOT_ELIGIBLE');
  });

  it('should list payment plans', async () => {
    await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send(buildPlanData(customerId, invoiceId));

    const res = await request(app)
      .get('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.plans.length).toBe(1);
  });

  it('should reject plan creation for another users invoice', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token2}`)
      .send(buildPlanData(customerId, invoiceId));

    expect(res.status).toBe(404);
  });

  it('should validate number of installments range', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...buildPlanData(customerId, invoiceId), numberOfInstallments: 1 });

    expect(res.status).toBe(422);
  });

  it('should validate frequency', async () => {
    const res = await request(app)
      .post('/api/v1/conversations/payment-plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...buildPlanData(customerId, invoiceId), frequency: 'daily' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — DATA ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Security — Module F data isolation', () => {
  it('should reject all conversation endpoints without token', async () => {
    const endpoints = [
      { method: 'get',  url: '/api/v1/conversations/inbox' },
      { method: 'post', url: '/api/v1/conversations/messages' },
      { method: 'get',  url: '/api/v1/conversations/canned-replies' },
      { method: 'get',  url: '/api/v1/conversations/payment-plans' },
      { method: 'get',  url: '/api/v1/conversations/follow-ups' },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.url).send({});
      expect(res.status).toBe(401);
    }
  });
});
