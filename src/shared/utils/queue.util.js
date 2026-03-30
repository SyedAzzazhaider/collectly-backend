'use strict';

const logger = require('./logger');

let reminderQueue     = null;
let notificationQueue = null;

// ── Redis config builder ───────────────────────────────────────────────────────
// FIX: Previous implementation used brittle string-split parsing that broke for:
//   • rediss:// (TLS) — replace('redis://', '') left 's://host' as the host string
//   • redis://user:pass@host:port — split(':')[0] after replace gave 'user' not 'host'
//   • Render Redis URLs (redis://red-xxx:6379) — no issue but undefined behavior
// Now uses the WHATWG URL API which is stable since Node 10 and handles all formats.
const getRedisConfig = () => {
  const rawUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  try {
    // Normalise rediss:// → redis:// for URL parsing, carry TLS separately
    const isTls     = rawUrl.startsWith('rediss://');
    const parseUrl  = isTls ? rawUrl.replace(/^rediss:\/\//, 'redis://') : rawUrl;
    const parsed    = new URL(parseUrl);

    return {
      redis: {
        host:     parsed.hostname || '127.0.0.1',
        port:     parseInt(parsed.port, 10) || 6379,
        // Only set password if actually present in URL or REDIS_PASSWORD env var
        password: parsed.password || process.env.REDIS_PASSWORD || undefined,
        username: parsed.username || undefined,
        // Enable TLS for rediss:// scheme (required by Redis Cloud, Upstash, etc.)
        tls:      isTls ? {} : undefined,
      },
    };
  } catch (err) {
    logger.error(`Redis URL parse failed — falling back to localhost defaults: ${err.message}`);
    return {
      redis: {
        host:     '127.0.0.1',
        port:     6379,
        password: process.env.REDIS_PASSWORD || undefined,
      },
    };
  }
};

const getReminderQueue = () => {
  if (reminderQueue) return reminderQueue;
  try {
    const Bull    = require('bull');
    reminderQueue = new Bull('reminder-batch', getRedisConfig());
    reminderQueue.on('failed', (job, err) => {
      logger.error(`Reminder job ${job.id} failed: ${err.message}`);
    });
    logger.info('Bull reminder queue initialized');
  } catch (err) {
    logger.warn(`Bull queue unavailable — falling back to setInterval: ${err.message}`);
  }
  return reminderQueue;
};

const getNotificationQueue = () => {
  if (notificationQueue) return notificationQueue;
  try {
    const Bull        = require('bull');
    notificationQueue = new Bull('notification-delivery', getRedisConfig());
    notificationQueue.on('failed', (job, err) => {
      logger.error(`Notification job ${job.id} failed: ${err.message}`);
    });
    logger.info('Bull notification queue initialized');
  } catch (err) {
    logger.warn(`Bull notification queue unavailable: ${err.message}`);
  }
  return notificationQueue;
};

module.exports = { getReminderQueue, getNotificationQueue };