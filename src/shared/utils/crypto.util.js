const crypto = require('crypto');
const AppError = require('../errors/AppError');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENCODING = 'hex';

/**
 * Derive a 32-byte encryption key from the JWT_ACCESS_SECRET env var
 * Used to encrypt sensitive fields (e.g. 2FA secrets) before DB storage
 */
const getEncryptionKey = () => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new AppError('Encryption key not configured', 500);
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt a plain string (e.g. 2FA secret)
 * Returns: iv:tag:encrypted (all hex)
 */
const encrypt = (plainText) => {
  try {
    const key = getEncryptionKey();
    const iv  = crypto.randomBytes(IV_LENGTH);
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
  } catch {
    throw new AppError('Encryption failed', 500);
  }
};

/**
 * Decrypt a previously encrypted string
 */
const decrypt = (cipherText) => {
  try {
    const key  = getEncryptionKey();
    const [ivHex, tagHex, encryptedHex] = cipherText.split(':');

    if (!ivHex || !tagHex || !encryptedHex) {
      throw new AppError('Invalid cipher format', 500);
    }

    const iv        = Buffer.from(ivHex,        ENCODING);
    const tag       = Buffer.from(tagHex,        ENCODING);
    const encrypted = Buffer.from(encryptedHex,  ENCODING);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new AppError('Decryption failed', 500);
  }
};

/**
 * Generate a TOTP-safe random secret label
 */
const generateOtpLabel = (email) => {
  return `Collectly:${email}`;
};

module.exports = {
  encrypt,
  decrypt,
  generateOtpLabel,
};