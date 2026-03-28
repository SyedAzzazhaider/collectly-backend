'use strict';

const express    = require('express');
const router     = express.Router();
const rateLimit  = require('express-rate-limit');

const authController                    = require('../controllers/auth.controller');
const { protect, optionalAuth }         = require('../../../shared/middlewares/auth.middleware');
const { authLimiter }                   = require('../../../shared/middlewares/rateLimiter');
const {
  validateSignup,
  validateLogin,
  validateRefreshToken,
  validateTwoFactor,
  validateChangePassword,
  validateForgotPassword,
  validateResetPassword,
} = require('../validators/auth.validator');

const resetPasswordLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { status: 'fail', message: 'Too many password reset attempts. Try again in 1 hour.' },
  skip:            (req) => process.env.NODE_ENV === 'test',
});

router.post('/signup',  authLimiter, validateSignup, authController.signup);
router.post('/login',   authLimiter, validateLogin,  authController.login);
router.post('/refresh', validateRefreshToken,        authController.refreshTokens);

router.post('/forgot-password',       authLimiter,          validateForgotPassword, authController.forgotPassword);
router.post('/reset-password/:token', resetPasswordLimiter, validateResetPassword,  authController.resetPassword);

router.get('/verify-email/:token', authController.verifyEmail);

router.post('/2fa/verify', authLimiter, validateTwoFactor, optionalAuth, authController.verify2FA);

router.post('/logout',     protect, authController.logout);
router.post('/logout-all', protect, authController.logoutAll);
router.patch('/password',  protect, validateChangePassword, authController.changePassword);
router.get('/me',          protect, authController.getMe);
router.patch('/profile',   protect, authController.updateProfile);
router.get('/sessions',    protect, authController.getSessions);

router.post('/resend-verification', protect, authController.sendVerificationEmail);

router.post('/2fa/setup', (req, res, next) => {
  req.skip2FAGate = true;
  next();
}, protect, authController.setup2FA);

router.post('/2fa/disable', (req, res, next) => {
  req.skip2FAGate = true;
  next();
}, protect, validateTwoFactor, authController.disable2FA);

module.exports = router;


