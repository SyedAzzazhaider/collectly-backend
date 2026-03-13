'use strict';

const { createLogger, format, transports } = require('winston');
const path = require('path');

const isTest = process.env.NODE_ENV === 'test';

const loggerTransports = [
  new transports.Console({
    silent: isTest,
    format: format.combine(
      format.colorize(),
      format.printf(({ timestamp, level, message, stack }) =>
        stack
          ? `${timestamp} [${level}]: ${message}\n${stack}`
          : `${timestamp} [${level}]: ${message}`
      )
    ),
  }),
];

// File transports only in non-test environments
// Avoids open file handles that prevent Jest from exiting cleanly
if (!isTest) {
  loggerTransports.push(
    new transports.File({
      filename: path.join('logs', 'error.log'),
      level:    'error',
    }),
    new transports.File({
      filename: path.join('logs', 'combined.log'),
    })
  );
}

const logger = createLogger({
  level: isTest ? 'silent' : (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: loggerTransports,
  silent: isTest,
});

module.exports = logger;
