const AppError = require('../../../shared/errors/AppError');

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_REGEX    = /^\S+@\S+\.\S+$/;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&^#])[A-Za-z\d@$!%*?&^#]{8,72}$/;
const NAME_REGEX     = /^[a-zA-Z\s'-]{2,100}$/;

const isString  = (v) => typeof v === 'string';
const isMissing = (v) => v === undefined || v === null || (isString(v) && v.trim() === '');

const sanitize  = (v) => (isString(v) ? v.trim() : v);

/**
 * Build a validation error with field-level details
 */
const validationError = (message, fields = {}) => {
  const err = new AppError(message, 422, 'VALIDATION_ERROR');
  err.fields = fields;
  return err;
};

// ── Signup ────────────────────────────────────────────────────────────────────

const validateSignup = (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    const errors = {};

    // name
    if (isMissing(name)) {
      errors.name = 'Name is required';
    } else if (!NAME_REGEX.test(sanitize(name))) {
      errors.name = 'Name must be 2–100 characters and contain only letters, spaces, hyphens, or apostrophes';
    }

    // email
    if (isMissing(email)) {
      errors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(sanitize(email).toLowerCase())) {
      errors.email = 'Please provide a valid email address';
    }

    // password
    if (isMissing(password)) {
      errors.password = 'Password is required';
    } else if (!PASSWORD_REGEX.test(password)) {
      errors.password =
        'Password must be 8–72 characters and include at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&^#)';
    }

    // confirmPassword
    if (isMissing(confirmPassword)) {
      errors.confirmPassword = 'Password confirmation is required';
    } else if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    // Terms of Service acceptance
    if (!req.body.tosAccepted || req.body.tosAccepted !== true) {
      errors.tosAccepted = 'You must accept the Terms of Service and Privacy Policy to register';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Signup validation failed', errors));
    }

    // Sanitize safe fields onto req.body before handing to controller
    req.body.name  = sanitize(name);
    req.body.email = sanitize(email).toLowerCase();

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Login ─────────────────────────────────────────────────────────────────────

const validateLogin = (req, res, next) => {
  try {
    const { email, password } = req.body;
    const errors = {};

    if (isMissing(email)) {
      errors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(sanitize(email).toLowerCase())) {
      errors.email = 'Please provide a valid email address';
    }

    if (isMissing(password)) {
      errors.password = 'Password is required';
    } else if (!isString(password) || password.length < 8) {
      errors.password = 'Invalid password';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Login validation failed', errors));
    }

    req.body.email = sanitize(email).toLowerCase();

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Refresh Token ─────────────────────────────────────────────────────────────

const validateRefreshToken = (req, res, next) => {
  try {
    // Accept token from httpOnly cookie (preferred) or body (fallback)
    const token =
      req.cookies?.collectly_refresh ||
      req.body?.refreshToken;

    if (isMissing(token)) {
      return next(new AppError('Refresh token is required', 400, 'MISSING_REFRESH_TOKEN'));
    }

    if (!isString(token) || token.trim().length < 10) {
      return next(new AppError('Invalid refresh token format', 400, 'INVALID_REFRESH_TOKEN'));
    }

    req.refreshToken = token.trim();
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── 2FA Verify ────────────────────────────────────────────────────────────────

const validateTwoFactor = (req, res, next) => {
  try {
    const { totpCode } = req.body;
    const errors = {};

    if (isMissing(totpCode)) {
      errors.totpCode = '2FA code is required';
    } else if (!/^\d{6}$/.test(String(totpCode).trim())) {
      errors.totpCode = '2FA code must be a 6-digit number';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('2FA validation failed', errors));
    }

    req.body.totpCode = String(totpCode).trim();
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Change Password ───────────────────────────────────────────────────────────

const validateChangePassword = (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const errors = {};

    if (isMissing(currentPassword)) {
      errors.currentPassword = 'Current password is required';
    }

    if (isMissing(newPassword)) {
      errors.newPassword = 'New password is required';
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      errors.newPassword =
        'Password must be 8–72 characters and include uppercase, lowercase, number, and special character';
    }

    if (isMissing(confirmPassword)) {
      errors.confirmPassword = 'Password confirmation is required';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (currentPassword && newPassword && currentPassword === newPassword) {
      errors.newPassword = 'New password must be different from current password';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Password validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};


// ── Forgot Password ───────────────────────────────────────────────────────────

const validateForgotPassword = (req, res, next) => {
  try {
    const { email } = req.body;
    const errors    = {};

    if (isMissing(email)) {
      errors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(sanitize(email).toLowerCase())) {
      errors.email = 'Please provide a valid email address';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Forgot password validation failed', errors));
    }

    req.body.email = sanitize(email).toLowerCase();
    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

// ── Reset Password ────────────────────────────────────────────────────────────

const validateResetPassword = (req, res, next) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const errors = {};

    if (isMissing(newPassword)) {
      errors.newPassword = 'New password is required';
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      errors.newPassword =
        'Password must be 8–72 characters and include uppercase, lowercase, number, and special character (@$!%*?&^#)';
    }

    if (isMissing(confirmPassword)) {
      errors.confirmPassword = 'Password confirmation is required';
    } else if (newPassword !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(errors).length > 0) {
      return next(validationError('Reset password validation failed', errors));
    }

    next();
  } catch {
    next(new AppError('Validation error', 422));
  }
};

module.exports = {
  validateSignup,
  validateLogin,
  validateRefreshToken,
  validateTwoFactor,
  validateChangePassword,
  validateForgotPassword,
  validateResetPassword,
};