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
// No Stripe key set — runs in non-Stripe mode for tests

const request  = require('supertest');
const app      = require('../../../../app');
const { Billing } = require('../models/Billing.model');
const User     = require('../../auth/models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerUser = {
  name:            'Billing Owner',
  email:           'billing@collectly.dev',
  password:        'SecurePass@123',
  confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const adminUser = {
  name:            'Admin User',
  email:           'admin@collectly.dev',
  password:        'SecurePass@123',
  confirmPassword: 'SecurePass@123', tosAccepted: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const signupAndLogin = async (userData) => {
  await request(app).post('/api/v1/auth/signup').send(userData);
  const res = await request(app).post('/api/v1/auth/login').send({
    email:    userData.email,
    password: userData.password,
  });
  return res.body.data.accessToken;
};

const makeAdmin = async (email) => {
  await User.findOneAndUpdate({ email }, { role: 'admin' });
};

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// PLANS — PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing/plans', () => {
  it('should return all plans without authentication', async () => {
    const res = await request(app).get('/api/v1/billing/plans');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.data.plans)).toBe(true);
    expect(res.body.data.plans.length).toBe(3);
  });

  it('should include starter, pro, and enterprise plans', async () => {
    const res   = await request(app).get('/api/v1/billing/plans');
    const plans = res.body.data.plans;
    const ids   = plans.map((p) => p.id);
    expect(ids).toContain('starter');
    expect(ids).toContain('pro');
    expect(ids).toContain('enterprise');
  });

  it('should include correct channel configuration per plan', async () => {
    const res     = await request(app).get('/api/v1/billing/plans');
    const plans   = res.body.data.plans;
    const starter = plans.find((p) => p.id === 'starter');
    const pro     = plans.find((p) => p.id === 'pro');
    const ent     = plans.find((p) => p.id === 'enterprise');

    expect(starter.channels).toEqual(['email']);
    expect(pro.channels).toContain('email');
    expect(pro.channels).toContain('sms');
    expect(ent.channels).toContain('whatsapp');
  });

  it('should show correct credit limits per plan', async () => {
    const res     = await request(app).get('/api/v1/billing/plans');
    const plans   = res.body.data.plans;
    const starter = plans.find((p) => p.id === 'starter');
    const pro     = plans.find((p) => p.id === 'pro');
    const ent     = plans.find((p) => p.id === 'enterprise');

    expect(starter.credits).toBe(500);
    expect(pro.credits).toBe(2000);
    expect(ent.credits).toBe('Unlimited');
  });

  it('should show API access only for enterprise plan', async () => {
    const res   = await request(app).get('/api/v1/billing/plans');
    const plans = res.body.data.plans;
    const ent   = plans.find((p) => p.id === 'enterprise');
    const pro   = plans.find((p) => p.id === 'pro');

    expect(ent.apiAccess).toBe(true);
    expect(pro.apiAccess).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET BILLING RECORD
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
  });

  it('should return billing record for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billing).toBeDefined();
    expect(res.body.data.billing.plan).toBe('starter');
  });

  it('should auto-initialize billing record if not exists', async () => {
    const res = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billing.usage).toBeDefined();
    expect(res.body.data.billing.usage.creditsUsed).toBe(0);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/billing');
    expect(res.status).toBe(401);
  });

  it('should never expose Stripe IDs in response', async () => {
    const res = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.billing.stripeCustomerId).toBeUndefined();
    expect(res.body.data.billing.stripeSubscriptionId).toBeUndefined();
    expect(res.body.data.billing.stripePriceId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIBE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/billing/subscribe', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
  });

  it('should subscribe to pro plan successfully', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.plan).toBe('pro');
    expect(res.body.data.billing.status).toBe('active');
  });

  it('should subscribe to enterprise plan successfully', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise' });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.plan).toBe('enterprise');
  });

  it('should subscribe to starter plan successfully', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'starter' });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.plan).toBe('starter');
  });

  it('should reject invalid plan name', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'ultimate' });

    expect(res.status).toBe(422);
  });

  it('should reject missing plan field', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(422);
  });

  it('should reject duplicate active subscription to same plan', async () => {
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('should reset usage counters on subscription', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    expect(res.body.data.billing.usage.creditsUsed).toBe(0);
    expect(res.body.data.billing.usage.emailsSent).toBe(0);
  });

  it('should sync plan on User document after subscription', async () => {
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise' });

    const user = await User.findOne({ email: ownerUser.email });
    expect(user.subscriptionPlan).toBe('enterprise');
  });

  it('should reject unauthenticated subscribe request', async () => {
    const res = await request(app)
      .post('/api/v1/billing/subscribe')
      .send({ plan: 'pro' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PLAN
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/billing/plan', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'starter' });
  });

  it('should upgrade from starter to pro', async () => {
    const res = await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.plan).toBe('pro');
  });

  it('should upgrade from pro to enterprise', async () => {
    await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    const res = await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise' });

    expect(res.status).toBe(200);
    expect(res.body.data.billing.plan).toBe('enterprise');
  });

  it('should reject change to same plan', async () => {
    const res = await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SAME_PLAN');
  });

  it('should reject invalid plan on change', async () => {
    const res = await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'diamond' });

    expect(res.status).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL & REACTIVATE
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/billing/cancel', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
  });

  it('should schedule cancellation at period end', async () => {
    const res = await request(app)
      .delete('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billing.cancelAtPeriodEnd).toBe(true);
  });

  it('should reject cancellation of inactive subscription', async () => {
    // Cancel first
    await request(app)
      .delete('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${token}`);

    // Force status to cancelled
    await Billing.findOneAndUpdate(
      { },
      { status: 'cancelled' }
    );

    const res = await request(app)
      .delete('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('should reject unauthenticated cancel request', async () => {
    const res = await request(app).delete('/api/v1/billing/cancel');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/billing/reactivate', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
    await request(app)
      .delete('/api/v1/billing/cancel')
      .set('Authorization', `Bearer ${token}`);
  });

  it('should reactivate a scheduled cancellation', async () => {
    const res = await request(app)
      .post('/api/v1/billing/reactivate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.billing.cancelAtPeriodEnd).toBe(false);
  });

  it('should reject reactivation when not scheduled for cancellation', async () => {
    // Reactivate once
    await request(app)
      .post('/api/v1/billing/reactivate')
      .set('Authorization', `Bearer ${token}`);

    // Try again — should fail
    const res = await request(app)
      .post('/api/v1/billing/reactivate')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOT_CANCELLED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USAGE METRICS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing/usage', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
  });

  it('should return usage metrics for active subscription', async () => {
    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.usage.credits).toBeDefined();
    expect(res.body.data.usage.channels).toBeDefined();
    expect(res.body.data.usage.period).toBeDefined();
  });

  it('should show correct credit total for pro plan', async () => {
    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.usage.credits.total).toBe(2000);
    expect(res.body.data.usage.credits.used).toBe(0);
    expect(res.body.data.usage.credits.remaining).toBe(2000);
  });

  it('should show Unlimited credits for enterprise plan', async () => {
    await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise' });

    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.usage.credits.total).toBe('Unlimited');
    expect(res.body.data.usage.credits.remaining).toBe('Unlimited');
  });

  it('should show allowed channels for plan', async () => {
    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.usage.allowedChannels).toContain('email');
    expect(res.body.data.usage.allowedChannels).toContain('sms');
  });

  it('should reject unauthenticated usage request', async () => {
    const res = await request(app).get('/api/v1/billing/usage');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INCREMENT USAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/billing/usage/increment', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });
  });

  it('should increment email usage successfully', async () => {
    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 5 });

    expect(res.status).toBe(200);
    expect(res.body.data.creditsUsed).toBe(5);
    expect(res.body.data.creditsRemaining).toBe(1995);
  });

  it('should increment SMS usage on pro plan', async () => {
    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'sms', count: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.creditsUsed).toBe(10);
  });

  it('should reject WhatsApp usage on pro plan (not included)', async () => {
    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'whatsapp', count: 1 });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CHANNEL_NOT_ALLOWED');
  });

  it('should reject increment when credits exhausted', async () => {
    // Exhaust credits by incrementing 2000 (pro plan limit)
    await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 1000 });

    await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 1000 });

    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 1 });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('INSUFFICIENT_CREDITS');
  });

  it('should reject invalid channel', async () => {
    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'telegram', count: 1 });

    expect(res.status).toBe(422);
  });

  it('should reject invalid count value', async () => {
    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: -5 });

    expect(res.status).toBe(422);
  });

  it('should allow unlimited usage on enterprise plan', async () => {
    await request(app)
      .patch('/api/v1/billing/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise' });

    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'whatsapp', count: 1000 });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE HISTORY
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing/invoices', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
  });

  it('should return invoice history for authenticated user', async () => {
    const res = await request(app)
      .get('/api/v1/billing/invoices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.invoices)).toBe(true);
  });

  it('should reject unauthenticated invoice request', async () => {
    const res = await request(app).get('/api/v1/billing/invoices');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/billing/admin', () => {
  let ownerToken;
  let adminToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerUser);
    adminToken = await signupAndLogin(adminUser);
    await makeAdmin(adminUser.email);
    // Re-login to get token with admin role reflected
    adminToken = await signupAndLogin(adminUser);
  });

  it('should allow admin to list all billing records', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.records).toBeDefined();
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should reject non-admin access to admin endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('should reject unauthenticated admin request', async () => {
    const res = await request(app).get('/api/v1/billing/admin');
    expect(res.status).toBe(401);
  });

  it('should support pagination parameters', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.limit).toBe(5);
    expect(res.body.data.pagination.page).toBe(1);
  });

  it('should filter billing records by plan', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin?plan=starter')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });

  it('should reject invalid pagination parameters', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin?page=0&limit=0')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PAGINATION');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Security — billing module hardening', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerUser);
  });

  it('should never expose Stripe secrets in billing response', async () => {
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro' });

    const res = await request(app)
      .get('/api/v1/billing')
      .set('Authorization', `Bearer ${token}`);

    const billing = res.body.data.billing;
    expect(billing.stripeCustomerId).toBeUndefined();
    expect(billing.stripeSubscriptionId).toBeUndefined();
    expect(billing.stripePriceId).toBeUndefined();
    expect(billing.invoiceHistory).toBeUndefined();
  });

  it('should reject accessing another users billing via admin without admin role', async () => {
    const res = await request(app)
      .get('/api/v1/billing/admin')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('should enforce channel restrictions per plan', async () => {
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'starter' });

    // Starter plan — only email allowed
    const smsRes = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'sms', count: 1 });

    expect(smsRes.status).toBe(403);
    expect(smsRes.body.code).toBe('CHANNEL_NOT_ALLOWED');

    const emailRes = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 1 });

    expect(emailRes.status).toBe(200);
  });

  it('should enforce credit cap on starter plan', async () => {
    await request(app)
      .post('/api/v1/billing/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'starter' });

    // Use all 500 credits
    await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 500 });

    const res = await request(app)
      .post('/api/v1/billing/usage/increment')
      .set('Authorization', `Bearer ${token}`)
      .send({ channel: 'email', count: 1 });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('INSUFFICIENT_CREDITS');
  });
});



