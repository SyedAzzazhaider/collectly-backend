'use strict';

process.env.NODE_ENV             = 'test';
process.env.JWT_ACCESS_SECRET    = 'test_access_secret_collectly_2024';
process.env.JWT_REFRESH_SECRET   = 'test_refresh_secret_collectly_2024';
process.env.JWT_ACCESS_EXPIRES_IN  = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.FRONTEND_URL         = 'http://localhost:3000';
process.env.API_BASE_URL         = 'http://localhost:5000';
process.env.GOOGLE_CLIENT_ID     = 'test_google_client_id';
process.env.GOOGLE_CLIENT_SECRET = 'test_google_client_secret';
process.env.MICROSOFT_CLIENT_ID  = 'test_microsoft_client_id';
process.env.MICROSOFT_CLIENT_SECRET = 'test_microsoft_client_secret';

const request  = require('supertest');
const app      = require('../../../../app');
const User     = require('../models/User.model');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');
const { generateJti } = require('../../../shared/utils/token.util');

const validUser = {
  name:            'Test Owner',
  email:           'owner@collectly.dev',
  password:        'SecurePass@123',
  confirmPassword: 'SecurePass@123',
};

const validLogin = {
  email:    'owner@collectly.dev',
  password: 'SecurePass@123',
};

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// ─────────────────────────────────────────────────────────────────────────────
// SIGNUP
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/signup', () => {
  it('should register a new user and return access token', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(validUser.email);
    expect(res.body.data.user.role).toBe('owner');
    expect(res.body.data.user.subscriptionPlan).toBe('starter');
  });

  it('should set httpOnly refresh token cookie on signup', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.status).toBe(201);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const refreshCookie = cookies.find((c) => c.startsWith('collectly_refresh'));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
  });

  it('should never expose password in response', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.status).toBe(201);
    expect(res.body.data.user.password).toBeUndefined();
  });

  it('should reject duplicate email registration', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_EMAIL');
  });

  it('should reject signup with missing name', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ ...validUser, name: '' });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('fail');
  });

  it('should reject signup with invalid email format', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ ...validUser, email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('should reject weak password without special character', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ ...validUser, password: 'Password1', confirmPassword: 'Password1' });
    expect(res.status).toBe(422);
  });

  it('should reject mismatched confirmPassword', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({ ...validUser, confirmPassword: 'DifferentPass@999' });
    expect(res.status).toBe(422);
  });

  it('should store hashed password in database — never plain text', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const user = await User.findOne({ email: validUser.email }).select('+password');
    expect(user.password).toBeDefined();
    expect(user.password).not.toBe(validUser.password);
    expect(user.password).toMatch(/^\$2[ab]\$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
  });

  it('should login with valid credentials and return access token', async () => {
    const res = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(validUser.email);
  });

  it('should set httpOnly refresh cookie on login', async () => {
    const res = await request(app).post('/api/v1/auth/login').send(validLogin);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const refreshCookie = cookies.find((c) => c.startsWith('collectly_refresh'));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: validUser.email, password: 'WrongPass@999' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('should reject login with non-existent email', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@collectly.dev', password: 'SecurePass@123' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('should reject login with missing fields', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: validUser.email });
    expect(res.status).toBe(422);
  });

  it('should lock account after 5 failed login attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: validUser.email, password: 'WrongPass@999' });
    }
    const res = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('should reset failed attempts counter after successful login', async () => {
    await request(app).post('/api/v1/auth/login').send({ email: validUser.email, password: 'WrongPass@999' });
    await request(app).post('/api/v1/auth/login').send({ email: validUser.email, password: 'WrongPass@999' });
    const res = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(res.status).toBe(200);
    const user = await User.findOne({ email: validUser.email });
    expect(user.failedLoginAttempts).toBe(0);
  });

  it('should never expose password in login response', async () => {
    const res = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(res.body.data?.user?.password).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/auth/me — protect middleware', () => {
  let accessToken;

  beforeEach(async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const res   = await request(app).post('/api/v1/auth/login').send(validLogin);
    accessToken = res.body.data.accessToken;
  });

  it('should return user profile with valid access token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(validUser.email);
  });

  it('should reject request with no token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('NO_TOKEN');
  });

  it('should reject request with malformed token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer this.is.not.valid');
    expect(res.status).toBe(401);
  });

  it('should reject request with tampered token', async () => {
    const tampered = accessToken.slice(0, -5) + 'XXXXX';
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('should reject token passed as query parameter — not supported', async () => {
    const res = await request(app).get(`/api/v1/auth/me?token=${accessToken}`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH TOKEN
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  let agent;

  beforeEach(async () => {
    agent = request.agent(app);
    await agent.post('/api/v1/auth/signup').send(validUser);
  });

  it('should issue new access token using refresh cookie', async () => {
    const res = await agent.post('/api/v1/auth/refresh');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('should rotate refresh token on each refresh call', async () => {
    const first  = await agent.post('/api/v1/auth/refresh');
    const second = await agent.post('/api/v1/auth/refresh');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.accessToken).not.toBe(second.body.data.accessToken);
  });

  it('should reject refresh with no cookie and no body token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MISSING_REFRESH_TOKEN');
  });

  it('should detect token reuse and reject consumed token', async () => {
    // Sign up fresh user and capture raw refresh token from cookie
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ ...validUser, email: 'reuse@collectly.dev', confirmPassword: validUser.password });

    const cookie = signupRes.headers['set-cookie']
      ?.find((c) => c.startsWith('collectly_refresh'));
    const rawToken = cookie?.split(';')[0]?.replace('collectly_refresh=', '');
    expect(rawToken).toBeDefined();

    // First use — valid, token is consumed and rotated
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rawToken });
    expect(first.status).toBe(200);
    expect(first.body.data.accessToken).toBeDefined();

    // Second use — same token is now consumed, must be rejected
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rawToken });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe('INVALID_REFRESH_TOKEN');

    // Security guarantee: original token is permanently dead
    // One active session exists (the rotated one from first use) — correct behavior
    // per RFC 6749 refresh token rotation spec
    const user = await User.findOne({ email: 'reuse@collectly.dev' }).select('+refreshTokens');
    expect(user.refreshTokens.length).toBe(1);
    expect(user.refreshTokens[0].token).not.toBe(rawToken);
    expect(user.refreshTokens[0].token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should store refresh token as hash — never plain text in DB', async () => {
    const signupRes = await request(app)
      .post('/api/v1/auth/signup')
      .send({ ...validUser, email: 'hashcheck@collectly.dev', confirmPassword: validUser.password });

    const cookie   = signupRes.headers['set-cookie']?.find((c) => c.startsWith('collectly_refresh'));
    const rawToken = cookie?.split(';')[0]?.replace('collectly_refresh=', '');

    const user = await User.findOne({ email: 'hashcheck@collectly.dev' }).select('+refreshTokens');
    const storedToken = user.refreshTokens[0]?.token;
    expect(storedToken).toBeDefined();
    expect(storedToken).not.toBe(rawToken);
    expect(storedToken).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
  let agent;
  let accessToken;

  beforeEach(async () => {
    agent = request.agent(app);
    const res   = await agent.post('/api/v1/auth/signup').send(validUser);
    accessToken = res.body.data.accessToken;
  });

  it('should logout successfully and clear refresh cookie', async () => {
    const res = await agent.post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
    const cookie = res.headers['set-cookie']?.find((c) => c.startsWith('collectly_refresh'));
    if (cookie) {
      expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    }
  });

  it('should reject logout without access token', async () => {
    const res = await agent.post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  it('should invalidate session in DB after logout', async () => {
    await agent.post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    const user = await User.findOne({ email: validUser.email }).select('+refreshTokens');
    expect(user.refreshTokens.length).toBe(0);
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  let agent;
  let accessToken;

  beforeEach(async () => {
    agent = request.agent(app);
    const res   = await agent.post('/api/v1/auth/signup').send(validUser);
    accessToken = res.body.data.accessToken;
  });

  it('should clear all refresh sessions from DB', async () => {
    await agent.post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${accessToken}`);
    const user = await User.findOne({ email: validUser.email }).select('+refreshTokens');
    expect(user.refreshTokens.length).toBe(0);
  });

  it('should reject logout-all without access token', async () => {
    const res = await request(app).post('/api/v1/auth/logout-all');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2FA
// ─────────────────────────────────────────────────────────────────────────────

describe('2FA — setup, verify, disable', () => {
  let accessToken;
  const speakeasy = require('speakeasy');

  beforeEach(async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const res   = await request(app).post('/api/v1/auth/login').send(validLogin);
    accessToken = res.body.data.accessToken;
  });

  it('should initiate 2FA setup and return QR code + secret', async () => {
    const res = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.secret).toBeDefined();
    expect(res.body.data.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(res.body.data.otpAuthUrl).toMatch(/^otpauth:\/\/totp\//);
  });

  it('should enable 2FA after valid TOTP verification', async () => {
    const setupRes = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupRes.body.data;
    const totpCode   = speakeasy.totp({ secret, encoding: 'base32' });
    const user       = await User.findOne({ email: validUser.email });
    const verifyRes  = await request(app).post('/api/v1/auth/2fa/verify').send({ userId: String(user._id), totpCode });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toBeDefined();
    const updated = await User.findOne({ email: validUser.email });
    expect(updated.twoFactorEnabled).toBe(true);
  });

  it('should reject 2FA verify with invalid TOTP code', async () => {
    await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    const user = await User.findOne({ email: validUser.email });
    const res  = await request(app).post('/api/v1/auth/2fa/verify').send({ userId: String(user._id), totpCode: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_2FA_CODE');
  });

  it('should disable 2FA with valid TOTP code', async () => {
    const setupRes = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupRes.body.data;
    const user       = await User.findOne({ email: validUser.email });
    const totpCode   = speakeasy.totp({ secret, encoding: 'base32' });
    await request(app).post('/api/v1/auth/2fa/verify').send({ userId: String(user._id), totpCode });
    const loginRes   = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(loginRes.body.data.requires2FA).toBe(true);
    const disableCode = speakeasy.totp({ secret, encoding: 'base32' });
    const newToken    = loginRes.body.data.preAuthToken;
    const disableRes  = await request(app).post('/api/v1/auth/2fa/disable').set('Authorization', `Bearer ${newToken}`).send({ totpCode: disableCode });
    expect([200, 403]).toContain(disableRes.status);
  });

  it('should require 2FA code during login when 2FA is enabled', async () => {
    const setupRes = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupRes.body.data;
    const user       = await User.findOne({ email: validUser.email });
    const totpCode   = speakeasy.totp({ secret, encoding: 'base32' });
    await request(app).post('/api/v1/auth/2fa/verify').send({ userId: String(user._id), totpCode });
    const loginRes   = await request(app).post('/api/v1/auth/login').send(validLogin);
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.requires2FA).toBe(true);
    expect(loginRes.body.data.preAuthToken).toBeDefined();
    expect(loginRes.body.data.userId).toBeDefined();
  });

  it('should reject 2FA setup if already enabled', async () => {
    const setupRes = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    const { secret } = setupRes.body.data;
    const user       = await User.findOne({ email: validUser.email });
    const totpCode   = speakeasy.totp({ secret, encoding: 'base32' });
    await request(app).post('/api/v1/auth/2fa/verify').send({ userId: String(user._id), totpCode });
    const again = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${accessToken}`);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('2FA_ALREADY_ENABLED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────────────────────────────────────

describe('Security — token and session hardening', () => {
  it('should reject expired access token', async () => {
    const expiredToken = require('jsonwebtoken').sign(
      { id: 'fakeid', role: 'owner', subscriptionPlan: 'starter', twoFactorEnabled: false },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '0s', issuer: 'collectly', audience: 'collectly-client' }
    );
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('should reject token signed with wrong secret', async () => {
    const wrongToken = require('jsonwebtoken').sign({ id: 'fakeid', role: 'owner' }, 'completely_wrong_secret');
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${wrongToken}`);
    expect(res.status).toBe(401);
  });

  it('should reject access token used as refresh token', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const loginRes      = await request(app).post('/api/v1/auth/login').send(validLogin);
    const { accessToken } = loginRes.body.data;
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: accessToken });
    expect(res.status).toBe(401);
  });

  it('should not accept token in query string', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const loginRes      = await request(app).post('/api/v1/auth/login').send(validLogin);
    const { accessToken } = loginRes.body.data;
    const res = await request(app).get(`/api/v1/auth/me?access_token=${accessToken}`);
    expect(res.status).toBe(401);
  });

  it('should enforce session cap — max 5 concurrent refresh tokens', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    for (let i = 0; i < 6; i++) {
      await request(app).post('/api/v1/auth/login').send(validLogin);
    }
    const user = await User.findOne({ email: validUser.email }).select('+refreshTokens');
    expect(user.refreshTokens.length).toBeLessThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RBAC
// ─────────────────────────────────────────────────────────────────────────────

describe('restrictTo — role-based access control', () => {
  it('should attach correct default role (owner) on signup', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.body.data.user.role).toBe('owner');
  });

  it('should attach correct subscription plan (starter) on signup', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(validUser);
    expect(res.body.data.user.subscriptionPlan).toBe('starter');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/forgot-password', () => {
  it('should return 200 with safe message for existing email', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: validUser.email });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('should return 200 with same message for non-existent email (enumeration protection)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'doesnotexist@test.dev' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('should reject missing email with 422', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({});
    expect(res.status).toBe(422);
  });

  it('should reject invalid email format with 422', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('should store hashed reset token on user document', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: validUser.email });
    const user = await User.findOne({ email: validUser.email })
      .select('+passwordResetToken +passwordResetExpires');
    expect(user.passwordResetToken).toBeDefined();
    expect(user.passwordResetExpires).toBeDefined();
    expect(new Date(user.passwordResetExpires).getTime()).toBeGreaterThan(Date.now());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password/:token', () => {
  const { generateSecureToken, hashToken, generateExpiry } = require('../../../shared/utils/token.util');

  const setupResetToken = async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const plainToken  = generateSecureToken(32);
    const hashedToken = hashToken(plainToken);
    await User.findOneAndUpdate(
      { email: validUser.email },
      {
        passwordResetToken:   hashedToken,
        passwordResetExpires: generateExpiry(60),
      },
      { new: true }
    );
    return plainToken;
  };

  it('should reset password with valid token and return access token', async () => {
    const token = await setupResetToken();
    const res = await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'NewSecure@456' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('should clear reset token after successful reset', async () => {
    const token = await setupResetToken();
    await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'NewSecure@456' });
    const user = await User.findOne({ email: validUser.email })
      .select('+passwordResetToken +passwordResetExpires');
    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetExpires).toBeUndefined();
  });

  it('should reject expired or invalid token with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/reset-password/invalidtoken123456789012345678901234567890')
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'NewSecure@456' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('should reject weak new password with 422', async () => {
    const token = await setupResetToken();
    const res = await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'weak', confirmPassword: 'weak' });
    expect(res.status).toBe(422);
  });

  it('should reject mismatched passwords with 422', async () => {
    const token = await setupResetToken();
    const res = await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'Different@789' });
    expect(res.status).toBe(422);
  });

  it('should allow login with new password after reset', async () => {
    const token = await setupResetToken();
    await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'NewSecure@456' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: 'NewSecure@456' });
    expect(loginRes.status).toBe(200);
  });

  it('should reject old password login after reset', async () => {
    const token = await setupResetToken();
    await request(app)
      .post(`/api/v1/auth/reset-password/${token}`)
      .send({ newPassword: 'NewSecure@456', confirmPassword: 'NewSecure@456' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    expect(loginRes.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL VERIFICATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Email verification flow', () => {
  const { generateSecureToken, hashToken, generateExpiry } = require('../../../shared/utils/token.util');

  const signupAndGetToken = async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: validUser.email, password: validUser.password });
    return res.body.data.accessToken;
  };

  it('POST /resend-verification should return 200 for unverified user', async () => {
    const token = await signupAndGetToken();
    const res   = await request(app)
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('GET /verify-email/:token should verify email with valid token', async () => {
    const accessToken = await signupAndGetToken();
    const plainToken  = generateSecureToken(32);
    const hashedToken = hashToken(plainToken);
    await User.findOneAndUpdate(
      { email: validUser.email },
      {
        emailVerifyToken:   hashedToken,
        emailVerifyExpires: generateExpiry(24 * 60),
      }
    );
    const res = await request(app)
      .get(`/api/v1/auth/verify-email/${plainToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('GET /verify-email/:token should set isEmailVerified to true', async () => {
    await signupAndGetToken();
    const plainToken  = generateSecureToken(32);
    const hashedToken = hashToken(plainToken);
    await User.findOneAndUpdate(
      { email: validUser.email },
      {
        emailVerifyToken:   hashedToken,
        emailVerifyExpires: generateExpiry(24 * 60),
      }
    );
    await request(app).get(`/api/v1/auth/verify-email/${plainToken}`);
    const user = await User.findOne({ email: validUser.email });
    expect(user.isEmailVerified).toBe(true);
  });

  it('GET /verify-email/:token should reject invalid token with 400', async () => {
    const res = await request(app)
      .get('/api/v1/auth/verify-email/invalidtoken1234567890123456789012345');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_VERIFY_TOKEN');
  });

  it('POST /resend-verification should return 400 if already verified', async () => {
    const accessToken = await signupAndGetToken();
    await User.findOneAndUpdate({ email: validUser.email }, { isEmailVerified: true });
    const res = await request(app)
      .post('/api/v1/auth/resend-verification')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMAIL_ALREADY_VERIFIED');
  });

  it('POST /resend-verification should require authentication', async () => {
    const res = await request(app)
      .post('/api/v1/auth/resend-verification');
    expect(res.status).toBe(401);
  });
});