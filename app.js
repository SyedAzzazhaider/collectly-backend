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

const getAllowedOrigins = () => {
  const origins = [];
  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.FRONTEND_URL_LOCAL) origins.push(process.env.FRONTEND_URL_LOCAL);
  if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3000');

  // Production safety guard — if no origin configured, log critical warning
  // but do not crash. Returns wildcard-blocked state.
  if (process.env.NODE_ENV === 'production' && origins.length === 0) {
    logger.error('CRITICAL: FRONTEND_URL is not set in production. All CORS requests will be rejected.');
  }

  return origins;
};


app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, server-to-server)
    if (!origin) return callback(null, true);
    const allowed = getAllowedOrigins();
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
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

// MongoDB injection protection — Express 5 compatible
// express-mongo-sanitize cannot reassign req.query in Express 5 (read-only getter)
// so we sanitize body and params directly using the sanitize() method instead
const mongoSanitize = require('express-mongo-sanitize');
app.use((req, res, next) => {
  if (req.body)   mongoSanitize.sanitize(req.body,   { replaceWith: '_' });
  if (req.params) mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  next();
});

// HTTP Parameter Pollution protection
const hpp = require('hpp');
app.use(hpp());

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
app.use('/api/v1/sequences/legal-notices', require('./src/modules/sequences/routes/legalNotice.routes'));
app.use('/api/v1/sequences',              require('./src/modules/sequences/routes/sequence.routes'));

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
// Audit Logs
app.use('/api/v1/audit-logs', require('./src/shared/routes/auditLog.routes'));
// Legal — ToS & Privacy Policy
app.use('/api/v1/legal', require('./src/shared/routes/legal.routes'));


// ── 404 handler ───────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

// ── Centralised error handler ─────────────────────────────────────────────────

app.use(errorHandler);

module.exports = app;