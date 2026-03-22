'use strict';

const logger = require('./logger');

let reminderQueue     = null;
let notificationQueue = null;

const getRedisConfig = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  return {
    redis: {
      port:     parseInt(redisUrl.split(':').pop()) || 6379,
      host:     redisUrl.replace('redis://', '').split(':')[0] || '127.0.0.1',
      password: process.env.REDIS_PASSWORD || undefined,
      tls:      redisUrl.startsWith('rediss://') ? {} : undefined,
    },
  };
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

