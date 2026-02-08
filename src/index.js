// Signal ↔ Home Assistant Bridge Bot
// Main entry point

require('dotenv').config();
const SignalClient = require('./signal-client');
const HomeAssistant = require('./home-assistant');
const CommandParser = require('./command-parser');
const logger = require('./logger');

const REQUIRED_ENV = [
  'HA_URL',
  'HA_TOKEN', 
  'SIGNAL_API_URL',
  'SIGNAL_NUMBER',
  'ALLOWED_NUMBERS'
];

function validateEnv() {
  const missing = REQUIRED_ENV.filter(key => !process.env[key]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  validateEnv();
  
  logger.info('Starting Signal ↔ Home Assistant Bridge...');
  
  const config = {
    haUrl: process.env.HA_URL,
    haToken: process.env.HA_TOKEN,
    signalApiUrl: process.env.SIGNAL_API_URL,
    signalNumber: process.env.SIGNAL_NUMBER,
    allowedNumbers: process.env.ALLOWED_NUMBERS.split(',').map(n => n.trim()),
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 60000
  };
  
  // Initialize clients
  const ha = new HomeAssistant(config.haUrl, config.haToken);
  const signal = new SignalClient(config.signalApiUrl, config.signalNumber);
  const parser = new CommandParser(ha);
  
  // Connection test
  try {
    await ha.testConnection();
    logger.info('✓ Connected to Home Assistant');
  } catch (err) {
    logger.error('Failed to connect to Home Assistant:', err.message);
    process.exit(1);
  }
  
  // In-memory message tracking
  const processedMessages = new Set();
  const messageRetention = 1000; // Keep last 1000 message IDs
  
  // Message polling loop
  async function pollMessages() {
    try {
      const messages = await signal.receiveMessages();
      
      for (const msg of messages) {
        // Skip if already processed
        const msgId = msg.timestamp + msg.source;
        if (processedMessages.has(msgId)) continue;
        
        // Cleanup old message IDs
        if (processedMessages.size > messageRetention) {
          const iterator = processedMessages.values();
          processedMessages.delete(iterator.next().value);
        }
        
        processedMessages.add(msgId);
        
        // Check if sender is allowed
        if (!config.allowedNumbers.includes(msg.source)) {
          logger.warn(`Rejected message from unauthorized number: ${msg.source}`);
          continue;
        }
        
        // Skip non-text messages
        if (!msg.message || msg.message.trim() === '') continue;
        
        logger.info(`Received from ${msg.source}: "${msg.message}"`);
        
        // Parse and execute command
        const response = await parser.execute(msg.message);
        
        // Send response back
        if (response) {
          await signal.sendMessage(msg.source, response);
        }
      }
    } catch (err) {
      logger.error('Error polling messages:', err.message);
    }
  }
  
  // Start polling
  logger.info(`Listening for Signal messages from: ${config.allowedNumbers.join(', ')}`);
  setInterval(pollMessages, config.updateInterval);
  
  // WebSocket for real-time HA events
  ha.subscribeToEvents(async (event) => {
    logger.debug('HA event:', event.type);
    
    // You could implement broadcast logic here
    // For now, this enables real-time state in the parser
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Shutting down gracefully...');
    ha.disconnect();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
