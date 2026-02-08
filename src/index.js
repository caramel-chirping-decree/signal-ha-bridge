// Signal ↔ Home Assistant Bridge Bot
// Main entry point with Group Support

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
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 60000,
    groupMode: process.env.GROUP_MODE === 'true',
    groupName: process.env.GROUP_NAME || 'Home Assistant Bot',
    debugMode: process.env.DEBUG_MODE === 'true',
    signalMode: process.env.SIGNAL_MODE || 'normal' // 'normal' or 'json-rpc'
  };
  
  logger.info(`Signal mode: ${config.signalMode}`);
  
  // Initialize clients
  const ha = new HomeAssistant(config.haUrl, config.haToken);
  const signal = new SignalClient(config.signalApiUrl, config.signalNumber, config.signalMode);
  const parser = new CommandParser(ha);
  
  // Initialize Signal connection (important for JSON-RPC mode)
  await signal.init();
  
  // Connection test
  try {
    await ha.testConnection();
    logger.info('✓ Connected to Home Assistant');
    
    // Log HA info
    const haConfig = await ha.getConfig();
    logger.info(`HA Location: ${haConfig.location_name}, Version: ${haConfig.version}`);
  } catch (err) {
    logger.error('Failed to connect to Home Assistant:', err.message);
    process.exit(1);
  }
  
  // Setup group if in group mode
  let haGroupId = null;
  if (config.groupMode) {
    try {
      logger.info('Group mode enabled - setting up HA group...');
      const group = await signal.getOrCreateHAGroup(config.allowedNumbers, config.groupName);
      haGroupId = group.id;
      logger.info(`✓ Group ready: "${group.name}" with ${group.members?.length || 0} members`);
      
      // Send welcome message to group
      await signal.sendMessage(null, '🏠 Home Assistant Bot is now monitoring your home. Send "help" for commands.', haGroupId);
    } catch (err) {
      logger.error('Failed to setup group:', err.message);
      logger.info('Continuing in individual mode...');
    }
  }
  
  // In-memory message tracking
  const processedMessages = new Set();
  const messageRetention = 1000;
  
  // Message polling loop
  async function pollMessages() {
    try {
      const messages = await signal.receiveMessages();
      
      for (const msg of messages) {
        // Skip if already processed
        const msgId = msg.timestamp + msg.source + (msg.groupId || '');
        if (processedMessages.has(msgId)) continue;
        
        // Cleanup old message IDs
        if (processedMessages.size > messageRetention) {
          const iterator = processedMessages.values();
          processedMessages.delete(iterator.next().value);
        }
        
        processedMessages.add(msgId);
        
        // Check if sender is allowed (for non-group messages)
        if (!msg.isGroup && !config.allowedNumbers.includes(msg.source)) {
          logger.warn(`Rejected message from unauthorized number: ${msg.source}`);
          continue;
        }
        
        // Skip non-text messages
        if (!msg.message || msg.message.trim() === '') continue;
        
        // Log message
        if (msg.isGroup) {
          logger.info(`Group message from ${msg.source} in "${msg.groupName}": "${msg.message}"`);
        } else {
          logger.info(`DM from ${msg.source}: "${msg.message}"`);
        }
        
        // Handle special group commands
        const cmd = msg.message.toLowerCase().trim();
        
        // Group management commands
        if (cmd === '/groups' || cmd === 'list groups') {
          const groups = await signal.listGroups();
          const response = groups.map(g => `• ${g.name} (${g.members?.length || 0} members)`).join('\n') || 'No groups found';
          await signal.sendMessage(msg.replyTo.id === 'group' ? null : msg.source, `📋 Groups:\n${response}`, msg.groupId);
          continue;
        }
        
        if (cmd === '/creategroup' || cmd.startsWith('create group')) {
          const name = cmd.replace('/creategroup', '').replace('create group', '').trim() || 'HA Bot Group';
          try {
            const newGroup = await signal.createGroup(name, [config.signalNumber, msg.source]);
            await signal.sendMessage(msg.source, `✅ Created group "${name}"\n\nGroup ID: ${newGroup.id?.substring(0, 30)}...\n\nAdd more members with: /invite ${newGroup.id?.substring(0, 20)} [phone number]`);
          } catch (err) {
            await signal.sendMessage(msg.source, `❌ Failed to create group: ${err.message}`);
          }
          continue;
        }
        
        // Parse and execute command
        try {
          const response = await parser.execute(msg.message);
          
          // Send response back to the right place
          if (response) {
            if (msg.isGroup && msg.groupId) {
              // Respond to group
              await signal.sendMessage(null, response, msg.groupId);
            } else {
              // Respond to individual
              await signal.sendMessage(msg.source, response);
            }
          }
        } catch (err) {
          logger.error('Error executing command:', err.message);
          const errorMsg = `❌ Error: ${err.message}`;
          if (msg.isGroup && msg.groupId) {
            await signal.sendMessage(null, errorMsg, msg.groupId);
          } else {
            await signal.sendMessage(msg.source, errorMsg);
          }
        }
      }
    } catch (err) {
      logger.error('Error polling messages:', err.message);
      if (config.debugMode) {
        logger.error(err.stack);
      }
    }
  }
  
  // Start polling
  logger.info(`Listening for Signal messages from: ${config.allowedNumbers.join(', ')}`);
  if (haGroupId) {
    logger.info(`Group mode active - also monitoring group: ${config.groupName}`);
  }
  logger.info('Send "help" to get started');
  
  setInterval(pollMessages, config.updateInterval);
  
  // WebSocket for real-time HA events
  ha.subscribeToEvents(async (event) => {
    logger.debug('HA event:', event.type, event.data?.entity_id);
    
    // Optional: Broadcast important events to group
    if (haGroupId && event.data && event.data.entity_id) {
      const entityId = event.data.entity_id;
      const newState = event.data.new_state;
      const oldState = event.data.old_state;
      
      // Only announce significant changes (locks, alarms, etc.)
      if (entityId.startsWith('lock.') && newState?.state === 'unlocked' && oldState?.state === 'locked') {
        const msg = `🔓 ${newState.attributes.friendly_name || entityId} was unlocked`;
        try {
          await signal.sendMessage(null, msg, haGroupId);
        } catch (err) {
          logger.error('Failed to broadcast to group:', err.message);
        }
      }
      
      if (entityId.includes('motion') && newState?.state === 'on' && oldState?.state === 'off') {
        const msg = `🚶 Motion detected: ${newState.attributes.friendly_name || entityId}`;
        try {
          await signal.sendMessage(null, msg, haGroupId);
        } catch (err) {
          logger.error('Failed to broadcast to group:', err.message);
        }
      }
    }
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
  if (process.env.DEBUG_MODE === 'true') {
    logger.error(err.stack);
  }
  process.exit(1);
});
