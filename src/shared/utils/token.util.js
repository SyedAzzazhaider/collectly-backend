'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token (hex)
 * Used for: email verification, password reset
 */
const generateSecureToken = (bytes = 32) => {
  return crypto.randomBytes(bytes).toString('hex');
};

/**
 * Hash a plain token using SHA-256 for safe DB storage
 * Never store plain reset/verify tokens in the database
 */
const hashToken = (plainToken) => {
  return crypto
    .createHash('sha256')
    .update(plainToken)
    .digest('hex');
};

/**
 * Generate a unique JWT ID (jti) using Node built-in crypto
 * No external dependency required — crypto.randomUUID() is stable since Node 14.17
 */
const generateJti = () => {
  return crypto.randomUUID();
};

/**
 * Generate a refresh token entry for storage in the DB
 * Stores hashed version only — never plain token
 */
const generateRefreshTokenEntry = (plainToken, ip, userAgent, expiryDays = 7) => {
  return {
    token:     hashToken(plainToken),
    ip:        ip        || 'unknown',
    userAgent: userAgent || 'unknown',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
  };
};

/**
 * Generate an expiry Date object
 */
const generateExpiry = (minutes) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};

/**
 * Compare a plain token against a stored hashed token
 * Uses timing-safe comparison to prevent timing attacks
 */
const compareToken = (plainToken, hashedToken) => {
  const hashed = hashToken(plainToken);
  return crypto.timingSafeEqual(
    Buffer.from(hashed),
    Buffer.from(hashedToken)
  );
};

module.exports = {
  generateSecureToken,
  hashToken,
  generateJti,
  generateRefreshTokenEntry,
  generateExpiry,
  compareToken,
};
