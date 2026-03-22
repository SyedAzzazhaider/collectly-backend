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
const { Notification } = require('../models/Notification.model');
const User     = require('../../auth/models/User.model');
const Customer = require('../../customers/models/Customer.model');
const Invoice  = require('../../customers/models/Invoice.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Notif Owner', email: 'notifowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Notif Agent', email: 'notifagent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const validEmailNotif = {
  channel: 'email',
  type:    'payment_reminder',
  recipient: {
    name:  'Acme Corp',
    email: 'acme@example.com',
  },
  subject: 'Payment Reminder — Invoice #INV-001',
  body:    'Dear Acme Corp, your invoice #INV-001 for USD 5000 is due soon.',
};

const validSmsNotif = {
  channel: 'sms',
  type:    'payment_reminder',
  recipient: {
    name:  'Acme Corp',
    phone: '+12345678901',
  },
  body: 'Reminder: Invoice #INV-001 for USD 5000 is due soon.',
};

const validWhatsAppNotif = {
  channel: 'whatsapp',
  type:    'payment_reminder',
  recipient: {
    name:  'Acme Corp',
    phone: '+12345678901',
  },
  body: 'Reminder: Invoice #INV-001 for USD 5000 is due soon.',
};

const validInAppNotif = {
  channel: 'in-app',
  type:    'payment_reminder',
  recipient: {
    name:  'Acme Corp',
    email: 'acme@example.com',
  },
  body: 'Your invoice #INV-001 is due soon.',
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
// SEND NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/send', () => {
  let token;
  beforeEach(async () => { token = await signupAndLogin(ownerFixture); });

  it('should send an email notification successfully', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validEmailNotif);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.notification.channel).toBe('email');
    expect(res.body.data.notification.status).toBe('sent');
  });

  it('should send an SMS notification successfully', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validSmsNotif);

    expect(res.status).toBe(201);
    expect(res.body.data.notification.channel).toBe('sms');
  });

  it('should send a WhatsApp notification successfully', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validWhatsAppNotif);

    expect(res.status).toBe(201);
    expect(res.body.data.notification.channel).toBe('whatsapp');
  });

  it('should send an in-app notification successfully', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validInAppNotif);

    expect(res.status).toBe(201);
    expect(res.body.data.notification.channel).toBe('in-app');
  });

  it('should store userId on notification', async () => {
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validEmailNotif);

    const user  = await User.findOne({ email: ownerFixture.email });
    const notif = await Notification.findOne({ 'recipient.email': 'acme@example.com' });
    expect(String(notif.userId)).toBe(String(user._id));
  });

  it('should link to invoice when invoiceId provided', async () => {
    const { invoiceId } = await createCustomerAndInvoice(token);

    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validEmailNotif, invoiceId });

    expect(res.status).toBe(201);
    expect(res.body.data.notification.invoiceId).toBe(invoiceId);
  });

  it('should reject missing channel', async () => {
    const { channel, ...rest } = validEmailNotif;
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(rest);

    expect(res.status).toBe(422);
  });

  it('should reject invalid channel', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validEmailNotif, channel: 'fax' });

    expect(res.status).toBe(422);
  });

  it('should reject missing recipient', async () => {
    const { recipient, ...rest } = validEmailNotif;
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(rest);

    expect(res.status).toBe(422);
  });

  it('should reject email channel without subject', async () => {
    const { subject, ...rest } = validEmailNotif;
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(rest);

    expect(res.status).toBe(422);
  });

  it('should reject email channel without recipient email', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validEmailNotif,
        recipient: { name: 'Test', phone: '+12345678901' },
      });

    expect(res.status).toBe(422);
  });

  it('should reject sms channel without phone', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validSmsNotif,
        recipient: { name: 'Test', email: 'test@test.com' },
      });

    expect(res.status).toBe(422);
  });

  it('should reject sms with invalid phone format', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validSmsNotif,
        recipient: { name: 'Test', phone: '123456' },
      });

    expect(res.status).toBe(422);
  });

  it('should reject missing body', async () => {
    const { body, ...rest } = validEmailNotif;
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(rest);

    expect(res.status).toBe(422);
  });

  it('should reject invalid type', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validEmailNotif, type: 'invalid_type' });

    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .send(validEmailNotif);

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEND BULK NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/send-bulk', () => {
  let token;
  beforeEach(async () => { token = await signupAndLogin(ownerFixture); });

  it('should send bulk notifications', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send-bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: [validEmailNotif, validSmsNotif] });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.succeeded).toBeGreaterThanOrEqual(0);
  });

  it('should reject empty notifications array', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send-bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: [] });

    expect(res.status).toBe(422);
  });

  it('should reject more than 100 notifications', async () => {
    const notifications = Array(101).fill(validEmailNotif);
    const res = await request(app)
      .post('/api/v1/notifications/send-bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications });

    expect(res.status).toBe(422);
  });

  it('should reject non-array notifications', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/send-bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: 'not an array' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications', () => {
  let token;
  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validEmailNotif);
  });

  it('should return list of notifications', async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should only return notifications belonging to authenticated user', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token2}`)
      .send({ ...validEmailNotif, recipient: { name: 'Other', email: 'other@test.com' } });

    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.notifications[0].recipient.email).toBe('acme@example.com');
  });

  it('should filter by channel', async () => {
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validSmsNotif);

    const res = await request(app)
      .get('/api/v1/notifications?channel=email')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    res.body.data.notifications.forEach((n) => {
      expect(n.channel).toBe('email');
    });
  });

  it('should filter by status', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?status=sent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?page=1&limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.limit).toBe(5);
  });

  it('should reject invalid channel filter', async () => {
    const res = await request(app)
      .get('/api/v1/notifications?channel=fax')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications/:id', () => {
  let token;
  let notificationId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validEmailNotif);
    notificationId = res.body.data.notification._id;
  });

  it('should return notification by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/notifications/${notificationId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notification._id).toBe(notificationId);
    expect(res.body.data.notification.channel).toBe('email');
  });

  it('should return 404 for non-existent notification', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('should not return another users notification', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .get(`/api/v1/notifications/${notificationId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications/stats', () => {
  let token;
  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validEmailNotif);
    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send(validSmsNotif);
  });

  it('should return notification stats', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeDefined();
    expect(res.body.data.stats.total).toBe(2);
  });

  it('should return delivery stats', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/delivery-stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.stats).toBeDefined();
    expect(res.body.data.stats.byChannel).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications/invoice/:invoiceId', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;

    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validEmailNotif, invoiceId });
  });

  it('should return notifications for invoice', async () => {
    const res = await request(app)
      .get(`/api/v1/notifications/invoice/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.length).toBe(1);
    expect(res.body.data.notifications[0].invoiceId).toBe(invoiceId);
  });

  it('should return 404 for non-existent invoice', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/invoice/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('INVOICE_NOT_FOUND');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/:id/cancel', () => {
  let token;
  let notificationId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const notif = await Notification.create({
      userId:    (await User.findOne({ email: ownerFixture.email }))._id,
      channel:   'email',
      type:      'payment_reminder',
      status:    'pending',
      recipient: { name: 'Test', email: 'test@test.com' },
      subject:   'Test subject',
      body:      'Test body',
    });
    notificationId = String(notif._id);
  });

  it('should cancel a pending notification', async () => {
    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notification.status).toBe('cancelled');
  });

  it('should reject cancelling an already sent notification', async () => {
    await Notification.findByIdAndUpdate(notificationId, { status: 'sent' });

    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/cancel`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOTIFICATION_CANNOT_BE_CANCELLED');
  });

  it('should reject cancelling another users notification', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .post(`/api/v1/notifications/${notificationId}/cancel`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RETRY NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/:id/retry', () => {
  let token;
  let notificationId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const notif = await Notification.create({
      userId:       (await User.findOne({ email: ownerFixture.email }))._id,
      channel:      'email',
      type:         'payment_reminder',
      status:       'failed',
      recipient:    { name: 'Test', email: 'test@test.com' },
      subject:      'Test subject',
      body:         'Test body',
      attemptCount: 1,
      maxAttempts:  3,
    });
    notificationId = String(notif._id);
  });

  it('should retry a failed notification', async () => {
    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('should reject retry on already delivered notification', async () => {
    await Notification.findByIdAndUpdate(notificationId, { status: 'sent' });

    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOTIFICATION_ALREADY_DELIVERED');
  });

  it('should reject retry on cancelled notification', async () => {
    await Notification.findByIdAndUpdate(notificationId, { status: 'cancelled' });

    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOTIFICATION_CANCELLED');
  });

  it('should reject retry when max attempts reached', async () => {
    await Notification.findByIdAndUpdate(notificationId, {
      attemptCount: 3,
      maxAttempts:  3,
    });

    const res = await request(app)
      .post(`/api/v1/notifications/${notificationId}/retry`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MAX_RETRIES_REACHED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin notification endpoints', () => {
  let ownerToken;
  let adminToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    adminToken = await signupAndLogin(agentFixture);
    await makeAdmin(agentFixture.email);
    adminToken = await signupAndLogin(agentFixture);

    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validEmailNotif);
  });

  it('should allow admin to list all notifications', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications).toBeDefined();
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should reject non-admin from admin endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/notifications/admin')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
  });

  it('should allow admin to run retry batch', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/retry-failed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchSize: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.processed).toBeDefined();
  });

  it('should reject invalid batch size', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/retry-failed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchSize: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BATCH_SIZE');
  });

  it('should reject non-admin from retry-failed endpoint', async () => {
    const res = await request(app)
      .post('/api/v1/notifications/retry-failed')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ batchSize: 10 });

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — DATA ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Security — Module E data isolation', () => {
  it('should never return another users notifications', async () => {
    const token1 = await signupAndLogin(ownerFixture);
    const token2 = await signupAndLogin(agentFixture);

    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token1}`)
      .send(validEmailNotif);

    await request(app)
      .post('/api/v1/notifications/send')
      .set('Authorization', `Bearer ${token2}`)
      .send({ ...validEmailNotif, recipient: { name: 'Other', email: 'other@example.com' } });

    const res1 = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token1}`);

    const res2 = await request(app)
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${token2}`);

    expect(res1.body.data.notifications.length).toBe(1);
    expect(res2.body.data.notifications.length).toBe(1);
    expect(res1.body.data.notifications[0].recipient.email).not.toBe(
      res2.body.data.notifications[0].recipient.email
    );
  });

  it('should reject all notification endpoints without token', async () => {
    const endpoints = [
      { method: 'get',  url: '/api/v1/notifications' },
      { method: 'post', url: '/api/v1/notifications/send' },
      { method: 'get',  url: '/api/v1/notifications/stats' },
      { method: 'get',  url: '/api/v1/notifications/delivery-stats' },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.url).send({});
      expect(res.status).toBe(401);
    }
  });
});



