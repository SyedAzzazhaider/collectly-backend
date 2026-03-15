'use strict';

const User                   = require('../models/User.model');
const { signAccessToken,
        signRefreshToken,
        verifyRefreshToken } = require('../../../shared/utils/jwt.util');
const { generateSecureToken,
        generateJti,
        generateRefreshTokenEntry,
        hashToken }          = require('../../../shared/utils/token.util');
const { encrypt,
        decrypt,
        generateOtpLabel }   = require('../../../shared/utils/crypto.util');
const AppError               = require('../../../shared/errors/AppError');
const logger                 = require('../../../shared/utils/logger');
const speakeasy              = require('speakeasy');
const qrcode                 = require('qrcode');

// -- Constants -----------------------------------------------------------------

const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const MAX_REFRESH_SESSIONS      = 5;
const COOKIE_MAX_AGE_MS         = REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// -- Cookie helpers ------------------------------------------------------------

const attachRefreshCookie = (res, token) => {
  if (!res || typeof res.cookie !== 'function') return;
  res.cookie('collectly_refresh', token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   COOKIE_MAX_AGE_MS,
    // No path restriction � cookie sent on all /api/v1/auth/* requests
  });
};

const clearRefreshCookie = (res) => {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie('collectly_refresh', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
};

// -- Token pair builder --------------------------------------------------------

const issueTokenPair = async (user, res, meta = {}) => {
  const jti          = generateJti();
  const plainRefresh = generateSecureToken(48);

  const accessPayload = {
    id:                String(user._id),
    role:              user.role,
    subscriptionPlan:  user.subscriptionPlan,
    twoFactorEnabled:  user.twoFactorEnabled  || false,
    twoFactorVerified: meta.twoFactorVerified || false,
  };

  const refreshPayload = { id: String(user._id), jti };

  const accessToken = signAccessToken(accessPayload);
  signRefreshToken(refreshPayload);

  const entry   = generateRefreshTokenEntry(
    plainRefresh,
    meta.ip,
    meta.userAgent,
    REFRESH_TOKEN_EXPIRY_DAYS
  );
  entry.jti = jti;

  const userDoc = await User.findById(user._id).select('+refreshTokens');
  if (!userDoc) throw new AppError('User not found', 404);

  const now    = new Date();
  let sessions = (userDoc.refreshTokens || []).filter((s) => s.expiresAt > now);

  if (sessions.length >= MAX_REFRESH_SESSIONS) {
    sessions.sort((a, b) => a.createdAt - b.createdAt);
    sessions = sessions.slice(sessions.length - (MAX_REFRESH_SESSIONS - 1));
  }

  sessions.push(entry);
  userDoc.refreshTokens = sessions;
  await userDoc.save({ validateBeforeSave: false });

  attachRefreshCookie(res, plainRefresh);

  return { accessToken, plainRefresh };
};

// -- Signup --------------------------------------------------------------------

const signup = async ({ name, email, password }, res, meta = {}) => {
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    throw new AppError('An account with this email already exists.', 409, 'DUPLICATE_EMAIL');
  }

  const user = await User.create({
    name,
    email:            email.toLowerCase(),
    password,
    role:             'owner',
    subscriptionPlan: 'starter',
    oauthProvider:    'local',
  });

  logger.info(`New user registered: ${user.email} [${user._id}]`);

  const { accessToken } = await issueTokenPair(user, res, meta);

  return {
    user: {
      id:               String(user._id),
      name:             user.name,
      email:            user.email,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt:        user.createdAt,
    },
    accessToken,
  };
};

// -- Login ---------------------------------------------------------------------

const login = async ({ email, password }, res, meta = {}) => {
  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+password +twoFactorEnabled +twoFactorSecret +twoFactorVerified +isActive +lockedUntil +failedLoginAttempts +oauthProvider');

  const GENERIC = new AppError('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
  if (!user) throw GENERIC;

  if (!user.isActive) {
    throw new AppError('Account deactivated. Please contact support.', 403, 'ACCOUNT_INACTIVE');
  }

  if (user.isLocked()) {
    throw new AppError(
      `Account temporarily locked. Try again after ${user.lockedUntil.toISOString()}.`,
      403,
      'ACCOUNT_LOCKED'
    );
  }

  if (user.oauthProvider !== 'local' && !user.password) {
    throw new AppError(
      `This account uses ${user.oauthProvider} login.`,
      400,
      'OAUTH_ACCOUNT'
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    await user.incrementFailedLogin();
    throw GENERIC;
  }

  await user.resetFailedLogin();

  if (user.twoFactorEnabled) {
    const preAuthToken = signAccessToken({
      id:                String(user._id),
      role:              user.role,
      subscriptionPlan:  user.subscriptionPlan,
      twoFactorEnabled:  true,
      twoFactorVerified: false,
    });

    logger.info(`2FA challenge issued: ${user.email}`);
    return { requires2FA: true, preAuthToken, userId: String(user._id) };
  }

  logger.info(`User logged in: ${user.email}`);
  const { accessToken } = await issueTokenPair(user, res, meta);

  return {
    requires2FA: false,
    user: {
      id:               String(user._id),
      name:             user.name,
      email:            user.email,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt:        user.createdAt,
    },
    accessToken,
  };
};

// -- Refresh Token -------------------------------------------------------------

const refreshTokens = async (plainRefreshToken, res, meta = {}) => {
  const hashedIncoming = hashToken(plainRefreshToken);
  const now            = new Date();

  // Look up by hashed token value directly in DB
  const user = await User.findOne({
    'refreshTokens.token': hashedIncoming,
  }).select('+refreshTokens +isActive +lockedUntil +role +subscriptionPlan +twoFactorEnabled');

  if (!user) {
    // Token not found at all � invalid or already rotated (possible reuse)
    clearRefreshCookie(res);
    throw new AppError(
      'Invalid or expired refresh token. Please log in again.',
      401,
      'INVALID_REFRESH_TOKEN'
    );
  }

  if (!user.isActive) {
    throw new AppError('Account deactivated.', 403, 'ACCOUNT_INACTIVE');
  }

  const sessionIndex = user.refreshTokens.findIndex(
    (s) => s.token === hashedIncoming && s.expiresAt > now
  );

  if (sessionIndex === -1) {
    // Token exists in DB but is expired � reuse attack detected
    // Wipe ALL sessions to force re-authentication on every device
    logger.warn(`Reuse/expired token detected for ${user.email}. Wiping all sessions.`);
    user.refreshTokens = [];
    await user.save({ validateBeforeSave: false });
    clearRefreshCookie(res);
    throw new AppError(
      'Invalid or expired refresh token. Please log in again.',
      401,
      'INVALID_REFRESH_TOKEN'
    );
  }

  // Valid session � remove it before issuing new pair (single-use enforcement)
  user.refreshTokens.splice(sessionIndex, 1);
  await user.save({ validateBeforeSave: false });

  // Issue new pair � adds a new session atomically
  const { accessToken } = await issueTokenPair(user, res, meta);

  logger.info(`Tokens rotated for user: ${user.email}`);
  return { accessToken };
};

// -- Logout --------------------------------------------------------------------

const logout = async (userId, plainRefreshToken, res) => {
  if (userId && plainRefreshToken) {
    const user = await User.findById(userId).select('+refreshTokens');
    if (user) {
      const hashedIncoming = hashToken(plainRefreshToken);
      user.refreshTokens   = user.refreshTokens.filter(
        (s) => s.token !== hashedIncoming
      );
      await user.save({ validateBeforeSave: false });
    }
  }
  clearRefreshCookie(res);
  logger.info(`User logged out: ${userId}`);
};

// -- Logout All ----------------------------------------------------------------

const logoutAll = async (userId, res) => {
  const user = await User.findById(userId).select('+refreshTokens');
  if (user) {
    user.refreshTokens = [];
    await user.save({ validateBeforeSave: false });
  }
  clearRefreshCookie(res);
  logger.info(`All sessions cleared for user: ${userId}`);
};

// -- 2FA Setup -----------------------------------------------------------------

const setup2FA = async (userId) => {
  const user = await User.findById(userId)
    .select('+twoFactorSecret +twoFactorEnabled');
  if (!user) throw new AppError('User not found.', 404);

  if (user.twoFactorEnabled) {
    throw new AppError('2FA is already enabled on this account.', 400, '2FA_ALREADY_ENABLED');
  }

  const secret = speakeasy.generateSecret({
    name:   generateOtpLabel(user.email),
    length: 32,
  });

  user.twoFactorSecret   = encrypt(secret.base32);
  user.twoFactorVerified = false;
  await user.save({ validateBeforeSave: false });

  const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
  return { secret: secret.base32, qrCode: qrDataUrl, otpAuthUrl: secret.otpauth_url };
};

// -- 2FA Verify & Enable -------------------------------------------------------

const verify2FA = async (userId, totpCode, res, meta = {}) => {
  const user = await User.findById(userId)
    .select('+twoFactorSecret +twoFactorEnabled +twoFactorVerified');

  if (!user)                 throw new AppError('User not found.', 404);
  if (!user.twoFactorSecret) throw new AppError('2FA setup not initiated.', 400, '2FA_NOT_SETUP');

  const decryptedSecret = decrypt(user.twoFactorSecret);

  const isValid = speakeasy.totp.verify({
    secret:   decryptedSecret,
    encoding: 'base32',
    token:    totpCode,
    window:   1,
  });

  if (!isValid) {
    throw new AppError('Invalid 2FA code. Please try again.', 401, 'INVALID_2FA_CODE');
  }

  if (!user.twoFactorEnabled) {
    user.twoFactorEnabled  = true;
    user.twoFactorVerified = true;
    await user.save({ validateBeforeSave: false });
    logger.info(`2FA enabled for user: ${user.email}`);
  }

  const { accessToken } = await issueTokenPair(
    {
      _id:              user._id,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: true,
    },
    res,
    { ...meta, twoFactorVerified: true }
  );

  return { accessToken };
};

// -- 2FA Disable ---------------------------------------------------------------

const disable2FA = async (userId, totpCode) => {
  const user = await User.findById(userId)
    .select('+twoFactorSecret +twoFactorEnabled');

  if (!user)                  throw new AppError('User not found.', 404);
  if (!user.twoFactorEnabled) throw new AppError('2FA is not enabled.', 400, '2FA_NOT_ENABLED');

  const decryptedSecret = decrypt(user.twoFactorSecret);
  const isValid = speakeasy.totp.verify({
    secret:   decryptedSecret,
    encoding: 'base32',
    token:    totpCode,
    window:   1,
  });

  if (!isValid) {
    throw new AppError('Invalid 2FA code.', 401, 'INVALID_2FA_CODE');
  }

  user.twoFactorEnabled  = false;
  user.twoFactorVerified = false;
  user.twoFactorSecret   = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`2FA disabled for user: ${user.email}`);
};

// -- OAuth Login ---------------------------------------------------------------

const oauthLogin = async ({ provider, providerId, email, name }, res, meta = {}) => {
  if (!['google', 'microsoft'].includes(provider)) {
    throw new AppError('Unsupported OAuth provider.', 400, 'INVALID_PROVIDER');
  }

  const providerField = provider === 'google' ? 'googleId' : 'microsoftId';

  let user = await User.findOne({ [providerField]: providerId })
    .select(`+${providerField} +isActive`);

  if (!user && email) {
    user = await User.findOne({ email: email.toLowerCase() })
      .select(`+${providerField} +isActive`);

    if (user) {
      user[providerField]  = providerId;
      user.oauthProvider   = provider;
      user.isEmailVerified = true;
      await user.save({ validateBeforeSave: false });
      logger.info(`OAuth linked [${provider}] to existing account: ${user.email}`);
    }
  }

  if (!user) {
    user = await User.create({
      name,
      email:            email.toLowerCase(),
      [providerField]:  providerId,
      oauthProvider:    provider,
      isEmailVerified:  true,
      role:             'owner',
      subscriptionPlan: 'starter',
    });
    logger.info(`New OAuth account created [${provider}]: ${user.email}`);
  }

  if (!user.isActive) {
    throw new AppError('Account deactivated. Please contact support.', 403, 'ACCOUNT_INACTIVE');
  }

  const { accessToken } = await issueTokenPair(user, res, meta);

  return {
    user: {
      id:               String(user._id),
      name:             user.name,
      email:            user.email,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt:        user.createdAt,
    },
    accessToken,
  };
};

// -- Get Me --------------------------------------------------------------------

const getMe = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError('User not found.', 404);
  return user;
};


// ── Change Password ───────────────────────────────────────────────────────────

const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('User not found.', 404);

  // Verify current password
  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AppError('Current password is incorrect.', 401, 'WRONG_CURRENT_PASSWORD');
  }

  // Prevent reuse of same password
  if (currentPassword === newPassword) {
    throw new AppError(
      'New password must be different from your current password.',
      400,
      'SAME_PASSWORD'
    );
  }

  // Update password — pre-save hook hashes automatically
  user.password = newPassword;
  await user.save();

  // Invalidate ALL refresh sessions — force re-login on every device
  const userDoc = await User.findById(userId).select('+refreshTokens');
  if (userDoc) {
    userDoc.refreshTokens = [];
    await userDoc.save({ validateBeforeSave: false });
  }

  logger.info(`Password changed for user: ${userId} — all sessions invalidated`);
};



// -- Exports -------------------------------------------------------------------

module.exports = {
  signup,
  login,
  refreshTokens,
  logout,
  logoutAll,
  setup2FA,
  verify2FA,
  disable2FA,
  oauthLogin,
  getMe,
  changePassword,
};
