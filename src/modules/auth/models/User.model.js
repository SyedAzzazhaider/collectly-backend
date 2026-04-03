'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const SALT_ROUNDS = 12;

const sessionSchema = new mongoose.Schema(
  {
    token:     { type: String, required: true },
    ip:        { type: String },
    userAgent: { type: String },
    jti:       { type: String },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, 'Name is required'],
      trim:      true,
      minlength: [2,   'Name must be at least 2 characters'],
      maxlength: [100, 'Name must be at most 100 characters'],
    },
    email: {
      type:      String,
      required:  [true, 'Email is required'],
      unique:    true,
      lowercase: true,
      trim:      true,
      match:     [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    // ✅ ADD THIS PHONE FIELD HERE
    phone: {
      type:      String,
      default:   null,
      trim:      true,
      maxlength: 20,
    },
    password: {
      type:      String,
      minlength: [8, 'Password must be at least 8 characters'],
      select:    false,
    },
    role: {
      type:    String,
      enum:    ['admin', 'owner', 'agent', 'accountant'],
      default: 'owner',
    },
    subscriptionPlan: {
      type:    String,
      enum:    ['starter', 'pro', 'enterprise'],
      default: 'starter',
    },

    // OAuth
    googleId:      { type: String, select: false },
    microsoftId:   { type: String, select: false },
    oauthProvider: {
      type:    String,
      enum:    ['local', 'google', 'microsoft'],
      default: 'local',
    },

    // 2FA
    twoFactorSecret:   { type: String,  select: false },
    twoFactorEnabled:  { type: Boolean, default: false },
    twoFactorVerified: { type: Boolean, default: false },

    // Refresh token sessions (hashed)
    refreshTokens: {
      type:    [sessionSchema],
      select:  false,
      default: [],
    },

    // Account state
    isEmailVerified:    { type: Boolean, default: false },
    emailVerifyToken:   { type: String,  select: false },
    emailVerifyExpires: { type: Date,    select: false },

    passwordResetToken:   { type: String, select: false },
    passwordResetExpires: { type: Date,   select: false },

    isActive: { type: Boolean, default: true },

    // ── Notification Preferences ────────────────────────────────────────────────
    notifications: {
      type: Object,
      default: {
        paymentReceived: true,
        invoiceOverdue: true,
        customerReply: true,
        weeklyDigest: true,
        systemAlerts: true,
      },
    },

    // ── Legal acceptance ──────────────────────────────────────────────────────────
    tosAcceptedAt: {
      type:    Date,
      default: null,
    },
    tosVersion: {
      type:    String,
      default: null,
    },
    privacyAcceptedAt: {
      type:    Date,
      default: null,
    },

    lockedUntil:         { type: Date,    default: null },
    failedLoginAttempts: { type: Number,  default: 0 },

    // ── Audit tracking ────────────────────────────────────────────────────────
    lastLoginAt: {
      type:    Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.password;
        delete ret.twoFactorSecret;
        delete ret.refreshTokens;
        delete ret.googleId;
        delete ret.microsoftId;
        delete ret.emailVerifyToken;
        delete ret.emailVerifyExpires;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
userSchema.index({ googleId: 1 },    { sparse: true });
userSchema.index({ microsoftId: 1 }, { sparse: true });

// ── Token lookup indexes ───────────────────────────────────────────────────────
userSchema.index({ passwordResetToken: 1 },  { sparse: true });
userSchema.index({ emailVerifyToken: 1 },     { sparse: true });

// ── TTL indexes — auto-expire stale tokens from DB ────────────────────────────

// ── Pre-save: hash password ───────────────────────────────────────────────────
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  if (this.password.startsWith('$2b$')) return next();  // ← Prevent double hash
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────
userSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.isLocked = function () {
  return !!(this.lockedUntil && this.lockedUntil > Date.now());
};

userSchema.methods.incrementFailedLogin = async function () {
  this.failedLoginAttempts += 1;
  if (this.failedLoginAttempts >= 5) {
    const lockoutMinutes = parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES, 10) || 15;
    this.lockedUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
  }
  await this.save({ validateBeforeSave: false });
};

userSchema.methods.resetFailedLogin = async function () {
  if (this.failedLoginAttempts > 0 || this.lockedUntil) {
    this.failedLoginAttempts = 0;
    this.lockedUntil         = null;
    await this.save({ validateBeforeSave: false });
  }
};

const User = mongoose.model('User', userSchema);
module.exports = User;