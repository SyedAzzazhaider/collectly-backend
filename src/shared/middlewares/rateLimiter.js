const rateLimit = require('express-rate-limit');

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many requests, please try again later.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many authentication attempts, please try again later.' },
  skip: (req) => process.env.NODE_ENV === 'test',
});

module.exports = { globalLimiter, authLimiter };