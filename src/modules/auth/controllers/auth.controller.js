'use strict';

const authService = require('../services/auth.service');
const AppError    = require('../../../shared/errors/AppError');
const logger      = require('../../../shared/utils/logger');

// ── Meta extractor ────────────────────────────────────────────────────────────

/**
 * Extract safe request metadata for session logging.
 * IP is read from x-forwarded-for (reverse proxy) with fallback.
 */
const extractMeta = (req) => ({
  ip:        req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             || req.socket?.remoteAddress
             || 'unknown',
  userAgent: req.headers['user-agent'] || 'unknown',
});

// ── Response helpers ──────────────────────────────────────────────────────────

const sendSuccess = (res, statusCode, message, data = {}) => {
  res.status(statusCode).json({
    status:  'success',
    message,
    data,
  });
};

// ── Signup ────────────────────────────────────────────────────────────────────

const signup = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const meta                      = extractMeta(req);

    const result = await authService.signup({ name, email, password }, res, meta);

    sendSuccess(res, 201, 'Account created successfully.', {
      user:        result.user,
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const meta                = extractMeta(req);

    const result = await authService.login({ email, password }, res, meta);

    // 2FA is enabled — partial response, TOTP required before full access
    if (result.requires2FA) {
      return sendSuccess(res, 200, '2FA verification required.', {
        requires2FA:   true,
        preAuthToken:  result.preAuthToken,
        userId:        result.userId,
      });
    }

    sendSuccess(res, 200, 'Login successful.', {
      user:        result.user,
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// ── Refresh Tokens ────────────────────────────────────────────────────────────

const refreshTokens = async (req, res, next) => {
  try {
    // Validator has already attached req.refreshToken from cookie or body
    const plainRefreshToken = req.refreshToken;
    const meta              = extractMeta(req);

    const result = await authService.refreshTokens(plainRefreshToken, res, meta);

    sendSuccess(res, 200, 'Tokens refreshed successfully.', {
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// ── Logout ────────────────────────────────────────────────────────────────────

const logout = async (req, res, next) => {
  try {
    // req.user is attached by protect middleware
    const userId            = req.user?.id;
    const plainRefreshToken =
      req.cookies?.collectly_refresh || req.body?.refreshToken;

    await authService.logout(userId, plainRefreshToken, res);

    sendSuccess(res, 200, 'Logged out successfully.');
  } catch (err) {
    next(err);
  }
};

// ── Logout All Devices ────────────────────────────────────────────────────────

const logoutAll = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('Authentication required.', 401, 'NO_TOKEN'));
    }

    await authService.logoutAll(userId, res);

    sendSuccess(res, 200, 'Logged out from all devices successfully.');
  } catch (err) {
    next(err);
  }
};

// ── Get Current User ──────────────────────────────────────────────────────────

const getMe = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('Authentication required.', 401, 'NO_TOKEN'));
    }

    const user = await authService.getMe(userId);

    sendSuccess(res, 200, 'User profile retrieved.', { user });
  } catch (err) {
    next(err);
  }
};

// ── 2FA Setup ─────────────────────────────────────────────────────────────────

const setup2FA = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return next(new AppError('Authentication required.', 401, 'NO_TOKEN'));
    }

    const result = await authService.setup2FA(userId);

    sendSuccess(res, 200, '2FA setup initiated. Scan the QR code with your authenticator app.', {
      qrCode:     result.qrCode,
      secret:     result.secret,
      otpAuthUrl: result.otpAuthUrl,
    });
  } catch (err) {
    next(err);
  }
};

// ── 2FA Verify ────────────────────────────────────────────────────────────────

const verify2FA = async (req, res, next) => {
  try {
    const { totpCode } = req.body;
    const meta         = extractMeta(req);

    // userId can come from protect middleware (disable flow)
    // or from preAuthToken userId in body (login 2FA flow)
    const userId = req.user?.id || req.body?.userId;

    if (!userId) {
      return next(new AppError('User identification required.', 400, 'MISSING_USER_ID'));
    }

    if (!totpCode) {
      return next(new AppError('TOTP code is required.', 400, 'MISSING_TOTP'));
    }

    const result = await authService.verify2FA(userId, totpCode, res, meta);

    sendSuccess(res, 200, '2FA verified successfully.', {
      accessToken: result.accessToken,
    });
  } catch (err) {
    next(err);
  }
};

// ── 2FA Disable ───────────────────────────────────────────────────────────────

const disable2FA = async (req, res, next) => {
  try {
    const userId    = req.user?.id;
    const { totpCode } = req.body;

    if (!userId) {
      return next(new AppError('Authentication required.', 401, 'NO_TOKEN'));
    }

    if (!totpCode) {
      return next(new AppError('TOTP code is required to disable 2FA.', 400, 'MISSING_TOTP'));
    }

    await authService.disable2FA(userId, totpCode);

    sendSuccess(res, 200, '2FA has been disabled on your account.');
  } catch (err) {
    next(err);
  }
};

// ── OAuth Callback Handler ────────────────────────────────────────────────────

/**
 * Called after Passport OAuth strategy succeeds.
 * req.user is populated by passport.authenticate() before this runs.
 */
const oauthCallback = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new AppError('OAuth authentication failed.', 401, 'OAUTH_FAILED'));
    }

    const { provider, providerId, email, name } = req.user;
    const meta                                  = extractMeta(req);

    const result = await authService.oauthLogin(
      { provider, providerId, email, name },
      res,
      meta
    );

    logger.info(`OAuth login successful [${provider}]: ${result.user.email}`);

    // Redirect to frontend with access token as query param
    // Frontend exchanges this immediately and discards from URL
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/oauth/callback?token=${result.accessToken}`;
    res.redirect(302, redirectUrl);
  } catch (err) {
    next(err);
  }
};


// ── Change Password ───────────────────────────────────────────────────────────

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user.id, currentPassword, newPassword);
    sendSuccess(res, 200, 'Password changed successfully. Please log in again on all devices.');
  } catch (err) { next(err); }
};


// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  signup,
  login,
  refreshTokens,
  logout,
  logoutAll,
  getMe,
  setup2FA,
  verify2FA,
  disable2FA,
  oauthCallback,
  changePassword,
};