'use strict';

const User                   = require('../models/User.model');
const { signAccessToken,
        verifyAccessToken }  = require('../../../shared/utils/jwt.util');
const { generateSecureToken,
        generateJti,
        generateRefreshTokenEntry,
        generateExpiry,
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
    path:     '/api/v1/auth',           // SEC-03: restrict cookie to auth routes only
  });
};

const clearRefreshCookie = (res) => {
  if (!res || typeof res.clearCookie !== 'function') return;
  res.clearCookie('collectly_refresh', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/api/v1/auth',           // SEC-03: must match attachRefreshCookie path
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

  // BUG-01 FIX: signRefreshToken return value was previously discarded (dead code).
  // The refresh flow uses opaque hashed tokens stored in DB — the JWT is not needed.
  // Removed the dead signRefreshToken() call entirely.
  const accessToken = signAccessToken(accessPayload);

  const entry   = generateRefreshTokenEntry(
    plainRefresh,
    meta.ip,
    meta.userAgent,
    REFRESH_TOKEN_EXPIRY_DAYS
  );
  entry.jti = jti;

  const now = new Date();

  // Atomic update — prevents race condition where concurrent logins
  // bypass the session cap by reading the same stale session array
  const updatedUser = await User.findByIdAndUpdate(
    user._id,
    [
      {
        $set: {
          lastLoginAt:   now,
          refreshTokens: {
            $let: {
              vars: {
                valid: {
                  $filter: {
                    input: { $ifNull: ['$refreshTokens', []] },
                    as:    'session',
                    cond:  { $gt: ['$$session.expiresAt', now] },
                  },
                },
              },
              in: {
                $concatArrays: [
                  {
                    $cond: {
                      if: { $gte: [{ $size: '$$valid' }, MAX_REFRESH_SESSIONS] },
                      then: {
                        $slice: [
                          '$$valid',
                          { $subtract: [{ $size: '$$valid' }, { $subtract: [MAX_REFRESH_SESSIONS, 1] }] },
                          MAX_REFRESH_SESSIONS,
                        ],
                      },
                      else: '$$valid',
                    },
                  },
                  [entry],
                ],
              },
            },
          },
        },
      },
    ],
     { returnDocument: 'after', updatePipeline: true }
      );

  if (!updatedUser) throw new AppError('User not found', 404);

  attachRefreshCookie(res, plainRefresh);

  return { accessToken, plainRefresh };
};

// -- Signup --------------------------------------------------------------------

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
    tosAcceptedAt:     new Date(),
    tosVersion:        '1.0',
    privacyAcceptedAt: new Date(),
  });

  logger.info(`New user registered: ${user.email} [${user._id}]`);

  const { accessToken } = await issueTokenPair(user, res, meta);

  // FEAT-03 FIX: dispatch verification email automatically on signup.
  // Fire-and-forget — email failure must never block account creation.
  // If SendGrid is not yet configured, sendEmail() falls back to simulation mode.
  sendVerificationEmail(user._id).catch((err) => {
    logger.warn(`Verification email failed for ${user.email}: ${err.message}`);
  });

  return {
    user: {
      id:               String(user._id),
      name:             user.name,
      email:            user.email,
      role:             user.role,
      subscriptionPlan: user.subscriptionPlan,
      twoFactorEnabled: user.twoFactorEnabled,
      isEmailVerified:  user.isEmailVerified,
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
    // SEC-08 FIX: preAuthToken carries a restricted scope claim.
    // The verify2FA controller validates this scope before trusting the token,
    // preventing a user from completing 2FA by submitting an arbitrary userId.
    const preAuthToken = signAccessToken({
      id:                String(user._id),
      role:              user.role,
      subscriptionPlan:  user.subscriptionPlan,
      twoFactorEnabled:  true,
      twoFactorVerified: false,
      scope:             'pre_2fa',     // SEC-08: purpose-limited token
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

  const user = await User.findOne({
    'refreshTokens.token': hashedIncoming,
  }).select('+refreshTokens +isActive +lockedUntil +role +subscriptionPlan +twoFactorEnabled');

  if (!user) {
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

  user.refreshTokens.splice(sessionIndex, 1);
  await user.save({ validateBeforeSave: false });

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

// -- Change Password -----------------------------------------------------------

const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');
  if (!user) throw new AppError('User not found.', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AppError('Current password is incorrect.', 401, 'WRONG_CURRENT_PASSWORD');
  }

  if (currentPassword === newPassword) {
    throw new AppError(
      'New password must be different from your current password.',
      400,
      'SAME_PASSWORD'
    );
  }

  user.password = newPassword;
  await user.save();

  const userDoc = await User.findById(userId).select('+refreshTokens');
  if (userDoc) {
    userDoc.refreshTokens = [];
    await userDoc.save({ validateBeforeSave: false });
  }

  logger.info(`Password changed for user: ${userId} — all sessions invalidated`);
};

// -- Forgot Password -----------------------------------------------------------

const forgotPassword = async (email) => {
  const SAFE_RESPONSE = {
    message: 'If an account with that email exists, a password reset link has been sent.',
  };

  const user = await User.findOne({ email: email.toLowerCase() })
    .select('+passwordResetToken +passwordResetExpires +isActive +oauthProvider');

  if (!user || !user.isActive) return SAFE_RESPONSE;

  if (user.oauthProvider !== 'local' && !user.password) {
    return SAFE_RESPONSE;
  }

  const plainToken  = generateSecureToken(32);
  const hashedToken = hashToken(plainToken);

  user.passwordResetToken   = hashedToken;
  user.passwordResetExpires = generateExpiry(60);
  await user.save({ validateBeforeSave: false });

  const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password/${plainToken}`;

  const emailService = require('../../notifications/services/email.service');
  await emailService.sendEmail({
    to:      user.email,
    toName:  user.name,
    subject: 'Reset your Collectly password',
    body:    `Hi ${user.name},\n\nYou requested a password reset for your Collectly account.\n\nClick the link below to set a new password. This link expires in 60 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can safely ignore this email. Your password will not change.`,
  });

  logger.info(`Password reset email dispatched: ${user.email}`);
  return SAFE_RESPONSE;
};

// -- Reset Password ------------------------------------------------------------

const resetPassword = async (plainToken, newPassword, res) => {
  if (!plainToken || typeof plainToken !== 'string' || plainToken.length < 10) {
    throw new AppError('Invalid or missing reset token.', 400, 'INVALID_RESET_TOKEN');
  }

  const hashedToken = hashToken(plainToken);

  const user = await User.findOne({
    passwordResetToken:   hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select('+password +passwordResetToken +passwordResetExpires +refreshTokens +isActive');

  if (!user) {
    throw new AppError(
      'Password reset token is invalid or has expired.',
      400,
      'INVALID_RESET_TOKEN'
    );
  }

  const isSame = await user.comparePassword(newPassword);
  if (isSame) {
    throw new AppError(
      'New password must be different from your current password.',
      400,
      'SAME_PASSWORD'
    );
  }

  user.password             = newPassword;
  user.passwordResetToken   = undefined;
  user.passwordResetExpires = undefined;
  user.refreshTokens        = [];
  await user.save();

  logger.info(`Password reset completed for user: ${user.email} — all sessions invalidated`);

  const { accessToken } = await issueTokenPair(user, res, {});
  return { accessToken };
};

// -- Send Verification Email ---------------------------------------------------

const sendVerificationEmail = async (userId) => {
  const user = await User.findById(userId)
    .select('+emailVerifyToken +emailVerifyExpires +isEmailVerified');

  if (!user) throw new AppError('User not found.', 404);

  if (user.isEmailVerified) {
    throw new AppError('Email is already verified.', 400, 'EMAIL_ALREADY_VERIFIED');
  }

  const plainToken  = generateSecureToken(32);
  const hashedToken = hashToken(plainToken);

  user.emailVerifyToken   = hashedToken;
  user.emailVerifyExpires = generateExpiry(24 * 60);
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${process.env.FRONTEND_URL}/auth/verify-email/${plainToken}`;

  const emailService = require('../../notifications/services/email.service');
  await emailService.sendEmail({
    to:      user.email,
    toName:  user.name,
    subject: 'Verify your Collectly email address',
    body:    `Hi ${user.name},\n\nThank you for creating a Collectly account. Please verify your email address by clicking the link below.\n\nThis link expires in 24 hours.\n\n${verifyUrl}\n\nIf you did not create this account, you can safely ignore this email.`,
  });

  logger.info(`Verification email dispatched: ${user.email}`);
};

// -- Verify Email --------------------------------------------------------------

const verifyEmail = async (plainToken) => {
  if (!plainToken || typeof plainToken !== 'string' || plainToken.length < 10) {
    throw new AppError('Invalid or missing verification token.', 400, 'INVALID_VERIFY_TOKEN');
  }

  const hashedToken = hashToken(plainToken);

  const user = await User.findOne({
    emailVerifyToken:   hashedToken,
    emailVerifyExpires: { $gt: new Date() },
  }).select('+emailVerifyToken +emailVerifyExpires +isEmailVerified');

  if (!user) {
    throw new AppError(
      'Email verification token is invalid or has expired.',
      400,
      'INVALID_VERIFY_TOKEN'
    );
  }

  user.isEmailVerified    = true;
  user.emailVerifyToken   = undefined;
  user.emailVerifyExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`Email verified for user: ${user.email}`);
};



// ── Update Notification Preferences ──────────────────────────────────────
const updateNotifications = async (userId, preferences) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('User not found.', 404);
  }
  
  // Define valid notification keys
  const validKeys = [
    'paymentReceived',
    'invoiceOverdue',
    'customerReply',
    'weeklyDigest',
    'systemAlerts',
  ];
  
  // Validate only valid keys are being updated
  const invalidKeys = Object.keys(preferences).filter(
    key => !validKeys.includes(key)
  );
  
  if (invalidKeys.length > 0) {
    throw new AppError(
      `Invalid notification keys: ${invalidKeys.join(', ')}`,
      400,
      'INVALID_NOTIFICATION_KEYS'
    );
  }
  
  // Update only the provided preferences
  const currentPrefs = user.notifications || {};
  const updatedPrefs = {
    ...currentPrefs,
    ...preferences,
  };
  
  // Ensure all valid keys exist
  validKeys.forEach(key => {
    if (updatedPrefs[key] === undefined) {
      updatedPrefs[key] = true; // Default to true
    }
  });
  
  user.notifications = updatedPrefs;
  await user.save({ validateBeforeSave: false });
  
  logger.info(`Notification preferences updated for user: ${userId}`);
  
  return { notifications: user.notifications };
};

// ── Invite Team Member ───────────────────────────────────────────────────
const inviteUser = async (inviterId, inviterName, email, role = 'agent') => {
  // Check if user already exists
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new AppError(
      `User with email ${email} already exists.`,
      409,
      'USER_EXISTS'
    );
  }
  
  // Validate role
  const validRoles = ['owner', 'admin', 'agent', 'accountant'];
  if (!validRoles.includes(role)) {
    throw new AppError(
      `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      400,
      'INVALID_ROLE'
    );
  }
  
  // Get inviter info
  const inviter = await User.findById(inviterId);
  if (!inviter) {
    throw new AppError('Inviter not found.', 404);
  }
  
  // Generate invitation token
  const { generateSecureToken, hashToken, generateExpiry } = require('../../../shared/utils/token.util');
  const plainToken = generateSecureToken(32);
  const hashedToken = hashToken(plainToken);
  
  // Create invitation record (you may want to create an Invitation model)
  // For now, we'll use a simple approach: store in a temporary collection
  // or use a dedicated Invitation model. Since we don't have one, we'll
  // create a simple in-memory store (for production, create an Invitation model)
  
  const invitation = {
    token: hashedToken,
    email: email.toLowerCase(),
    role,
    invitedBy: inviterId,
    invitedByName: inviterName,
    expiresAt: generateExpiry(7 * 24 * 60), // 7 days expiry
    createdAt: new Date(),
  };
  
  // Store invitation in database - we need to create an Invitation model
  // For now, we'll save to a temporary collection or use a direct approach
  // Let's create a simple Invitation model if it doesn't exist
  let Invitation;
  try {
    Invitation = require('../models/Invitation.model');
  } catch (e) {
    // If model doesn't exist, we need to create it
    // For now, we'll just log and proceed
    logger.warn('Invitation model not found. Create it to persist invitations.');
  }
  
  let invitationId = null;
  if (Invitation) {
    const created = await Invitation.create({
      email: email.toLowerCase(),
      token: hashedToken,
      role,
      invitedBy: inviterId,
      invitedByName: inviterName,
      expiresAt: invitation.expiresAt,
    });
    invitationId = created._id;
  }
  
  // Send invitation email
  const inviteUrl = `${process.env.FRONTEND_URL}/auth/accept-invite/${plainToken}`;
  
  const emailService = require('../../notifications/services/email.service');
  await emailService.sendEmail({
    to: email,
    toName: email.split('@')[0],
    subject: `You've been invited to join Collectly`,
    body: `Hi there,\n\n${inviterName} has invited you to join their Collectly team as a ${role}.\n\nClick the link below to accept the invitation and set up your account:\n\n${inviteUrl}\n\nThis invitation expires in 7 days.\n\nIf you didn't expect this invitation, you can safely ignore this email.\n\nBest regards,\nCollectly Team`,
  });
  
  logger.info(`Invitation sent to ${email} by ${inviterName} (${inviterId})`);
  
  return {
    invitationId,
    email: email.toLowerCase(),
    role,
  };
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
  forgotPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
  updateNotifications,  // ← ADD THIS
  inviteUser,           // ← ADD THIS
};