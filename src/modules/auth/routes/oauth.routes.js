'use strict';

const express  = require('express');
const router   = express.Router();
const passport = require('passport');
const AppError = require('../../../shared/errors/AppError');
const authController = require('../controllers/auth.controller');
const logger   = require('../../../shared/utils/logger');

// ── OAuth guard ───────────────────────────────────────────────────────────────

/**
 * Returns a middleware that blocks the route if the required OAuth
 * provider credentials are not configured in the environment.
 */
const requireProviderConfig = (provider) => (req, res, next) => {
  const vars = {
    google:    ['GOOGLE_CLIENT_ID',    'GOOGLE_CLIENT_SECRET'],
    microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
  };

  const missing = (vars[provider] || []).filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return next(
      new AppError(
        `${provider} OAuth is not configured on this server.`,
        503,
        'OAUTH_NOT_CONFIGURED'
      )
    );
  }
  next();
};

// ── Passport authenticate factory ─────────────────────────────────────────────

/**
 * Wraps passport.authenticate in a promise-safe middleware.
 * Errors from the strategy are forwarded to the global error handler
 * rather than crashing the process.
 */
const authenticate = (strategy, options) => (req, res, next) => {
  passport.authenticate(strategy, options, (err, user, info) => {
    if (err) {
      logger.error(`OAuth [${strategy}] error: ${err.message}`);
      return next(
        new AppError(
          err.message || 'OAuth authentication failed.',
          err.statusCode || 401,
          err.code       || 'OAUTH_ERROR'
        )
      );
    }

    if (!user) {
      const reason = info?.message || 'OAuth provider did not return a user.';
      logger.warn(`OAuth [${strategy}] rejected: ${reason}`);
      return next(new AppError(reason, 401, 'OAUTH_REJECTED'));
    }

    // Attach normalized profile to req.user for the controller
    req.user = user;
    next();
  })(req, res, next);
};

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE OAUTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/oauth/google
 * Redirects the browser to Google's OAuth consent screen.
 */
router.get(
  '/google',
  requireProviderConfig('google'),
  passport.authenticate('google', {
    scope:  ['profile', 'email'],
    session: false,
    // Force consent screen — ensures refresh_token is always returned
    accessType: 'offline',
    prompt:     'select_account',
  })
);

/**
 * GET /api/v1/auth/oauth/google/callback
 * Google redirects back to this URL after the user consents.
 * On success: calls oauthCallback controller which issues tokens.
 * On failure: redirects browser to frontend error page.
 */
router.get(
  '/google/callback',
  requireProviderConfig('google'),
  authenticate('google', { session: false }),
  authController.oauthCallback
);

// ─────────────────────────────────────────────────────────────────────────────
// MICROSOFT OAUTH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/oauth/microsoft
 * Redirects the browser to Microsoft's OAuth consent screen.
 */
router.get(
  '/microsoft',
  requireProviderConfig('microsoft'),
  passport.authenticate('microsoft', {
    scope:   ['user.read'],
    session: false,
    prompt:  'select_account',
  })
);

/**
 * GET /api/v1/auth/oauth/microsoft/callback
 * Microsoft redirects back to this URL after the user consents.
 */
router.get(
  '/microsoft/callback',
  requireProviderConfig('microsoft'),
  authenticate('microsoft', { session: false }),
  authController.oauthCallback
);

// ─────────────────────────────────────────────────────────────────────────────
// OAUTH FAILURE FALLBACK
// Catches OAuth errors that bubble up and redirects to frontend
// ─────────────────────────────────────────────────────────────────────────────

router.use((err, req, res, next) => {
  if (err) {
    logger.error(`OAuth route error: ${err.message}`);
    const frontendError = `${process.env.FRONTEND_URL}/auth/login?error=oauth_failed`;
    return res.redirect(302, frontendError);
  }
  next();
});

module.exports = router;

