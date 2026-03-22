'use strict';

const User      = require('../../modules/auth/models/User.model');
const { verifyAccessToken } = require('../utils/jwt.util');
const AppError  = require('../errors/AppError');

const extractBearerToken = (req) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return token && token.length > 10 ? token : null;
};

// -- protect -------------------------------------------------------------------

const protect = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return next(new AppError('Authentication required. Please log in.', 401, 'NO_TOKEN'));
    }

    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.id).select(
      '+isActive +lockedUntil +twoFactorEnabled +twoFactorVerified'
    );

    if (!user) {
      return next(new AppError('User no longer exists.', 401, 'USER_NOT_FOUND'));
    }

    if (!user.isActive) {
      return next(new AppError('Your account has been deactivated.', 403, 'ACCOUNT_INACTIVE'));
    }

    if (user.isLocked()) {
      return next(new AppError('Account is temporarily locked.', 403, 'ACCOUNT_LOCKED'));
    }

    // 2FA gate — skip for routes that explicitly opt out via req.skip2FAGate
    // This allows setup2FA to check its own state internally
    if (user.twoFactorEnabled && !decoded.twoFactorVerified && !req.skip2FAGate) {
      return next(new AppError('Two-factor authentication is required.', 403, '2FA_REQUIRED'));
    }

    req.user = {
      id:               String(user._id),
      name:             user.name,
      email:            user.email,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: user.twoFactorEnabled,
    };

    next();
  } catch (err) {
    if (err.isOperational) return next(err);
    next(new AppError('Authentication failed.', 401, 'AUTH_FAILED'));
  }
};

// -- restrictTo ----------------------------------------------------------------

const restrictTo = (...roles) => {
  const VALID_ROLES = ['admin', 'owner', 'agent', 'accountant'];
  const invalid = roles.filter((r) => !VALID_ROLES.includes(r));
  if (invalid.length > 0) {
    throw new Error(`restrictTo received invalid roles: ${invalid.join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required before authorization.', 401, 'NO_TOKEN'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to perform this action.', 403, 'FORBIDDEN'));
    }
    next();
  };
};

// -- optionalAuth --------------------------------------------------------------

const optionalAuth = async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) return next();

    const decoded = verifyAccessToken(token);
    const user    = await User.findById(decoded.id).select('+isActive');

    if (user && user.isActive && !user.isLocked()) {
      req.user = {
        id:               String(user._id),
        name:             user.name,
        email:            user.email,
        role:             user.role,
        subscriptionPlan: user.subscriptionPlan,
        twoFactorEnabled: user.twoFactorEnabled,
      };
    }
    next();
  } catch {
    next();
  }
};

module.exports = { protect, restrictTo, optionalAuth };


