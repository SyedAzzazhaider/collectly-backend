'use strict';

const express    = require('express');
const router     = express.Router();

const authController = require('../controllers/auth.controller');
const { protect }    = require('../../../shared/middlewares/auth.middleware');
const { authLimiter} = require('../../../shared/middlewares/rateLimiter');

const {
  validateSignup,
  validateLogin,
  validateRefreshToken,
  validateTwoFactor,
  validateChangePassword,
} = require('../validators/auth.validator');

// -- Public routes -------------------------------------------------------------

router.post('/signup',  authLimiter, validateSignup, authController.signup);
router.post('/login',   authLimiter, validateLogin,  authController.login);
router.post('/refresh', validateRefreshToken,        authController.refreshTokens);

// -- 2FA semi-public � called after login with preAuthToken --------------------

router.post('/2fa/verify', authLimiter, validateTwoFactor, authController.verify2FA);

// -- Protected routes ----------------------------------------------------------

router.post('/logout',     protect, authController.logout);
router.post('/logout-all', protect, authController.logoutAll);
router.patch('/password',protect,validateChangePassword,authController.changePassword);
router.get('/me',          protect, authController.getMe);

// -- 2FA protected � skip2FAGate so users mid-setup can still hit these --------

router.post('/2fa/setup', (req, res, next) => {
  req.skip2FAGate = true;
  next();
}, protect, authController.setup2FA);

router.post('/2fa/disable', protect, validateTwoFactor, authController.disable2FA);

module.exports = router;
