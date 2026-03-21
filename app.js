'use strict';

require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const morgan       = require('morgan');
const passport     = require('passport');

const AppError          = require('./src/shared/errors/AppError');
const errorHandler      = require('./src/shared/errors/errorHandler');
const { globalLimiter, perUserLimiter } = require('./src/shared/middlewares/rateLimiter');
const logger            = require('./src/shared/utils/logger');

require('./src/modules/auth/services/passport.service');

const authRoutes    = require('./src/modules/auth/routes/auth.routes');
const oauthRoutes   = require('./src/modules/auth/routes/oauth.routes');
const billingRoutes = require('./src/modules/billing/routes/billing.routes');

const app = express();

// Required for Render/proxy dployments — trusts the first proxy hop for correct IP detection
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'"],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge:            31536000,
    includeSubDomains: true,
    preload:           true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────

app.use(cors({
  origin:         process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
// The verify callback captures the raw Buffer for the Stripe webhook route
// BEFORE express.json parses it into a JS object.

app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => {
    if (req.originalUrl === '/api/v1/billing/webhook') {
      req.rawBody = buf;
    }
  },
}));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ── MongoDB injection protection ──────────────────────────────────────────────
// Strips $ and . from req.body, req.params, req.query to prevent operator injection


// ── HTTP Parameter Pollution protection ───────────────────────────────────────
// Prevents duplicate query params from bypassing filter logic

// ── HTTP request logging ──────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

// ── Global rate limiter ───────────────────────────────────────────────────────

app.use(globalLimiter);
app.use('/api/v1', perUserLimiter);

// ── Passport (OAuth) ──────────────────────────────────────────────────────────

app.use(passport.initialize());

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', service: 'collectly-api' })
);

// ── API routes ────────────────────────────────────────────────────────────────

// Module A — Authentication
app.use('/api/v1/auth',       authRoutes);
app.use('/api/v1/auth/oauth', oauthRoutes);

// Module B — Billing
app.use('/api/v1/billing', billingRoutes);

// Module C — Customers & Invoices
app.use('/api/v1/customers', require('./src/modules/customers/routes/customer.routes'));
app.use('/api/v1/invoices',  require('./src/modules/customers/routes/invoice.routes'));

// Module D — Sequences
app.use('/api/v1/sequences', require('./src/modules/sequences/routes/sequence.routes'));

// Module E — Notifications & Delivery
app.use('/api/v1/notifications', require('./src/modules/notifications/routes/notification.routes'));

// Module F — Conversations & Negotiation
app.use('/api/v1/conversations', require('./src/modules/conversations/routes/conversation.routes'));

// Module G — Dashboards & Analytics
app.use('/api/v1/dashboard', require('./src/modules/dashboard/routes/dashboard.routes'));

// Module H — Search & Filters
app.use('/api/v1/search', require('./src/modules/search/routes/search.routes'));

// Module I — Platform Alerts
app.use('/api/v1/alerts', require('./src/modules/alerts/routes/alert.routes'));

// Module J — Security & Compliance
app.use('/api/v1/compliance', require('./src/modules/compliance/routes/compliance.routes'));

// ── 404 handler ───────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

// ── Centralised error handler ─────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;