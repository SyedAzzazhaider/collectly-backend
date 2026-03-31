'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../../../shared/utils/logger');

/**
 * POST /api/v1/webhooks/whatsapp
 * Twilio WhatsApp webhook handler
 */
router.post('/whatsapp', async (req, res) => {
  try {
    const { Body, From, MessageSid, To } = req.body;
    
    logger.info(`WhatsApp webhook received: From=${From}, Body=${Body}, SID=${MessageSid}`);
    
    const phone = From ? From.replace('whatsapp:', '') : null;
    
    // Twilio expects TwiML response
    res.status(200).type('text/xml').send(`
      <Response>
        <Message>Thank you for your message. We'll get back to you soon.</Message>
      </Response>
    `);
  } catch (err) {
    logger.error(`WhatsApp webhook error: ${err.message}`);
    res.status(200).type('text/xml').send('<Response></Response>');
  }
});

module.exports = router;