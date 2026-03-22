'use strict';

const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const AppError = require('../errors/AppError');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRES_IN  || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT secrets are not defined in environment variables');
}

const signAccessToken = (payload) => {
  if (!payload || !payload.id || !payload.role) {
    throw new AppError('Invalid token payload', 500);
  }
  return jwt.sign(
    {
      id:                payload.id,
      role:              payload.role,
      subscriptionPlan:  payload.subscriptionPlan,
      twoFactorEnabled:  payload.twoFactorEnabled,
      twoFactorVerified: payload.twoFactorVerified || false,
      // Unique per-token ID ensures no two access tokens are ever identical
      // even when signed within the same second
      jti: crypto.randomUUID(),
    },
    ACCESS_SECRET,
    {
      expiresIn: ACCESS_EXPIRY,
      issuer:    'collectly',
      audience:  'collectly-client',
      algorithm: 'HS256',
    }
  );
};

const signRefreshToken = (payload) => {
  if (!payload || !payload.id || !payload.jti) {
    throw new AppError('Invalid refresh token payload', 500);
  }
  return jwt.sign(
    { id: payload.id, jti: payload.jti },
    REFRESH_SECRET,
    {
      expiresIn: REFRESH_EXPIRY,
      issuer:    'collectly',
      audience:  'collectly-client',
      algorithm: 'HS256',
    }
  );
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, ACCESS_SECRET, {
      issuer:     'collectly',
      audience:   'collectly-client',
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid access token', 401, 'INVALID_TOKEN');
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, REFRESH_SECRET, {
      issuer:     'collectly',
      audience:   'collectly-client',
      algorithms: ['HS256'],
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Refresh token expired. Please log in again.', 401, 'REFRESH_TOKEN_EXPIRED');
    }
    throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }
};

const decodeToken = (token) => jwt.decode(token);

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeToken,
};


