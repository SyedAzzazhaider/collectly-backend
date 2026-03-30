'use strict';

const mongoose = require('mongoose');
const logger   = require('../shared/utils/logger');

// ── Reconnection config ───────────────────────────────────────────────────────
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RETRY_DELAY_MS    = 2000;  // 2 s initial delay
const MAX_RETRY_DELAY_MS     = 30000; // 30 s cap (exponential backoff ceiling)

let reconnectAttempts = 0;
let reconnectTimer    = null;

// ── Reconnection with exponential backoff ─────────────────────────────────────
const scheduleReconnect = () => {
  if (reconnectTimer) return; // already scheduled

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(
      `MongoDB: exhausted ${MAX_RECONNECT_ATTEMPTS} reconnection attempts — giving up. ` +
      'The process must be restarted manually or by the platform supervisor.'
    );
    return;
  }

  const delay = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RETRY_DELAY_MS
  );

  reconnectAttempts++;
  logger.warn(`MongoDB: reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        maxPoolSize:              10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS:          45000,
      });
      // Reset counter on successful reconnection
      reconnectAttempts = 0;
      logger.info('MongoDB: reconnected successfully');
    } catch (err) {
      logger.error(`MongoDB: reconnect attempt failed — ${err.message}`);
      scheduleReconnect();
    }
  }, delay);
};

// ── Primary connect function ──────────────────────────────────────────────────
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize:              10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:          45000,
    });
    reconnectAttempts = 0; // reset on first successful connect
    logger.info(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

// ── Connection event handlers ─────────────────────────────────────────────────
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected — scheduling automatic reconnection');
  // Only schedule reconnect if we are not intentionally closing
  // (e.g. during test teardown or SIGTERM shutdown)
  if (process.env.NODE_ENV !== 'test') {
    scheduleReconnect();
  }
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB error: ${err.message}`);
});

// ── Export DB ready state (used by health endpoint) ───────────────────────────
// Returns true only when Mongoose is in the CONNECTED state (readyState === 1)
const isDbReady = () => mongoose.connection.readyState === 1;

module.exports = connectDB;
module.exports.isDbReady = isDbReady;