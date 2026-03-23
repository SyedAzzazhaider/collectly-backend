'use strict';

require('dotenv').config();
const app       = require('./app');
const connectDB = require('./src/config/database');
const logger    = require('./src/shared/utils/logger');

const PORT = process.env.PORT || 5000;

// ── Scheduler config ──────────────────────────────────────────────────────────

const SCHEDULER_ENABLED        = process.env.SCHEDULER_ENABLED !== 'false' &&
                                  process.env.NODE_ENV !== 'test';
const SCHEDULER_INTERVAL_MS    = parseInt(process.env.SCHEDULER_INTERVAL_MS,    10) || 5 * 60 * 1000;
const SCHEDULER_BATCH_SIZE     = parseInt(process.env.SCHEDULER_BATCH_SIZE,     10) || 100;
const SUBSCRIPTION_CHECK_MS    = 60 * 60 * 1000;
const NOTIFICATION_RETRY_MS    = parseInt(process.env.NOTIFICATION_RETRY_MS,    10) || 10 * 60 * 1000;
const NOTIFICATION_RETRY_BATCH = parseInt(process.env.NOTIFICATION_RETRY_BATCH, 10) || 50;

let reminderTimer     = null;
let subscriptionTimer = null;
let notificationTimer = null;
let batchRunning      = false;

const startSchedulers = async () => {
  if (!SCHEDULER_ENABLED) {
    logger.info('Schedulers disabled (NODE_ENV=test or SCHEDULER_ENABLED=false)');
    return;
  }

  const reminderEngine  = require('./src/modules/sequences/services/reminderEngine.service');
  const alertService    = require('./src/modules/alerts/services/alert.service');
  const deliveryService = require('./src/modules/notifications/services/delivery.service');
  const { getReminderQueue, getNotificationQueue } = require('./src/shared/utils/queue.util');

  // ── Initialize Bull queues if Redis is configured ─────────────────────────
  const reminderQueue     = getReminderQueue();
  const notificationQueue = getNotificationQueue();

  // ── Reminder batch ────────────────────────────────────────────────────────
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

  // ── Subscription expiry check ─────────────────────────────────────────────
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

  // ── Notification retry / scheduled delivery ───────────────────────────────
  const runNotificationRetry = async () => {
    try {
      const result = await deliveryService.retryFailedNotifications(NOTIFICATION_RETRY_BATCH);
      if (result.processed > 0) {
        logger.info(
          `Notification retry — processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed}`
        );
      }
    } catch (err) {
      logger.error(`Notification retry error: ${err.message}`);
    }
  };

  // ── Register Bull queue processors ───────────────────────────────────────
  // Registered AFTER function definitions — avoids hoisting issues
  if (reminderQueue) {
    reminderQueue.process(async (job) => {
      await runReminderBatch();
      return { done: true };
    });
    logger.info('Bull reminder queue processor registered');
  }

  if (notificationQueue) {
    notificationQueue.process(async (job) => {
      await runNotificationRetry();
      return { done: true };
    });
    logger.info('Bull notification queue processor registered');
  }

  // ── 30-second warm-up before first runs (let DB connection settle) ────────
  // Bull queue jobs are also scheduled here — after MongoDB is confirmed ready
  setTimeout(async () => {
    if (reminderQueue) {
      await reminderQueue.add({}, { repeat: { every: SCHEDULER_INTERVAL_MS } }).catch(
        (err) => logger.warn(`Bull reminder schedule failed: ${err.message}`)
      );
      logger.info(`Bull reminder queue scheduled — interval: ${SCHEDULER_INTERVAL_MS / 1000}s`);
    }
    if (notificationQueue) {
      await notificationQueue.add({}, { repeat: { every: NOTIFICATION_RETRY_MS } }).catch(
        (err) => logger.warn(`Bull notification schedule failed: ${err.message}`)
      );
      logger.info(`Bull notification queue scheduled — interval: ${NOTIFICATION_RETRY_MS / 1000}s`);
    }
    runReminderBatch();
  }, 30 * 1000);

  setTimeout(runSubscriptionCheck, 60 * 1000);
  setTimeout(runNotificationRetry, 90 * 1000);

  reminderTimer     = setInterval(runReminderBatch,     SCHEDULER_INTERVAL_MS);
  subscriptionTimer = setInterval(runSubscriptionCheck, SUBSCRIPTION_CHECK_MS);
  notificationTimer = setInterval(runNotificationRetry, NOTIFICATION_RETRY_MS);

  logger.info(`Reminder scheduler started — interval: ${SCHEDULER_INTERVAL_MS / 1000}s, batch: ${SCHEDULER_BATCH_SIZE}`);
  logger.info('Subscription expiry scheduler started — interval: 1h');
  logger.info(`Notification retry scheduler started — interval: ${NOTIFICATION_RETRY_MS / 1000}s, batch: ${NOTIFICATION_RETRY_BATCH}`);
};

const stopSchedulers = () => {
  if (reminderTimer)     { clearInterval(reminderTimer);     reminderTimer     = null; }
  if (subscriptionTimer) { clearInterval(subscriptionTimer); subscriptionTimer = null; }
  if (notificationTimer) { clearInterval(notificationTimer); notificationTimer = null; }
  logger.info('Schedulers stopped');
};

// ── Server startup ────────────────────────────────────────────────────────────

const startServer = async () => {
  await connectDB();

  // ── Production startup validation ──────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    const required = ['FRONTEND_URL', 'MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'APP_ENCRYPTION_KEY'];
    const missing  = required.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      logger.error(`CRITICAL: Missing required environment variables: ${missing.join(', ')}`);
      process.exit(1);
    }
  }

  const server = app.listen(PORT, () => {
    logger.info(`Collectly API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  startSchedulers().catch((err) => logger.error(`Scheduler startup error: ${err.message}`));

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