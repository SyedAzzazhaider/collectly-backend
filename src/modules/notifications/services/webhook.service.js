'use strict';

const https  = require('https');
const http   = require('http');
const crypto = require('crypto');
const logger = require('../../../shared/utils/logger');

// SEC-04 FIX: HMAC-SHA256 signature on all outgoing webhook payloads
// Receivers verify authenticity via the X-Collectly-Signature header
const computeWebhookSignature = (payload) => {
  const secret = process.env.WEBHOOK_SIGNING_SECRET || process.env.JWT_ACCESS_SECRET;
  return 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
};

// ── Send webhook notification ─────────────────────────────────────────────────

const sendWebhook = async ({ webhookUrl, body, metadata = {} }) => {
  const startTime = Date.now();

  if (!webhookUrl) {
    logger.warn('Webhook delivery skipped — no webhookUrl configured on customer');
    return {
      success:           true,
      simulated:         true,
      providerMessageId: `webhook_skipped_${Date.now()}`,
      durationMs:        0,
      provider:          'webhook_skipped',
    };
  }

  let url;
  try {
    url = new URL(webhookUrl);
  } catch {
    return {
      success:      false,
      errorCode:    'INVALID_WEBHOOK_URL',
      errorMessage: `Invalid webhook URL: ${webhookUrl}`,
      durationMs:   Date.now() - startTime,
      provider:     'webhook',
    };
  }

  // SEC-05 FIX: block plaintext HTTP in production — all webhooks must use HTTPS
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    logger.warn(`Webhook blocked — HTTP not allowed in production: ${webhookUrl}`);
    return {
      success:      false,
      errorCode:    'HTTPS_REQUIRED',
      errorMessage: 'Webhook URL must use HTTPS in production.',
      durationMs:   Date.now() - startTime,
      provider:     'webhook',
    };
  }

  const payload = JSON.stringify({
    event:     'collectly.notification',
    timestamp: new Date().toISOString(),
    data:      { body, ...metadata },
  });

  return new Promise((resolve) => {
    const transport = url.protocol === 'https:' ? https : http;
    const options   = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':          'application/json',
        'Content-Length':        Buffer.byteLength(payload),
        'User-Agent':            'Collectly-Webhook/1.0',
        'X-Collectly-Event':     'notification',
        'X-Collectly-Signature': computeWebhookSignature(payload), // SEC-04
      },
      timeout: 10000,
    };

    const req = transport.request(options, (res) => {
      const duration = Date.now() - startTime;
      const success  = res.statusCode >= 200 && res.statusCode < 300;
      logger.info(
        `Webhook delivered: url=${webhookUrl} status=${res.statusCode} duration=${duration}ms`
      );
      resolve({
        success,
        simulated:         false,
        providerMessageId: `webhook_${Date.now()}`,
        providerResponse:  String(res.statusCode),
        durationMs:        duration,
        provider:          'webhook',
        ...(success ? {} : {
          errorCode:    `HTTP_${res.statusCode}`,
          errorMessage: `Webhook endpoint returned ${res.statusCode}`,
        }),
      });
    });

    req.on('timeout', () => {
      req.destroy();
      logger.warn(`Webhook timed out: url=${webhookUrl}`);
      resolve({
        success:      false,
        durationMs:   Date.now() - startTime,
        provider:     'webhook',
        errorCode:    'TIMEOUT',
        errorMessage: 'Webhook request timed out after 10 seconds',
      });
    });

    req.on('error', (err) => {
      logger.error(`Webhook error: url=${webhookUrl} error=${err.message}`);
      resolve({
        success:      false,
        durationMs:   Date.now() - startTime,
        provider:     'webhook',
        errorCode:    'REQUEST_ERROR',
        errorMessage: err.message,
      });
    });

    req.write(payload);
    req.end();
  });
};

module.exports = { sendWebhook };