'use strict';

const logger = require('../../../shared/utils/logger');

// ── Lazy SendGrid initialization ──────────────────────────────────────────────

let _sgClient = null;

const getSendGrid = () => {
  if (_sgClient) return _sgClient;
  if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY.includes('your_')) {
    return null;
  }
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  _sgClient = sgMail;
  return _sgClient;
};

const isEmailEnabled = () => !!(
  process.env.SENDGRID_API_KEY &&
  !process.env.SENDGRID_API_KEY.includes('your_') &&
  process.env.SENDGRID_FROM_EMAIL
);

// ── Send single email ─────────────────────────────────────────────────────────

const sendEmail = async ({ to, toName, subject, body, metadata = {} }) => {
  const startTime = Date.now();

  if (!isEmailEnabled()) {
    logger.warn('SendGrid not configured — email delivery simulated');
    return {
      success:           true,
      simulated:         true,
      providerMessageId: `sim_email_${Date.now()}`,
      durationMs:        Date.now() - startTime,
      provider:          'sendgrid_simulated',
    };
  }

  const sg = getSendGrid();

  const message = {
    to: {
      email: to.toLowerCase().trim(),
      name:  toName || '',
    },
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name:  process.env.SENDGRID_FROM_NAME || 'Collectly',
    },
    subject: subject.trim(),
    text:    stripHtml(body),
    html:    wrapEmailHtml(body, subject),
  };

  try {
    const [response] = await sg.send(message);

    const messageId = response.headers['x-message-id'] || null;
    const duration  = Date.now() - startTime;

    logger.info(`Email sent: to=${to} subject="${subject}" messageId=${messageId} duration=${duration}ms`);

    return {
      success:           true,
      simulated:         false,
      providerMessageId: messageId,
      providerResponse:  `${response.statusCode}`,
      durationMs:        duration,
      provider:          'sendgrid',
    };
  } catch (err) {
    const duration = Date.now() - startTime;
    const errorCode    = String(err.code || err.response?.status || 'UNKNOWN');
    const errorMessage = err.response?.body?.errors?.[0]?.message || err.message || 'SendGrid error';

    logger.error(`Email failed: to=${to} error=${errorMessage} code=${errorCode}`);

    return {
      success:      false,
      simulated:    false,
      durationMs:   duration,
      provider:     'sendgrid',
      errorCode,
      errorMessage,
    };
  }
};

// ── Strip HTML tags for plain text fallback ───────────────────────────────────

const stripHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

// ── Wrap body in minimal professional HTML ────────────────────────────────────

const wrapEmailHtml = (body, subject) => {
  const safeBody = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px; }
    .header { border-bottom: 2px solid #4F46E5; padding-bottom: 16px; margin-bottom: 24px; }
    .header h2 { color: #4F46E5; margin: 0; font-size: 20px; }
    .body { color: #333333; font-size: 15px; line-height: 1.6; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e5; color: #999999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>Collectly</h2></div>
    <div class="body">${safeBody}</div>
    <div class="footer">This is an automated message from Collectly. Please do not reply to this email.</div>
  </div>
</body>
</html>`;
};

module.exports = {
  isEmailEnabled,
  sendEmail,
};