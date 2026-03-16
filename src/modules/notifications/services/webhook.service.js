'use strict';

const https  = require('https');
const http   = require('http');
const logger = require('../../../shared/utils/logger');

// ── Send webhook notification ─────────────────────────────────────────────────
// Delivers notification payload via HTTP POST to a customer-configured URL.
// Spec: Webhook channel — user systems receive event-driven payloads.

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

  const payload = JSON.stringify({
    event:     'collectly.notification',
    timestamp: new Date().toISOString(),
    data: {
      body,
      ...metadata,
    },
  });

  return new Promise((resolve) => {
    const transport = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent':     'Collectly-Webhook/1.0',
        'X-Collectly-Event': 'notification',
      },
      timeout: 10000, // 10 second timeout
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
      const duration = Date.now() - startTime;
      logger.warn(`Webhook timed out: url=${webhookUrl} duration=${duration}ms`);
      resolve({
        success:      false,
        durationMs:   duration,
        provider:     'webhook',
        errorCode:    'TIMEOUT',
        errorMessage: 'Webhook request timed out after 10 seconds',
      });
    });

    req.on('error', (err) => {
      const duration = Date.now() - startTime;
      logger.error(`Webhook error: url=${webhookUrl} error=${err.message}`);
      resolve({
        success:      false,
        durationMs:   duration,
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