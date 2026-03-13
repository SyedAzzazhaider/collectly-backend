'use strict';

require('dotenv').config();
const app       = require('./app');
const connectDB = require('./src/config/database');
const logger    = require('./src/shared/utils/logger');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  const server = app.listen(PORT, () => {
    logger.info(`Collectly API running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  const shutdown = (signal) => {
    logger.warn(`${signal} received. Shutting down gracefully.`);
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
};

startServer();
