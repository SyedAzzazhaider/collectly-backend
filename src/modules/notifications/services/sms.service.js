'use strict';

const logger = require('../../../shared/utils/logger');

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
  const twilio  = require('twilio');
  _twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return _twilioClient;
};

const isSmsEnabled = () => !!(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER &&
  !process.env.TWILIO_ACCOUNT_SID.includes('your_')
);

const isWhatsAppEnabled = () => isSmsEnabled() && !!process.env.TWILIO_WHATSAPP_NUMBER;

const sanitizePhone = (phone) => {
  const cleaned = String(phone).replace(/\s/g, '');
  if (!cleaned.startsWith('+')) return `+${cleaned}`;
  return cleaned;
};

// ── Send SMS ──────────────────────────────────────────────────────────────────

const sendSms = async ({ to, body }) => {
  const startTime = Date.now();

  // Primary: Twilio
  if (isSmsEnabled()) {
    const client    = getTwilio();
    const toPhone   = sanitizePhone(to);
    const truncatedBody = body.length > 1600 ? body.substring(0, 1597) + '...' : body;

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
  }

  // Fallback: Plivo
  if (
    process.env.PLIVO_AUTH_ID &&
    process.env.PLIVO_AUTH_TOKEN &&
    !process.env.PLIVO_AUTH_ID.includes('your_') &&
    process.env.PLIVO_AUTH_ID.trim() !== ''
  ) {
    try {
      const plivo  = require('plivo');
      const client = new plivo.Client(
        process.env.PLIVO_AUTH_ID,
        process.env.PLIVO_AUTH_TOKEN
      );
      const response = await client.messages.create(
        process.env.PLIVO_FROM_NUMBER,
        to,
        body
      );
      return {
        success:           true,
        providerMessageId: response.messageUuid?.[0] || `plivo_${Date.now()}`,
        durationMs:        Date.now() - startTime,
        provider:          'plivo',
      };
    } catch (err) {
      logger.error(`Plivo SMS error: ${err.message}`);
    }
  }

  // Simulated fallback
  logger.warn('No SMS provider configured — SMS delivery simulated');
  return {
    success:           true,
    simulated:         true,
    providerMessageId: `sim_sms_${Date.now()}`,
    durationMs:        Date.now() - startTime,
    provider:          'sms_simulated',
  };
};

// ── Send WhatsApp ─────────────────────────────────────────────────────────────

const sendWhatsApp = async ({ to, body }) => {
  const startTime = Date.now();

  // Primary: Meta Business API
  if (
    process.env.META_WABA_TOKEN &&
    process.env.META_PHONE_NUMBER_ID &&
    process.env.META_WABA_TOKEN.trim() !== ''
  ) {
    try {
      const https         = require('https');
      const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
      const token         = process.env.META_WABA_TOKEN;

      const payload = JSON.stringify({
        messaging_product: 'whatsapp',
        to:                to.replace('+', ''),
        type:              'text',
        text:              { body },
      });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'graph.facebook.com',
          path:     `/v19.0/${phoneNumberId}/messages`,
          method:   'POST',
          headers: {
            'Authorization':  `Bearer ${token}`,
            'Content-Type':   'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout: 10000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ success: true, messageId: parsed.messages?.[0]?.id });
              } else {
                reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
              }
            } catch (e) { reject(e); }
          });
        });
        req.on('error',   reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Meta WhatsApp timeout')); });
        req.write(payload);
        req.end();
      });

      return {
        success:           true,
        providerMessageId: result.messageId || `meta_${Date.now()}`,
        durationMs:        Date.now() - startTime,
        provider:          'meta_whatsapp',
      };
    } catch (err) {
      logger.error(`Meta WhatsApp error: ${err.message}`);
    }
  }

  // Fallback: Twilio WhatsApp
  if (isWhatsAppEnabled()) {
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
  }

  // Simulated fallback
  logger.warn('No WhatsApp provider configured — WhatsApp delivery simulated');
  return {
    success:           true,
    simulated:         true,
    providerMessageId: `sim_wa_${Date.now()}`,
    durationMs:        Date.now() - startTime,
    provider:          'whatsapp_simulated',
  };
};

module.exports = {
  isSmsEnabled,
  isWhatsAppEnabled,
  sendSms,
  sendWhatsApp,
};