'use strict';

const crypto   = require('crypto');
const AppError = require('../errors/AppError');

const ALGORITHM  = 'aes-256-gcm';
const IV_LENGTH  = 16;
const ENCODING   = 'hex';

// ── Encryption key ────────────────────────────────────────────────────────────
// Uses APP_ENCRYPTION_KEY — a dedicated secret separate from JWT secrets.
// This is critical: rotating JWT secrets must NOT invalidate all stored 2FA secrets.
// Fallback to JWT_ACCESS_SECRET only for backward compatibility with existing
// encrypted values already in the database. New installs must set APP_ENCRYPTION_KEY.

const getEncryptionKey = () => {
  const secret =
    process.env.APP_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new AppError(
      'APP_ENCRYPTION_KEY is not configured. Set this in your .env file.',
      500,
      'ENCRYPTION_KEY_MISSING'
    );
  }

  // Derive a stable 32-byte key using SHA-256
  return crypto.createHash('sha256').update(secret).digest();
};

// ── Encrypt ───────────────────────────────────────────────────────────────────
// Returns: iv:tag:encrypted (all hex) — safe for DB storage

const encrypt = (plainText) => {
  try {
    const key    = getEncryptionKey();
    const iv     = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(plainText, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      iv.toString(ENCODING),
      tag.toString(ENCODING),
      encrypted.toString(ENCODING),
    ].join(':');
  } catch (err) {
    if (err.isOperational) throw err;
    throw new AppError('Encryption failed', 500);
  }
};

// ── Decrypt ───────────────────────────────────────────────────────────────────

const decrypt = (cipherText) => {
  try {
    const key = getEncryptionKey();
    const [ivHex, tagHex, encryptedHex] = cipherText.split(':');

    if (!ivHex || !tagHex || !encryptedHex) {
      throw new AppError('Invalid cipher format', 500);
    }

    const iv        = Buffer.from(ivHex,       ENCODING);
    const tag       = Buffer.from(tagHex,       ENCODING);
    const encrypted = Buffer.from(encryptedHex, ENCODING);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch (err) {
    if (err.isOperational) throw err;
    throw new AppError('Decryption failed', 500);
  }
};

// ── Generate TOTP label ───────────────────────────────────────────────────────

const generateOtpLabel = (email) => `Collectly:${email}`;

module.exports = { encrypt, decrypt, generateOtpLabel };

