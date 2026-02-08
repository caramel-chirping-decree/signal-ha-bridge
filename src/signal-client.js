// Signal CLI REST API Client with Group Support
const axios = require('axios');
const logger = require('./logger');

class SignalClient {
  constructor(apiUrl, number) {
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.number = number;
    this.receivedIds = new Set();
    this.groupCache = new Map(); // Cache group info
  }

  async sendMessage(recipient, message, groupId = null) {
    try {
      const url = `${this.apiUrl}/v2/send`;
      const payload = {
        message: message,
        number: this.number
      };
      
      // Send to group or individual
      if (groupId) {
        payload.groupId = groupId;
        logger.info(`Sending to group ${groupId.substring(0, 20)}...`);
      } else {
        payload.recipient = [recipient];
        logger.info(`Sending to ${recipient}`);
      }
      
      const response = await axios.post(url, payload, {
        timeout: 30000
      });
      
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
          
          // Check if it's a group message
          const isGroup = !!dm.groupInfo;
          const groupId = isGroup ? dm.groupInfo.groupId : null;
          const groupName = isGroup ? (dm.groupInfo.name || 'Unknown Group') : null;
          
          messages.push({
            source: envelope.source,
            timestamp: dm.timestamp,
            message: dm.message ? dm.message.trim() : null,
            attachments: dm.attachments || [],
            isGroup: isGroup,
            groupId: groupId,
            groupName: groupName,
            // For group messages, we'll respond to the group
            replyTo: isGroup ? { type: 'group', id: groupId } : { type: 'individual', id: envelope.source }
          });
          
          if (isGroup) {
            logger.info(`Received group message from ${envelope.source} in "${groupName}": "${dm.message}"`);
          } else {
            logger.debug(`Received message from ${envelope.source}: "${dm.message}"`);
          }
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

  // List all groups
  async listGroups() {
    try {
      const url = `${this.apiUrl}/v1/groups/${this.number}`;
      const response = await axios.get(url);
      
      const groups = response.data || [];
      logger.info(`Found ${groups.length} groups`);
      
      // Cache groups
      for (const group of groups) {
        this.groupCache.set(group.id, group);
      }
      
      return groups;
    } catch (err) {
      logger.error('Failed to list groups:', err.message);
      return [];
    }
  }

  // Create a new group
  async createGroup(name, members = []) {
    try {
      const url = `${this.apiUrl}/v1/groups/${this.number}`;
      const payload = {
        name: name,
        members: members
      };
      
      const response = await axios.post(url, payload);
      logger.info(`Created group "${name}" with ID: ${response.data?.id?.substring(0, 30)}...`);
      
      return response.data;
    } catch (err) {
      logger.error('Failed to create group:', err.message);
      if (err.response) {
        logger.error('Response:', err.response.data);
      }
      throw err;
    }
  }

  // Invite members to a group
  async inviteToGroup(groupId, members) {
    try {
      // Signal CLI uses PUT to update group members
      const url = `${this.apiUrl}/v1/groups/${this.number}/${encodeURIComponent(groupId)}`;
      
      // Get current group info first
      const groups = await this.listGroups();
      const group = groups.find(g => g.id === groupId);
      
      if (!group) {
        throw new Error('Group not found');
      }
      
      // Add new members to existing members
      const currentMembers = group.members || [];
      const newMembers = [...new Set([...currentMembers, ...members])];
      
      const payload = {
        name: group.name,
        members: newMembers
      };
      
      const response = await axios.put(url, payload);
      logger.info(`Invited ${members.length} members to group "${group.name}"`);
      
      return response.data;
    } catch (err) {
      logger.error('Failed to invite to group:', err.message);
      throw err;
    }
  }

  // Send group invitation link (if supported by Signal CLI)
  async sendGroupInvitation(groupId, recipient) {
    try {
      const groups = await this.listGroups();
      const group = groups.find(g => g.id === groupId);
      
      if (!group) {
        throw new Error('Group not found');
      }
      
      const inviteMessage = `You've been invited to join the group "${group.name}" for Home Assistant notifications.\n\nTo join, reply with: /join ${groupId.substring(0, 20)}`;
      
      await this.sendMessage(recipient, inviteMessage);
      logger.info(`Sent group invitation to ${recipient}`);
      
      return true;
    } catch (err) {
      logger.error('Failed to send invitation:', err.message);
      throw err;
    }
  }

  // Get or create the HA bot group
  async getOrCreateHAGroup(allowedNumbers, groupName = "Home Assistant Bot") {
    try {
      // First check if we already have a group with this name
      const groups = await this.listGroups();
      const existingGroup = groups.find(g => g.name === groupName && g.members.includes(this.number));
      
      if (existingGroup) {
        logger.info(`Found existing HA group: "${groupName}"`);
        
        // Ensure all allowed numbers are members
        const currentMembers = existingGroup.members || [];
        const missingMembers = allowedNumbers.filter(num => !currentMembers.includes(num));
        
        if (missingMembers.length > 0) {
          logger.info(`Adding ${missingMembers.length} missing members to group`);
          await this.inviteToGroup(existingGroup.id, missingMembers);
        }
        
        return existingGroup;
      }
      
      // Create new group
      logger.info(`Creating new HA group: "${groupName}"`);
      const newGroup = await this.createGroup(groupName, [this.number, ...allowedNumbers]);
      
      return newGroup;
    } catch (err) {
      logger.error('Failed to get/create HA group:', err.message);
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
