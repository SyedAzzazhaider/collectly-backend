'use strict';

const logger = require('./logger');

// ── Lazy Sentry initialization ────────────────────────────────────────────────
// Sentry is optional — system runs normally without it.
// Set SENTRY_DSN in .env to enable error monitoring.

let _sentry = null;

const getSentry = () => {
  if (_sentry) return _sentry;
  if (!process.env.SENTRY_DSN || process.env.NODE_ENV === 'test') return null;

  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn:              process.env.SENTRY_DSN,
      environment:      process.env.NODE_ENV || 'development',
      release:          process.env.npm_package_version || '1.0.0',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
    _sentry = Sentry;
    logger.info('Sentry initialized successfully');
    return _sentry;
  } catch (err) {
    logger.warn(`Sentry initialization failed: ${err.message}`);
    return null;
  }
};

const isSentryEnabled = () => !!(
  process.env.SENTRY_DSN &&
  process.env.NODE_ENV !== 'test'
);

// ── Capture exception ─────────────────────────────────────────────────────────

const captureException = (err, context = {}) => {
  const sentry = getSentry();
  if (!sentry) return;

  try {
    sentry.withScope((scope) => {
      if (context.userId)  scope.setUser({ id: context.userId });
      if (context.url)     scope.setTag('url', context.url);
      if (context.method)  scope.setTag('method', context.method);
      if (context.extra)   scope.setExtras(context.extra);
      sentry.captureException(err);
    });
  } catch {
    // Never let Sentry crash the application
  }
};

// ── Capture message ───────────────────────────────────────────────────────────

const captureMessage = (message, level = 'info', context = {}) => {
  const sentry = getSentry();
  if (!sentry) return;

  try {
    sentry.withScope((scope) => {
      scope.setLevel(level);
      if (context.extra) scope.setExtras(context.extra);
      sentry.captureMessage(message);
    });
  } catch {
    // Never let Sentry crash the application
  }
};

module.exports = { getSentry, isSentryEnabled, captureException, captureMessage };

