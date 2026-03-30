'use strict';

const twilio = require('twilio');
const logger = require('../../../shared/utils/logger');

let twilioClient = null;

/**
 * Initialize Twilio client
 */
const initTwilio = () => {
  if (!twilioClient) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    if (!accountSid || !authToken) {
      logger.error('Twilio credentials missing. SMS will not work.');
      return null;
    }
    
    twilioClient = twilio(accountSid, authToken);
    logger.info('Twilio client initialized');
  }
  return twilioClient;
};

/**
 * Send SMS via Twilio
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} body - Message content
 * @param {string} from - Sender phone number (optional, uses default)
 * @returns {Promise<object>} Twilio message response
 */
const sendSMS = async (to, body, from = null) => {
  try {
    const client = initTwilio();
    if (!client) {
      throw new Error('Twilio client not initialized. Check credentials.');
    }

    const fromNumber = from || process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
      throw new Error('TWILIO_PHONE_NUMBER not configured.');
    }

    // Validate phone number format (E.164)
    if (!to.match(/^\+\d{10,15}$/)) {
      throw new Error(`Invalid phone number format: ${to}. Must be E.164 (e.g., +1234567890)`);
    }

    logger.info(`Sending SMS to ${to} via Twilio`);

    const message = await client.messages.create({
      body: body,
      to: to,
      from: fromNumber,
    });

    logger.info(`SMS sent successfully. SID: ${message.sid}, Status: ${message.status}`);
    
    return {
      success: true,
      messageId: message.sid,
      status: message.status,
      to: message.to,
      from: message.from,
    };
  } catch (error) {
    logger.error(`Twilio SMS failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
      code: error.code,
    };
  }
};

/**
 * Send WhatsApp message via Twilio
 * @param {string} to - Recipient phone number (E.164 format)
 * @param {string} body - Message content
 * @returns {Promise<object>} Twilio message response
 */
const sendWhatsApp = async (to, body) => {
  try {
    const client = initTwilio();
    if (!client) {
      throw new Error('Twilio client not initialized. Check credentials.');
    }

    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+15005550006';
    
    if (!to.match(/^\+\d{10,15}$/)) {
      throw new Error(`Invalid phone number format: ${to}. Must be E.164 (e.g., +1234567890)`);
    }

    logger.info(`Sending WhatsApp to ${to} via Twilio`);

    const message = await client.messages.create({
      body: body,
      to: `whatsapp:${to}`,
      from: fromNumber,
    });

    logger.info(`WhatsApp sent successfully. SID: ${message.sid}, Status: ${message.status}`);
    
    return {
      success: true,
      messageId: message.sid,
      status: message.status,
    };
  } catch (error) {
    logger.error(`Twilio WhatsApp failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Check message status
 * @param {string} messageId - Twilio message SID
 * @returns {Promise<object>} Message status
 */
const getMessageStatus = async (messageId) => {
  try {
    const client = initTwilio();
    if (!client) return { success: false, error: 'Twilio not initialized' };

    const message = await client.messages(messageId).fetch();
    return {
      success: true,
      status: message.status,
      sid: message.sid,
    };
  } catch (error) {
    logger.error(`Failed to fetch message status: ${error.message}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  initTwilio,
  sendSMS,
  sendWhatsApp,
  getMessageStatus,
};