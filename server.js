'use strict';

require('dotenv').config();
const app       = require('./app');
const connectDB = require('./src/config/database');
const logger    = require('./src/shared/utils/logger');

const PORT = process.env.PORT || 5000;

// ── Scheduler config ──────────────────────────────────────────────────────────

const SCHEDULER_ENABLED       = process.env.SCHEDULER_ENABLED !== 'false' &&
                                 process.env.NODE_ENV !== 'test';
const SCHEDULER_INTERVAL_MS   = parseInt(process.env.SCHEDULER_INTERVAL_MS,   10) || 5 * 60 * 1000;
const SCHEDULER_BATCH_SIZE    = parseInt(process.env.SCHEDULER_BATCH_SIZE,    10) || 100;
const SUBSCRIPTION_CHECK_MS   = 60 * 60 * 1000;   // 1 hour
// FEAT-05: retry failed/scheduled notifications every 10 minutes
const NOTIFICATION_RETRY_MS   = parseInt(process.env.NOTIFICATION_RETRY_MS,   10) || 10 * 60 * 1000;
const NOTIFICATION_RETRY_BATCH = parseInt(process.env.NOTIFICATION_RETRY_BATCH, 10) || 50;

let reminderTimer      = null;
let subscriptionTimer  = null;
let notificationTimer  = null;
let batchRunning       = false;

const startSchedulers = async () => {
  if (!SCHEDULER_ENABLED) {
    logger.info('Schedulers disabled (NODE_ENV=test or SCHEDULER_ENABLED=false)');
    return;
  }
  const reminderEngine   = require('./src/modules/sequences/services/reminderEngine.service');
  const alertService     = require('./src/modules/alerts/services/alert.service');
  const deliveryService  = require('./src/modules/notifications/services/delivery.service');
  const { getReminderQueue, getNotificationQueue } = require('./src/shared/utils/queue.util');

  // ── Initialize Bull queues if Redis is configured ─────────────────────────
  // Queues are used for distributed scheduling when Redis is provisioned.
  // Falls back to setInterval when Redis is not available.
  const reminderQueue     = getReminderQueue();
  const notificationQueue = getNotificationQueue();

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

  // ── FEAT-05: Notification retry / scheduled delivery ───────────────────────
  // Processes failed notifications with backoff and future-scheduled notifications
  // that are now due. This replaces the manual-only admin endpoint as the primary
  // automated retry mechanism.
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

  // ── Schedule Bull queue jobs if queues are active ─────────────────────────
  if (reminderQueue) {
    await reminderQueue.add({}, { repeat: { every: SCHEDULER_INTERVAL_MS } });
    logger.info(`Bull reminder queue scheduled — interval: ${SCHEDULER_INTERVAL_MS / 1000}s`);
  }

  if (notificationQueue) {
    await notificationQueue.add({}, { repeat: { every: NOTIFICATION_RETRY_MS } });
    logger.info(`Bull notification queue scheduled — interval: ${NOTIFICATION_RETRY_MS / 1000}s`);
  }

  // 30-second warm-up before first runs (let DB connection settle)
  setTimeout(runReminderBatch,     30 * 1000);
  setTimeout(runSubscriptionCheck, 60 * 1000);
  setTimeout(runNotificationRetry, 90 * 1000);  // FEAT-05

  reminderTimer     = setInterval(runReminderBatch,     SCHEDULER_INTERVAL_MS);
  subscriptionTimer = setInterval(runSubscriptionCheck, SUBSCRIPTION_CHECK_MS);
  notificationTimer = setInterval(runNotificationRetry, NOTIFICATION_RETRY_MS);  // FEAT-05

  logger.info(`Reminder scheduler started — interval: ${SCHEDULER_INTERVAL_MS / 1000}s, batch: ${SCHEDULER_BATCH_SIZE}`);
  logger.info('Subscription expiry scheduler started — interval: 1h');
  logger.info(`Notification retry scheduler started — interval: ${NOTIFICATION_RETRY_MS / 1000}s, batch: ${NOTIFICATION_RETRY_BATCH}`);
};

const stopSchedulers = () => {
  if (reminderTimer)     { clearInterval(reminderTimer);     reminderTimer     = null; }
  if (subscriptionTimer) { clearInterval(subscriptionTimer); subscriptionTimer = null; }
  if (notificationTimer) { clearInterval(notificationTimer); notificationTimer = null; }  // FEAT-05
  logger.info('Schedulers stopped');
};

// ── Server startup ────────────────────────────────────────────────────────────

const startServer = async () => {
  await connectDB();

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