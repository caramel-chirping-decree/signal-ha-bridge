// Signal CLI REST API Client
const axios = require('axios');
const logger = require('./logger');

class SignalClient {
  constructor(apiUrl, number) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.number = number;
    this.receivedIds = new Set();
  }

  async sendMessage(recipient, message) {
    try {
      const url = `${this.apiUrl}/v2/send`;
      const payload = {
        recipient: [recipient],
        message: message,
        number: this.number
      };
      
      const response = await axios.post(url, payload, {
        timeout: 30000
      });
      
      logger.info(`Sent message to ${recipient}`);
      return response.data;
    } catch (err) {
      logger.error(`Failed to send message: ${err.message}`);
      if (err.response) {
        logger.error('Response:', err.response.data);
      }
      throw err;
    }
  }

  async receiveMessages() {
    try {
      const url = `${this.apiUrl}/v1/receive/${this.number}`;
      
      const response = await axios.get(url, {
        timeout: 60000 // Long polling
      });
      
      if (!response.data || !Array.isArray(response.data)) {
        return [];
      }
      
      // Parse envelope format
      const messages = [];
      
      for (const envelope of response.data) {
        // Only interested in data messages
        if (envelope.dataMessage) {
          const dm = envelope.dataMessage;
          
          // Skip our own messages
          if (envelope.source === this.number) continue;
          
          messages.push({
            source: envelope.source,
            timestamp: dm.timestamp,
            message: dm.message ? dm.message.trim() : null,
            attachments: dm.attachments || []
          });
          
          logger.debug(`Received message from ${envelope.source}: "${dm.message}"`);
        }
      }
      
      return messages;
    } catch (err) {
      if (err.response && err.response.status === 400) {
        // No messages available
        return [];
      }
      throw err;
    }
  }

  async listIdentities() {
    try {
      const url = `${this.apiUrl}/v1/identities/${this.number}`;
      const response = await axios.get(url);
      return response.data;
    } catch (err) {
      logger.error('Failed to list identities:', err.message);
      return [];
    }
  }
}

module.exports = SignalClient;
