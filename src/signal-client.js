// Signal CLI JSON-RPC Client
// Supports both REST API (MODE=normal) and JSON-RPC (MODE=json-rpc)

const axios = require('axios');
const WebSocket = require('ws');
const logger = require('./logger');

class SignalClient {
  constructor(apiUrl, number, mode = 'normal') {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.number = number;
    this.mode = mode; // 'normal' or 'json-rpc'
    this.receivedIds = new Set();
    this.groupCache = new Map();
    
    // JSON-RPC specific
    this.ws = null;
    this.rpcId = 0;
    this.pendingRpc = new Map();
    this.messageQueue = [];
    this.isConnected = false;
  }

  async init() {
    if (this.mode === 'json-rpc') {
      await this.connectJsonRpc();
    }
  }

  // JSON-RPC WebSocket connection
  async connectJsonRpc() {
    return new Promise((resolve, reject) => {
      const wsUrl = this.apiUrl.replace('http', 'ws') + '/v1/jsonrpc';
      logger.info(`Connecting to Signal JSON-RPC: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        logger.info('✓ Signal JSON-RPC connected');
        this.isConnected = true;
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this.handleJsonRpcMessage(data);
      });
      
      this.ws.on('error', (err) => {
        logger.error('Signal JSON-RPC error:', err.message);
        reject(err);
      });
      
      this.ws.on('close', () => {
        logger.warn('Signal JSON-RPC closed, reconnecting...');
        this.isConnected = false;
        setTimeout(() => this.connectJsonRpc(), 5000);
      });
    });
  }

  handleJsonRpcMessage(data) {
    try {
      const msg = JSON.parse(data);
      
      // Handle RPC response
      if (msg.id && this.pendingRpc.has(msg.id)) {
        const { resolve, reject } = this.pendingRpc.get(msg.id);
        this.pendingRpc.delete(msg.id);
        
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
        return;
      }
      
      // Handle incoming messages (notifications)
      if (msg.method === 'receive' && msg.params) {
        const envelope = msg.params;
        this.processEnvelope(envelope);
      }
    } catch (err) {
      logger.error('Failed to parse JSON-RPC message:', err.message);
    }
  }

  async sendJsonRpc(method, params = {}) {
    if (!this.isConnected) {
      throw new Error('JSON-RPC not connected');
    }
    
    const id = ++this.rpcId;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        account: this.number,
        ...params
      }
    };
    
    return new Promise((resolve, reject) => {
      this.pendingRpc.set(id, { resolve, reject });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRpc.has(id)) {
          this.pendingRpc.delete(id);
          reject(new Error('JSON-RPC timeout'));
        }
      }, 30000);
      
      this.ws.send(JSON.stringify(message));
    });
  }

  processEnvelope(envelope) {
    if (!envelope.dataMessage) return;
    
    const dm = envelope.dataMessage;
    if (envelope.source === this.number) return;
    
    const isGroup = !!dm.groupInfo;
    const groupId = isGroup ? dm.groupInfo.groupId : null;
    const groupName = isGroup ? (dm.groupInfo.name || 'Unknown Group') : null;
    
    const message = {
      source: envelope.source,
      timestamp: dm.timestamp,
      message: dm.message ? dm.message.trim() : null,
      attachments: dm.attachments || [],
      isGroup: isGroup,
      groupId: groupId,
      groupName: groupName,
      replyTo: isGroup ? { type: 'group', id: groupId } : { type: 'individual', id: envelope.source }
    };
    
    this.messageQueue.push(message);
    
    if (isGroup) {
      logger.info(`Group message from ${envelope.source} in "${groupName}": "${dm.message}"`);
    } else {
      logger.debug(`Received message from ${envelope.source}: "${dm.message}"`);
    }
  }

  // Unified send message (works for both modes)
  async sendMessage(recipient, message, groupId = null) {
    if (this.mode === 'json-rpc') {
      return this.sendMessageJsonRpc(recipient, message, groupId);
    } else {
      return this.sendMessageRest(recipient, message, groupId);
    }
  }

  async sendMessageJsonRpc(recipient, message, groupId = null) {
    try {
      const params = {
        message: message
      };
      
      if (groupId) {
        params.groupId = groupId;
        logger.info(`Sending to group via JSON-RPC`);
      } else {
        params.recipient = [recipient];
        logger.info(`Sending to ${recipient} via JSON-RPC`);
      }
      
      await this.sendJsonRpc('send', params);
      return { success: true };
    } catch (err) {
      logger.error(`Failed to send JSON-RPC message: ${err.message}`);
      throw err;
    }
  }

  async sendMessageRest(recipient, message, groupId = null) {
    try {
      const url = `${this.apiUrl}/v2/send`;
      const payload = {
        message: message,
        number: this.number
      };
      
      if (groupId) {
        payload.groupId = groupId;
        logger.info(`Sending to group ${groupId.substring(0, 20)}...`);
      } else {
        payload.recipient = [recipient];
        logger.info(`Sending to ${recipient}`);
      }
      
      const response = await axios.post(url, payload, { timeout: 30000 });
      return response.data;
    } catch (err) {
      logger.error(`Failed to send REST message: ${err.message}`);
      throw err;
    }
  }

  // Unified receive messages (works for both modes)
  async receiveMessages() {
    if (this.mode === 'json-rpc') {
      // For JSON-RPC, messages are pushed via WebSocket
      // Return queued messages and clear queue
      const messages = [...this.messageQueue];
      this.messageQueue = [];
      return messages;
    } else {
      return this.receiveMessagesRest();
    }
  }

  async receiveMessagesRest() {
    try {
      const url = `${this.apiUrl}/v1/receive/${this.number}`;
      
      const response = await axios.get(url, { timeout: 60000 });
      
      if (!response.data || !Array.isArray(response.data)) {
        return [];
      }
      
      const messages = [];
      
      for (const envelope of response.data) {
        if (envelope.dataMessage) {
          const dm = envelope.dataMessage;
          
          if (envelope.source === this.number) continue;
          
          const isGroup = !!dm.groupInfo;
          
          messages.push({
            source: envelope.source,
            timestamp: dm.timestamp,
            message: dm.message ? dm.message.trim() : null,
            attachments: dm.attachments || [],
            isGroup: isGroup,
            groupId: isGroup ? dm.groupInfo.groupId : null,
            groupName: isGroup ? (dm.groupInfo.name || 'Unknown Group') : null,
            replyTo: isGroup ? { type: 'group', id: dm.groupInfo.groupId } : { type: 'individual', id: envelope.source }
          });
        }
      }
      
      return messages;
    } catch (err) {
      if (err.response && err.response.status === 400) {
        return [];
      }
      throw err;
    }
  }

  // Group operations (REST only for now, JSON-RPC has limited group support)
  async listGroups() {
    if (this.mode === 'json-rpc') {
      // JSON-RPC doesn't have a direct list groups method
      logger.warn('listGroups not supported in JSON-RPC mode');
      return [];
    }
    
    try {
      const url = `${this.apiUrl}/v1/groups/${this.number}`;
      const response = await axios.get(url);
      
      const groups = response.data || [];
      for (const group of groups) {
        this.groupCache.set(group.id, group);
      }
      
      return groups;
    } catch (err) {
      logger.error('Failed to list groups:', err.message);
      return [];
    }
  }

  async createGroup(name, members = []) {
    if (this.mode === 'json-rpc') {
      logger.warn('createGroup not supported in JSON-RPC mode');
      throw new Error('Group creation requires REST mode');
    }
    
    try {
      const url = `${this.apiUrl}/v1/groups/${this.number}`;
      const payload = { name, members };
      
      const response = await axios.post(url, payload);
      logger.info(`Created group "${name}"`);
      return response.data;
    } catch (err) {
      logger.error('Failed to create group:', err.message);
      throw err;
    }
  }

  async getOrCreateHAGroup(allowedNumbers, groupName = "Home Assistant Bot") {
    if (this.mode === 'json-rpc') {
      logger.warn('Group mode not fully supported in JSON-RPC mode');
      return null;
    }
    
    try {
      const groups = await this.listGroups();
      const existingGroup = groups.find(g => g.name === groupName);
      
      if (existingGroup) {
        logger.info(`Found existing HA group: "${groupName}"`);
        return existingGroup;
      }
      
      logger.info(`Creating new HA group: "${groupName}"`);
      return await this.createGroup(groupName, [this.number, ...allowedNumbers]);
    } catch (err) {
      logger.error('Failed to get/create HA group:', err.message);
      return null;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = SignalClient;
