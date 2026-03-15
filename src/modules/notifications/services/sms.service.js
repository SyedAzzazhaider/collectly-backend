'use strict';

const logger = require('../../../shared/utils/logger');

// ── Lazy Twilio initialization ────────────────────────────────────────────────

let _twilioClient = null;

const getTwilio = () => {
  if (_twilioClient) return _twilioClient;
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    process.env.TWILIO_ACCOUNT_SID.includes('your_')
  ) {
    return null;
  }
  const twilio      = require('twilio');
  _twilioClient     = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _twilioClient;
};

const isSmsEnabled = () => !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER &&
  !process.env.TWILIO_ACCOUNT_SID.includes('your_')
);

const isWhatsAppEnabled = () => isSmsEnabled() && !!process.env.TWILIO_WHATSAPP_NUMBER;

// ── Sanitize phone number ─────────────────────────────────────────────────────

const sanitizePhone = (phone) => {
  const cleaned = String(phone).replace(/\s/g, '');
  if (!cleaned.startsWith('+')) return `+${cleaned}`;
  return cleaned;
};

// ── Send SMS ──────────────────────────────────────────────────────────────────

const sendSms = async ({ to, body }) => {
  const startTime = Date.now();

  if (!isSmsEnabled()) {
    logger.warn('Twilio not configured — SMS delivery simulated');
    return {
      success:           true,
      simulated:         true,
      providerMessageId: `sim_sms_${Date.now()}`,
      durationMs:        Date.now() - startTime,
      provider:          'twilio_simulated',
    };
  }

  const client = getTwilio();
  const toPhone = sanitizePhone(to);

  // Enforce 160-char SMS limit — truncate if necessary
  const truncatedBody = body.length > 1600
    ? body.substring(0, 1597) + '...'
    : body;

  try {
    const message = await client.messages.create({
      body: truncatedBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to:   toPhone,
    });

    const duration = Date.now() - startTime;
    logger.info(`SMS sent: to=${toPhone} sid=${message.sid} duration=${duration}ms`);

    return {
      success:           true,
      simulated:         false,
      providerMessageId: message.sid,
      providerResponse:  message.status,
      durationMs:        duration,
      provider:          'twilio',
    };
  } catch (err) {
    const duration     = Date.now() - startTime;
    const errorCode    = String(err.code || 'UNKNOWN');
    const errorMessage = err.message || 'Twilio error';

    logger.error(`SMS failed: to=${toPhone} error=${errorMessage} code=${errorCode}`);

    return {
      success:      false,
      simulated:    false,
      durationMs:   duration,
      provider:     'twilio',
      errorCode,
      errorMessage,
    };
  }
};

// ── Send WhatsApp ─────────────────────────────────────────────────────────────

const sendWhatsApp = async ({ to, body }) => {
  const startTime = Date.now();

  if (!isWhatsAppEnabled()) {
    logger.warn('Twilio WhatsApp not configured — WhatsApp delivery simulated');
    return {
      success:           true,
      simulated:         true,
      providerMessageId: `sim_wa_${Date.now()}`,
      durationMs:        Date.now() - startTime,
      provider:          'twilio_whatsapp_simulated',
    };
  }

  const client  = getTwilio();
  const toPhone = `whatsapp:${sanitizePhone(to)}`;

  try {
    const message = await client.messages.create({
      body,
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to:   toPhone,
    });

    const duration = Date.now() - startTime;
    logger.info(`WhatsApp sent: to=${toPhone} sid=${message.sid} duration=${duration}ms`);

    return {
      success:           true,
      simulated:         false,
      providerMessageId: message.sid,
      providerResponse:  message.status,
      durationMs:        duration,
      provider:          'twilio_whatsapp',
    };
  } catch (err) {
    const duration     = Date.now() - startTime;
    const errorCode    = String(err.code || 'UNKNOWN');
    const errorMessage = err.message || 'Twilio WhatsApp error';

    logger.error(`WhatsApp failed: to=${toPhone} error=${errorMessage} code=${errorCode}`);

    return {
      success:      false,
      simulated:    false,
      durationMs:   duration,
      provider:     'twilio_whatsapp',
      errorCode,
      errorMessage,
    };
  }
};

module.exports = {
  isSmsEnabled,
  isWhatsAppEnabled,
  sendSms,
  sendWhatsApp,
};