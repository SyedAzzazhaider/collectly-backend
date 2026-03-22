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
const { Sequence } = require('../models/Sequence.model');
const Invoice  = require('../../customers/models/Invoice.model');
const Customer = require('../../customers/models/Customer.model');
const User     = require('../../auth/models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ownerFixture = {
  name: 'Sequence Owner', email: 'seqowner@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const agentFixture = {
  name: 'Agent User', email: 'seqagent@test.dev',
  password: 'SecurePass@123', confirmPassword: 'SecurePass@123', tosAccepted: true,
};

const validSequence = {
  name:        'Standard Collection Sequence',
  description: 'Default payment reminder escalation sequence',
  isDefault:   false,
  phases: [
    {
      phaseNumber:  1,
      phaseType:    'pre-due',
      reminderType: 'scheduled',
      isEnabled:    true,
      channels:     ['email'],
      messageTemplates: [
        {
          channel: 'email',
          subject: 'Upcoming Payment — Invoice #{{invoiceNumber}}',
          body:    'Dear {{customerName}}, your invoice #{{invoiceNumber}} for {{currency}} {{amount}} is due on {{dueDate}}.',
        },
      ],
      triggerRule: { daysOffset: -3, minAmount: null, maxAmount: null },
    },
    {
      phaseNumber:  2,
      phaseType:    'due-day',
      reminderType: 'scheduled',
      isEnabled:    true,
      channels:     ['email', 'sms'],
      messageTemplates: [
        {
          channel: 'email',
          subject: 'Payment Due Today — Invoice #{{invoiceNumber}}',
          body:    'Dear {{customerName}}, your invoice #{{invoiceNumber}} is due today.',
        },
      ],
      triggerRule: { daysOffset: 0 },
    },
    {
      phaseNumber:  3,
      phaseType:    'first-overdue',
      reminderType: 'scheduled',
      isEnabled:    true,
      channels:     ['email'],
      messageTemplates: [
        {
          channel: 'email',
          subject: 'Overdue Notice — Invoice #{{invoiceNumber}}',
          body:    'Dear {{customerName}}, invoice #{{invoiceNumber}} is now overdue.',
        },
      ],
      triggerRule: { daysOffset: 3 },
    },
    {
      phaseNumber:  4,
      phaseType:    'follow-up',
      reminderType: 'recurring',
      isEnabled:    true,
      channels:     ['email'],
      messageTemplates: [
        {
          channel: 'email',
          subject: 'Follow-up — Invoice #{{invoiceNumber}}',
          body:    'Dear {{customerName}}, this is a follow-up for invoice #{{invoiceNumber}}.',
        },
      ],
      triggerRule: { daysOffset: 7, repeatEveryDays: 3, maxRepeats: 3 },
    },
    {
      phaseNumber:  5,
      phaseType:    'final-notice',
      reminderType: 'immediate',
      isEnabled:    true,
      channels:     ['email'],
      messageTemplates: [
        {
          channel: 'email',
          subject: 'Final Notice — Invoice #{{invoiceNumber}}',
          body:    'Dear {{customerName}}, this is your final notice for invoice #{{invoiceNumber}}.',
        },
      ],
      triggerRule: { daysOffset: 14 },
    },
  ],
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
  const custRes = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Test Customer', email: `testcust_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
      phone: '+1234567890', company: 'Test Co',
    });

  const customerId = custRes.body.data.customer._id;

  const invRes = await request(app)
    .post('/api/v1/invoices')
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      invoiceNumber: `INV-${Date.now()}`,
      amount:        1000,
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
// CREATE SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/sequences', () => {
  let token;
  beforeEach(async () => { token = await signupAndLogin(ownerFixture); });

  it('should create a sequence with all 5 phases', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.sequence.name).toBe(validSequence.name);
    expect(res.body.data.sequence.phases.length).toBe(5);
  });

  it('should create a sequence with partial phases', async () => {
    const partial = { ...validSequence, phases: [validSequence.phases[0]] };
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(partial);

    expect(res.status).toBe(201);
    expect(res.body.data.sequence.phases.length).toBe(1);
  });

  it('should store userId on sequence', async () => {
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);

    const user = await User.findOne({ email: ownerFixture.email });
    const seq  = await Sequence.findOne({ name: validSequence.name });
    expect(String(seq.userId)).toBe(String(user._id));
  });

  it('should reject duplicate sequence name for same user', async () => {
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);

    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_SEQUENCE_NAME');
  });

  it('should allow same sequence name for different users', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);

    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token2}`)
      .send(validSequence);

    expect(res.status).toBe(201);
  });

  it('should reject missing sequence name', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, name: '' });

    expect(res.status).toBe(422);
  });

  it('should reject sequence with no phases', async () => {
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: [] });

    expect(res.status).toBe(422);
  });

  it('should reject more than 5 phases', async () => {
    const tooManyPhases = [...validSequence.phases, { ...validSequence.phases[0], phaseNumber: 6 }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: tooManyPhases });

    expect(res.status).toBe(422);
  });

  it('should reject invalid phase type', async () => {
    const badPhases = [{ ...validSequence.phases[0], phaseType: 'nuclear-option' }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: badPhases });

    expect(res.status).toBe(422);
  });

  it('should reject invalid reminder type', async () => {
    const badPhases = [{ ...validSequence.phases[0], reminderType: 'teleport' }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: badPhases });

    expect(res.status).toBe(422);
  });

  it('should reject invalid channel', async () => {
    const badPhases = [{ ...validSequence.phases[0], channels: ['fax'] }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: badPhases });

    expect(res.status).toBe(422);
  });

  it('should reject phase with missing triggerRule', async () => {
    const badPhases = [{ ...validSequence.phases[0], triggerRule: undefined }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: badPhases });

    expect(res.status).toBe(422);
  });

  it('should reject duplicate phase numbers', async () => {
    const dupPhases = [validSequence.phases[0], { ...validSequence.phases[1], phaseNumber: 1 }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: dupPhases });

    expect(res.status).toBe(422);
  });

  it('should reject duplicate phase types', async () => {
    const dupTypes = [validSequence.phases[0], { ...validSequence.phases[1], phaseType: 'pre-due' }];
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, phases: dupTypes });

    expect(res.status).toBe(422);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).post('/api/v1/sequences').send(validSequence);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SEQUENCES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/sequences', () => {
  let token;
  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
  });

  it('should return list of sequences', async () => {
    const res = await request(app)
      .get('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequences.length).toBe(1);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should only return sequences belonging to authenticated user', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token2}`)
      .send({ ...validSequence, name: 'Agent Sequence' });

    const res = await request(app)
      .get('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.sequences.length).toBe(1);
    expect(res.body.data.sequences[0].name).toBe(validSequence.name);
  });

  it('should search sequences by name', async () => {
    const res = await request(app)
      .get('/api/v1/sequences?search=Standard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequences.length).toBe(1);
  });

  it('should return empty for no match', async () => {
    const res = await request(app)
      .get('/api/v1/sequences?search=NoMatch')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.sequences.length).toBe(0);
  });

  it('should support pagination', async () => {
    const res = await request(app)
      .get('/api/v1/sequences?page=1&limit=5')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.limit).toBe(5);
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app).get('/api/v1/sequences');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/sequences/:id', () => {
  let token;
  let sequenceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = res.body.data.sequence._id;
  });

  it('should return sequence by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequence._id).toBe(sequenceId);
    expect(res.body.data.sequence.phases.length).toBe(5);
  });

  it('should return 404 for non-existent sequence', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('SEQUENCE_NOT_FOUND');
  });

  it('should not return another users sequence', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .get(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/sequences/:id', () => {
  let token;
  let sequenceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = res.body.data.sequence._id;
  });

  it('should update sequence name', async () => {
    const res = await request(app)
      .patch(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Sequence Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.sequence.name).toBe('Updated Sequence Name');
  });

  it('should deactivate a sequence', async () => {
    const res = await request(app)
      .patch(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.sequence.isActive).toBe(false);
  });

  it('should set sequence as default', async () => {
    const res = await request(app)
      .patch(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isDefault: true });

    expect(res.status).toBe(200);
    expect(res.body.data.sequence.isDefault).toBe(true);
  });

  it('should reject invalid isActive type', async () => {
    const res = await request(app)
      .patch(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: 'yes' });

    expect(res.status).toBe(422);
  });

  it('should return 404 for non-existent sequence', async () => {
    const res = await request(app)
      .patch('/api/v1/sequences/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/sequences/:id', () => {
  let token;
  let sequenceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = res.body.data.sequence._id;
  });

  it('should delete a sequence with no active invoices', async () => {
    const res = await request(app)
      .delete(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    const found = await Sequence.findById(sequenceId);
    expect(found).toBeNull();
  });

  it('should reject deletion when sequence has active invoices', async () => {
    await Sequence.findByIdAndUpdate(sequenceId, { activeInvoiceCount: 2 });

    const res = await request(app)
      .delete(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEQUENCE_HAS_ACTIVE_INVOICES');
  });

  it('should reject non-owner from deleting sequence', async () => {
    const token2 = await signupAndLogin(agentFixture);
    await User.findOneAndUpdate({ email: agentFixture.email }, { role: 'agent' });

    const res = await request(app)
      .delete(`/api/v1/sequences/${sequenceId}`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(403);
  });

  it('should reject unauthenticated delete', async () => {
    const res = await request(app).delete(`/api/v1/sequences/${sequenceId}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/sequences/:id/duplicate', () => {
  let token;
  let sequenceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = res.body.data.sequence._id;
  });

  it('should duplicate a sequence', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/${sequenceId}/duplicate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(201);
    expect(res.body.data.sequence.name).toContain('Copy');
    expect(res.body.data.sequence.phases.length).toBe(5);
    expect(res.body.data.sequence.isDefault).toBe(false);
  });

  it('should not duplicate another users sequence', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .post(`/api/v1/sequences/${sequenceId}/duplicate`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET DEFAULT SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/sequences/default', () => {
  let token;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
  });

  it('should return null when no default is set', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/default')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequence).toBeNull();
  });

  it('should return default sequence when set', async () => {
    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, isDefault: true });

    const res = await request(app)
      .get('/api/v1/sequences/default')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequence.isDefault).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGN & UNASSIGN SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/sequences/assign', () => {
  let token;
  let sequenceId;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = seqRes.body.data.sequence._id;

    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
  });

  it('should assign a sequence to an invoice', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId, invoiceId });

    expect(res.status).toBe(200);
    expect(res.body.data.invoice).toBeDefined();
    expect(res.body.data.sequence).toBeDefined();
  });

  it('should set nextReminderAt on invoice after assignment', async () => {
    await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId, invoiceId });

    const invoice = await Invoice.findById(invoiceId);
    expect(invoice.sequenceId).toBeDefined();
    expect(invoice.sequenceAssignedAt).toBeDefined();
  });

  it('should reject assignment with missing sequenceId', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId });

    expect(res.status).toBe(422);
  });

  it('should reject assignment with missing invoiceId', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId });

    expect(res.status).toBe(422);
  });

  it('should reject assignment of another users sequence', async () => {
    const token2 = await signupAndLogin(agentFixture);
    const res    = await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token2}`)
      .send({ sequenceId, invoiceId });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/sequences/unassign', () => {
  let token;
  let sequenceId;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = seqRes.body.data.sequence._id;
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
    await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId, invoiceId });
  });

  it('should unassign sequence from invoice', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/unassign')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId });

    expect(res.status).toBe(200);
    const invoice = await Invoice.findById(invoiceId);
    expect(invoice.sequenceId).toBeNull();
  });

  it('should reject unassign without invoiceId', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/unassign')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_INVOICE_ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PAUSE & RESUME
// ─────────────────────────────────────────────────────────────────────────────

describe('Pause and resume sequence on invoice', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    const sequenceId = seqRes.body.data.sequence._id;
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
    await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId, invoiceId });
  });

  it('should pause sequence on invoice', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const invoice = await Invoice.findById(invoiceId);
    expect(invoice.sequencePaused).toBe(true);
  });

  it('should resume paused sequence on invoice', async () => {
    await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/pause`)
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/resume`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const invoice = await Invoice.findById(invoiceId);
    expect(invoice.sequencePaused).toBe(false);
  });

  it('should reject resume on non-paused invoice', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/resume`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('SEQUENCE_NOT_PAUSED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SEQUENCE PROGRESS & HISTORY
// ─────────────────────────────────────────────────────────────────────────────

describe('Sequence progress and reminder history', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    const sequenceId = seqRes.body.data.sequence._id;
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
    await request(app)
      .post('/api/v1/sequences/assign')
      .set('Authorization', `Bearer ${token}`)
      .send({ sequenceId, invoiceId });
  });

  it('should return sequence progress for invoice', async () => {
    const res = await request(app)
      .get(`/api/v1/sequences/invoice/${invoiceId}/progress`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasSequence).toBe(true);
    expect(res.body.data.totalPhases).toBe(5);
    expect(res.body.data.phases).toBeDefined();
  });

  it('should return reminder history for invoice', async () => {
    const res = await request(app)
      .get(`/api/v1/sequences/invoice/${invoiceId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.history)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should return no-sequence state when no sequence assigned', async () => {
    const { invoiceId: invId2 } = await createCustomerAndInvoice(token);
    const res = await request(app)
      .get(`/api/v1/sequences/invoice/${invId2}/progress`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.hasSequence).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMMEDIATE REMINDER
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/sequences/invoice/:invoiceId/remind', () => {
  let token;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
  });

  it('should dispatch an immediate reminder', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/remind`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channels: ['email'], phaseType: 'first-overdue' });

    expect(res.status).toBe(200);
    expect(res.body.data.dispatched).toBe(true);
    expect(res.body.data.reminderType).toBe('immediate');
  });

  it('should update remindersSent count after immediate reminder', async () => {
    await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/remind`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channels: ['email'] });

    const invoice = await Invoice.findById(invoiceId);
    expect(invoice.remindersSent).toBe(1);
  });

  it('should reject reminder for paid invoice', async () => {
    await Invoice.findByIdAndUpdate(invoiceId, { status: 'paid', amountPaid: 1000 });

    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/remind`)
      .set('Authorization', `Bearer ${token}`)
      .send({ channels: ['email'] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVOICE_NOT_ELIGIBLE');
  });

  it('should reject unauthenticated request', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/invoice/${invoiceId}/remind`)
      .send({ channels: ['email'] });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW SCHEDULE
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/sequences/:id/preview', () => {
  let token;
  let sequenceId;
  let invoiceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = seqRes.body.data.sequence._id;
    const { invoiceId: invId } = await createCustomerAndInvoice(token);
    invoiceId = invId;
  });

  it('should return schedule preview', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/${sequenceId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId });

    expect(res.status).toBe(200);
    expect(res.body.data.schedule).toBeDefined();
    expect(Array.isArray(res.body.data.schedule)).toBe(true);
    expect(res.body.data.schedule.length).toBe(5);
  });

  it('should include trigger dates in preview', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/${sequenceId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId });

    res.body.data.schedule.forEach((phase) => {
      expect(phase.triggerDate).toBeDefined();
      expect(phase.phaseType).toBeDefined();
      expect(phase.channels).toBeDefined();
    });
  });

  it('should reject preview without invoiceId', async () => {
    const res = await request(app)
      .post(`/api/v1/sequences/${sequenceId}/preview`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_INVOICE_ID');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE DETAILS
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/sequences/:id/phases/:phaseNumber', () => {
  let token;
  let sequenceId;

  beforeEach(async () => {
    token = await signupAndLogin(ownerFixture);
    const res = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send(validSequence);
    sequenceId = res.body.data.sequence._id;
  });

  it('should return phase 1 details', async () => {
    const res = await request(app)
      .get(`/api/v1/sequences/${sequenceId}/phases/1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.phase.phaseNumber).toBe(1);
    expect(res.body.data.phase.phaseType).toBe('pre-due');
  });

  it('should return 404 for non-existent phase', async () => {
    const seqRes = await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...validSequence, name: 'Single Phase Seq', phases: [validSequence.phases[0]] });

    const res = await request(app)
      .get(`/api/v1/sequences/${seqRes.body.data.sequence._id}/phases/5`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PHASE_NOT_FOUND');
  });

  it('should reject invalid phase number', async () => {
    const res = await request(app)
      .get(`/api/v1/sequences/${sequenceId}/phases/9`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_PHASE_NUMBER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────────────────────

describe('Admin sequence endpoints', () => {
  let ownerToken;
  let adminToken;

  beforeEach(async () => {
    ownerToken = await signupAndLogin(ownerFixture);
    adminToken = await signupAndLogin(agentFixture);
    await makeAdmin(agentFixture.email);
    adminToken = await signupAndLogin(agentFixture);

    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(validSequence);
  });

  it('should allow admin to list all sequences', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/admin')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.sequences).toBeDefined();
    expect(res.body.data.pagination).toBeDefined();
  });

  it('should reject non-admin from admin endpoint', async () => {
    const res = await request(app)
      .get('/api/v1/sequences/admin')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
  });

  it('should allow admin to run reminder batch', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/batch/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchSize: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeDefined();
  });

  it('should reject invalid batch size', async () => {
    const res = await request(app)
      .post('/api/v1/sequences/batch/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batchSize: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_BATCH_SIZE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────────────────────────────────────

describe('Security — Module D data isolation', () => {
  it('should never return another users sequences', async () => {
    const token1 = await signupAndLogin(ownerFixture);
    const token2 = await signupAndLogin(agentFixture);

    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token1}`)
      .send(validSequence);

    await request(app)
      .post('/api/v1/sequences')
      .set('Authorization', `Bearer ${token2}`)
      .send({ ...validSequence, name: 'Agent Sequence' });

    const res1 = await request(app).get('/api/v1/sequences').set('Authorization', `Bearer ${token1}`);
    const res2 = await request(app).get('/api/v1/sequences').set('Authorization', `Bearer ${token2}`);

    expect(res1.body.data.sequences.length).toBe(1);
    expect(res2.body.data.sequences.length).toBe(1);
    expect(res1.body.data.sequences[0].name).not.toBe(res2.body.data.sequences[0].name);
  });

  it('should reject all sequence endpoints without token', async () => {
    const endpoints = [
      { method: 'get',    url: '/api/v1/sequences' },
      { method: 'post',   url: '/api/v1/sequences' },
      { method: 'get',    url: '/api/v1/sequences/default' },
      { method: 'post',   url: '/api/v1/sequences/assign' },
    ];

    for (const ep of endpoints) {
      const res = await request(app)[ep.method](ep.url).send({});
      expect(res.status).toBe(401);
    }
  });
});

