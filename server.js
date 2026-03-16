'use strict';

require('dotenv').config();
const app       = require('./app');
const connectDB = require('./src/config/database');
const logger    = require('./src/shared/utils/logger');

const PORT = process.env.PORT || 5000;

// ── Scheduler config ──────────────────────────────────────────────────────────
// Reminder batch: auto-processes invoices due for reminders
// Subscription check: alerts users about upcoming renewals
// Both disabled automatically when NODE_ENV=test

const SCHEDULER_ENABLED     = process.env.SCHEDULER_ENABLED !== 'false' &&
                               process.env.NODE_ENV !== 'test';
const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS, 10) || 5 * 60 * 1000;
const SCHEDULER_BATCH_SIZE  = parseInt(process.env.SCHEDULER_BATCH_SIZE,  10) || 100;
const SUBSCRIPTION_CHECK_MS = 60 * 60 * 1000; // Run subscription expiry check every 1 hour

let reminderTimer      = null;
let subscriptionTimer  = null;
let batchRunning       = false;

const startSchedulers = () => {
  if (!SCHEDULER_ENABLED) {
    logger.info('Schedulers disabled (NODE_ENV=test or SCHEDULER_ENABLED=false)');
    return;
  }

  const reminderEngine = require('./src/modules/sequences/services/reminderEngine.service');
  const alertService   = require('./src/modules/alerts/services/alert.service');

  // ── Reminder batch ──────────────────────────────────────────────────────────

  const runReminderBatch = async () => {
    if (batchRunning) {
      logger.warn('Scheduler: previous batch still running — skipping this tick');
      return;
    }
    batchRunning = true;
    try {
      const result = await reminderEngine.runReminderBatch(SCHEDULER_BATCH_SIZE);
      if (result.total > 0) {
        logger.info(
          `Reminder batch — processed: ${result.processed}, failed: ${result.failed}, total: ${result.total}`
        );
      }
    } catch (err) {
      logger.error(`Reminder batch error: ${err.message}`);
    } finally {
      batchRunning = false;
    }
  };

  // ── Subscription expiry check ───────────────────────────────────────────────

  const runSubscriptionCheck = async () => {
    try {
      const result = await alertService.checkSubscriptionExpiry();
      if (result.created > 0) {
        logger.info(`Subscription expiry check — alerts created: ${result.created}`);
      }
    } catch (err) {
      logger.error(`Subscription expiry check error: ${err.message}`);
    }
  };

  // 30-second warm-up delay before first run
  setTimeout(runReminderBatch,     30 * 1000);
  setTimeout(runSubscriptionCheck, 60 * 1000);

  reminderTimer     = setInterval(runReminderBatch,     SCHEDULER_INTERVAL_MS);
  subscriptionTimer = setInterval(runSubscriptionCheck, SUBSCRIPTION_CHECK_MS);

  logger.info(
    `Reminder scheduler started — interval: ${SCHEDULER_INTERVAL_MS / 1000}s, batch: ${SCHEDULER_BATCH_SIZE}`
  );
  logger.info('Subscription expiry scheduler started — interval: 1h');
};

const stopSchedulers = () => {
  if (reminderTimer)     { clearInterval(reminderTimer);     reminderTimer     = null; }
  if (subscriptionTimer) { clearInterval(subscriptionTimer); subscriptionTimer = null; }
  logger.info('Schedulers stopped');
};

// ── Server startup ────────────────────────────────────────────────────────────

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Collectly API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  startSchedulers();

  const shutdown = (signal) => {
    logger.warn(`${signal} received. Shutting down gracefully.`);
    stopSchedulers();
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => {
    logger.error(`UNHANDLED REJECTION: ${err.message}`);
    server.close(() => process.exit(1));
  });

  process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err.message}`);
    process.exit(1);
  });
};

startServer();