'use strict';

const passport                = require('passport');
const { Strategy: GoogleStrategy }    = require('passport-google-oauth20');
const { Strategy: MicrosoftStrategy } = require('passport-microsoft');
const logger                  = require('../../../shared/utils/logger');
const AppError                = require('../../../shared/errors/AppError');

// ── Environment validation ────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  logger.warn(
    `OAuth env vars not set — OAuth disabled: ${missingEnv.join(', ')}`
  );
}

// ── Profile normalizers ───────────────────────────────────────────────────────

/**
 * Extract a safe, normalized profile from a Google OAuth response.
 * Never trust provider data blindly — validate presence of required fields.
 */
const normalizeGoogleProfile = (profile) => {
  const email =
    profile.emails?.[0]?.value?.toLowerCase()?.trim() || null;

  const name =
    profile.displayName?.trim() ||
    `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
    'Google User';

  if (!email) {
    throw new AppError('Google account did not provide an email address.', 400, 'OAUTH_NO_EMAIL');
  }

  return {
    provider:   'google',
    providerId: String(profile.id),
    email,
    name,
  };
};

/**
 * Extract a safe, normalized profile from a Microsoft OAuth response.
 */
const normalizeMicrosoftProfile = (profile) => {
  const email =
    profile.emails?.[0]?.value?.toLowerCase()?.trim() ||
    profile._json?.mail?.toLowerCase()?.trim()        ||
    profile._json?.userPrincipalName?.toLowerCase()?.trim() ||
    null;

  const name =
    profile.displayName?.trim() ||
    `${profile.name?.givenName || ''} ${profile.name?.familyName || ''}`.trim() ||
    'Microsoft User';

  if (!email) {
    throw new AppError('Microsoft account did not provide an email address.', 400, 'OAUTH_NO_EMAIL');
  }

  return {
    provider:   'microsoft',
    providerId: String(profile.id),
    email,
    name,
  };
};

// ── Google Strategy ───────────────────────────────────────────────────────────

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID:     process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL:  `${process.env.API_BASE_URL || 'http://localhost:5000'}/api/v1/auth/oauth/google/callback`,
        scope:        ['profile', 'email'],
        // Prevent open redirect — only allow our callback
        passReqToCallback: false,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const normalized = normalizeGoogleProfile(profile);
          logger.info(`Google OAuth profile received: ${normalized.email}`);
          // Pass normalized profile to the callback route
          // oauthLogin is called in the controller after strategy succeeds
          return done(null, normalized);
        } catch (err) {
          logger.error(`Google OAuth strategy error: ${err.message}`);
          return done(err, false);
        }
      }
    )
  );
  logger.info('Google OAuth strategy registered.');
} else {
  logger.warn('Google OAuth strategy skipped — credentials not configured.');
}

// ── Microsoft Strategy ────────────────────────────────────────────────────────

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  passport.use(
    'microsoft',
    new MicrosoftStrategy(
      {
        clientID:     process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL:  `${process.env.API_BASE_URL || 'http://localhost:5000'}/api/v1/auth/oauth/microsoft/callback`,
        scope:        ['user.read'],
        passReqToCallback: false,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const normalized = normalizeMicrosoftProfile(profile);
          logger.info(`Microsoft OAuth profile received: ${normalized.email}`);
          return done(null, normalized);
        } catch (err) {
          logger.error(`Microsoft OAuth strategy error: ${err.message}`);
          return done(err, false);
        }
      }
    )
  );
  logger.info('Microsoft OAuth strategy registered.');
} else {
  logger.warn('Microsoft OAuth strategy skipped — credentials not configured.');
}

// ── Passport session stubs ────────────────────────────────────────────────────
// Collectly uses stateless JWT — no session persistence needed.
// These stubs satisfy Passport internals without enabling sessions.

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

module.exports = passport;

