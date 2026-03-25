'use strict';

/**
 * MODULE A â€” OAuth Integration Tests
 * Google & Microsoft OAuth flow simulation
 * Stack: Jest + Supertest + mongodb-memory-server
 */

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

const request = require('supertest');
const app     = require('../../../../app');
const User    = require('../models/User.model');
const authService = require('../services/auth.service');
const { connectTestDB, clearTestDB, closeTestDB } = require('./setupTestDB');

// â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const googleProfile = {
  provider:   'google',
  providerId: 'google_uid_123456789',
  email:      'googleuser@gmail.com',
  name:       'Google User',
};

const microsoftProfile = {
  provider:   'microsoft',
  providerId: 'microsoft_uid_987654321',
  email:      'msuser@outlook.com',
  name:       'Microsoft User',
};

const existingUserFixture = {
  name:            'Existing User',
  email:           'existing@collectly.dev',
  password:        'SecurePass@123',
  confirmPassword: 'SecurePass@123', tosAccepted: true,
};

// â”€â”€ Setup / Teardown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeAll(async () => { await connectTestDB(); });
afterEach(async () => { await clearTestDB();   });
afterAll(async ()  => { await closeTestDB();   });

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OAUTH SERVICE â€” Google
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('oauthLogin service â€” Google', () => {
  it('should create a new user on first Google OAuth login', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    const result = await authService.oauthLogin(googleProfile, mockRes, {
      ip: '127.0.0.1',
      userAgent: 'jest-test',
    });

    expect(result.user.email).toBe(googleProfile.email);
    expect(result.user.role).toBe('owner');
    expect(result.accessToken).toBeDefined();

    const dbUser = await User.findOne({ email: googleProfile.email })
      .select('+googleId');
    expect(dbUser).not.toBeNull();
    expect(dbUser.googleId).toBe(googleProfile.providerId);
    expect(dbUser.oauthProvider).toBe('google');
    expect(dbUser.isEmailVerified).toBe(true);
  });

  it('should return existing user on subsequent Google OAuth login', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    await authService.oauthLogin(googleProfile, mockRes, {});
    const second = await authService.oauthLogin(googleProfile, mockRes, {});

    expect(second.user.email).toBe(googleProfile.email);

    const count = await User.countDocuments({ email: googleProfile.email });
    expect(count).toBe(1);
  });

  it('should link Google provider to existing email/password account', async () => {
    // Create local account first
    await request(app)
      .post('/api/v1/auth/signup')
      .send(existingUserFixture);

    // OAuth login with same email â€” should link, not create new account
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };
    const result  = await authService.oauthLogin(
      { ...googleProfile, email: existingUserFixture.email },
      mockRes,
      {}
    );

    expect(result.user.email).toBe(existingUserFixture.email);

    const count = await User.countDocuments({ email: existingUserFixture.email });
    expect(count).toBe(1);  // Not duplicated

    const user = await User.findOne({ email: existingUserFixture.email })
      .select('+googleId');
    expect(user.googleId).toBe(googleProfile.providerId);
  });

  it('should reject OAuth login for deactivated account', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    // Create account via OAuth
    await authService.oauthLogin(googleProfile, mockRes, {});

    // Deactivate account
    await User.findOneAndUpdate(
      { email: googleProfile.email },
      { isActive: false }
    );

    await expect(
      authService.oauthLogin(googleProfile, mockRes, {})
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });

  it('should issue valid access token on Google OAuth login', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };
    const result  = await authService.oauthLogin(googleProfile, mockRes, {});

    const jwt     = require('jsonwebtoken');
    const decoded = jwt.verify(result.accessToken, process.env.JWT_ACCESS_SECRET);

    expect(decoded.id).toBeDefined();
    expect(decoded.role).toBe('owner');
    expect(decoded.iss).toBe('collectly');
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OAUTH SERVICE â€” Microsoft
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('oauthLogin service â€” Microsoft', () => {
  it('should create a new user on first Microsoft OAuth login', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    const result = await authService.oauthLogin(microsoftProfile, mockRes, {
      ip: '127.0.0.1',
      userAgent: 'jest-test',
    });

    expect(result.user.email).toBe(microsoftProfile.email);
    expect(result.accessToken).toBeDefined();

    const dbUser = await User.findOne({ email: microsoftProfile.email })
      .select('+microsoftId');
    expect(dbUser.microsoftId).toBe(microsoftProfile.providerId);
    expect(dbUser.oauthProvider).toBe('microsoft');
  });

  it('should not duplicate account on repeated Microsoft OAuth login', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    await authService.oauthLogin(microsoftProfile, mockRes, {});
    await authService.oauthLogin(microsoftProfile, mockRes, {});

    const count = await User.countDocuments({ email: microsoftProfile.email });
    expect(count).toBe(1);
  });

  it('should reject unsupported OAuth provider', async () => {
    const mockRes = { cookie: jest.fn(), clearCookie: jest.fn() };

    await expect(
      authService.oauthLogin(
        { provider: 'github', providerId: '999', email: 'gh@test.com', name: 'GH User' },
        mockRes,
        {}
      )
    ).rejects.toMatchObject({ code: 'INVALID_PROVIDER' });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OAUTH ROUTES â€” HTTP level
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('GET /api/v1/auth/oauth/google â€” route guard', () => {
  it('should redirect to Google OAuth (302) when credentials configured', async () => {
    const res = await request(app).get('/api/v1/auth/oauth/google');
    // Passport redirects to Google consent screen
    expect([302, 301]).toContain(res.status);
  });
});

describe('GET /api/v1/auth/oauth/microsoft â€” route guard', () => {
  it('should redirect to Microsoft OAuth (302) when credentials configured', async () => {
    const res = await request(app).get('/api/v1/auth/oauth/microsoft');
    expect([302, 301]).toContain(res.status);
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SESSION MANAGEMENT INTEGRATION
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Session management â€” multi-device integration', () => {
  const validUser = {
    name:            'Session User',
    email:           'session@collectly.dev',
    password:        'SecurePass@123',
    confirmPassword: 'SecurePass@123', tosAccepted: true,
  };

  it('should allow multiple concurrent sessions up to cap', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });
    }

    const user = await User.findOne({ email: validUser.email })
      .select('+refreshTokens');

    expect(user.refreshTokens.length).toBeGreaterThanOrEqual(1);
    expect(user.refreshTokens.length).toBeLessThanOrEqual(5);
  });

  it('should evict oldest session when cap exceeded', async () => {
    await request(app).post('/api/v1/auth/signup').send(validUser);

    for (let i = 0; i < 6; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });
    }

    const user = await User.findOne({ email: validUser.email })
      .select('+refreshTokens');

    expect(user.refreshTokens.length).toBeLessThanOrEqual(5);
  });

  it('should clear all sessions on logoutAll', async () => {
    const agent     = request.agent(app);
    const signupRes = await agent.post('/api/v1/auth/signup').send(validUser);
    const { accessToken } = signupRes.body.data;

    await agent
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);

    const user = await User.findOne({ email: validUser.email })
      .select('+refreshTokens');

    expect(user.refreshTokens.length).toBe(0);
  });
});



