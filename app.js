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
const { globalLimiter } = require('./src/shared/middlewares/rateLimiter');
const logger            = require('./src/shared/utils/logger');

require('./src/modules/auth/services/passport.service');

const authRoutes    = require('./src/modules/auth/routes/auth.routes');
const oauthRoutes   = require('./src/modules/auth/routes/oauth.routes');
const billingRoutes = require('./src/modules/billing/routes/billing.routes');

const app = express();

app.use(helmet());

app.use(cors({
  origin:         process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));
}

app.use(globalLimiter);
app.use(passport.initialize());

app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', service: 'collectly-api' })
);

app.use('/api/v1/auth',       authRoutes);
app.use('/api/v1/auth/oauth', oauthRoutes);
app.use('/api/v1/billing',    billingRoutes);
app.use('/api/v1/customers',  require('./src/modules/customers/routes/customer.routes'));
app.use('/api/v1/invoices',   require('./src/modules/customers/routes/invoice.routes'));

app.use((req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found.`, 404));
});

app.use(errorHandler);

module.exports = app;

