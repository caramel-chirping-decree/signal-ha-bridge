// Natural Language Command Parser
const logger = require('./logger');

class CommandParser {
  constructor(homeAssistant) {
    this.ha = homeAssistant;
    this.entityCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  async refreshCache() {
    try {
      const states = await this.ha.getStates();
      
      for (const entity of states) {
        const id = entity.entity_id;
        const domain = id.split('.')[0];
        const friendly = entity.attributes.friendly_name || id;
        
        this.entityCache.set(id.toLowerCase(), entity);
        this.entityCache.set(friendly.toLowerCase(), entity);
        
        // Store normalized versions
        const normalized = id.replace(`${domain}.`, '').replace(/_/g, ' ').toLowerCase();
        this.entityCache.set(normalized, entity);
      }
      
      logger.debug('Entity cache refreshed with', this.entityCache.size, 'entries');
    } catch (err) {
      logger.error('Failed to refresh entity cache:', err.message);
    }
  }

  findEntity(name) {
    const normalized = name.toLowerCase().trim();
    
    // Direct match
    if (this.entityCache.has(normalized)) {
      return this.entityCache.get(normalized);
    }
    
    // Partial match
    for (const [key, entity] of this.entityCache) {
      if (key.includes(normalized) || normalized.includes(key)) {
        return entity;
      }
    }
    
    return null;
  }

  async execute(text) {
    const cmd = text.toLowerCase().trim();
    
    // Refresh cache if empty
    if (this.entityCache.size === 0) {
      await this.refreshCache();
    }
    
    // Help
    if (cmd === 'help' || cmd === '?') {
      return this.getHelp();
    }
    
    // Status commands
    if (cmd === 'status') {
      return await this.getFullStatus();
    }
    
    if (cmd.startsWith('status ')) {
      const area = cmd.replace('status ', '');
      return await this.getAreaStatus(area);
    }
    
    if (cmd === 'temperature' || cmd === 'temp') {
      return await this.getTemperatureSummary();
    }
    
    if (cmd === 'locks') {
      return await this.getLockStatus();
    }
    
    // Discovery commands
    if (cmd === 'list lights' || cmd === 'lights') {
      return await this.listEntities('light');
    }
    
    if (cmd === 'list switches' || cmd === 'switches') {
      return await this.listEntities('switch');
    }
    
    if (cmd === 'list sensors') {
      return await this.listEntities('sensor');
    }
    
    if (cmd.startsWith('list ')) {
      const area = cmd.replace('list ', '');
      return await this.listEntitiesByArea(area);
    }
    
    // Control commands
    if (cmd.startsWith('turn on ')) {
      const entityName = cmd.replace('turn on ', '');
      return await this.turnOn(entityName);
    }
    
    if (cmd.startsWith('turn off ')) {
      const entityName = cmd.replace('turn off ', '');
      return await this.turnOff(entityName);
    }
    
    if (cmd.startsWith('toggle ')) {
      const entityName = cmd.replace('toggle ', '');
      return await this.toggle(entityName);
    }
    
    if (cmd.startsWith('dim ')) {
      const match = cmd.match(/dim (.+) to (\d+)%?/);
      if (match) {
        return await this.setBrightness(match[1], parseInt(match[2]));
      }
    }
    
    // Query commands
    if (cmd.startsWith('is ') && cmd.includes(' on')) {
      const entityName = cmd.replace('is ', '').replace(' on?', '').replace(' on', '');
      return await this.getEntityStatus(entityName);
    }
    
    if (cmd.startsWith('is ') && cmd.includes(' locked')) {
      const entityName = cmd.replace('is ', '').replace(' locked?', '').replace(' locked', '');
      return await this.getEntityStatus(entityName);
    }
    
    // Unknown command
    return `❓ I don't understand: "${text}"\n\nType "help" for available commands.`;
  }

  getHelp() {
    return `🏠 *Home Assistant Bot Commands*

*Device Control:*
• turn on [name] - Turn on lights, switches
• turn off [name] - Turn off devices  
• toggle [name] - Toggle a switch
• dim [name] to [%]% - Set brightness

*Status:*
• status - Full home summary
• status [room] - Room-specific status
• temperature - All temperature readings
• locks - Lock status

*Discovery:*
• list lights - All lights
• list switches - All switches
• list [room] - Entities in room

*Queries:*
• is [name] on? - Check entity state
• is [name] locked? - Check lock status`;
  }

  async getFullStatus() {
    try {
      const states = await this.ha.getStates();
      
      const lights = states.filter(e => e.entity_id.startsWith('light.'));
      const onLights = lights.filter(e => e.state === 'on').length;
      
      const switches = states.filter(e => e.entity_id.startsWith('switch.'));
      const onSwitches = switches.filter(e => e.state === 'on').length;
      
      const locks = states.filter(e => e.entity_id.startsWith('lock.'));
      const lockedLocks = locks.filter(e => e.state === 'locked').length;
      
      const climate = states.filter(e => e.entity_id.startsWith('climate.'));
      const tempSensors = states.filter(e => e.entity_id.startsWith('sensor.') && e.attributes.unit_of_measurement === '°C' || e.attributes.unit_of_measurement === '°F');
      
      let tempInfo = '';
      if (climate.length > 0) {
        const climateInfo = climate[0];
        const unit = climateInfo.attributes.temperature_unit || '°F';
        tempInfo = `, Climate: ${climateInfo.attributes.current_temperature}${unit} (target: ${climateInfo.attributes.temperature}${unit})`;
      }
      
      return `🏠 *Home Status*\n\n` +
        `• Lights: ${onLights}/${lights.length} on\n` +
        `• Switches: ${onSwitches}/${switches.length} on\n` +
        `• Locks: ${lockedLocks}/${locks.length} locked${tempInfo}\n\n` +
        `Type "list lights" or "status [room]" for details.`;
    } catch (err) {
      return `❌ Error getting status: ${err.message}`;
    }
  }

  async getAreaStatus(area) {
    try {
      const entities = await this.ha.getEntitiesByArea(area);
      
      if (entities.length === 0) {
        return `❓ No entities found in area: ${area}`;
      }
      
      const summary = this.ha.getAreaStateSummary(entities);
      let response = `🏠 *${area} Status*\n\n`;
      
      if (summary.lights.length > 0) {
        response += `*Lights:*\n`;
        for (const light of summary.lights) {
          const status = light.state === 'on' ? '💡' : '⚪';
          response += `${status} ${light.id.split('.')[1]}\n`;
        }
        response += '\n';
      }
      
      if (summary.climate.length > 0) {
        response += `*Climate:*\n`;
        for (const climate of summary.climate) {
          response += `🌡️ ${climate.state} (${climate.temp || 'no target'})\n`;
        }
        response += '\n';
      }
      
      if (summary.sensors.length > 0) {
        const temps = summary.sensors.filter(s => s.id.includes('temp') || s.id.includes('humidity'));
        if (temps.length > 0) {
          response += `*Sensors:*\n`;
          for (const sensor of temps.slice(0, 5)) {
            const unit = sensor.unit || '';
            response += `📊 ${sensor.id.split('.')[1]}: ${sensor.state}${unit}\n`;
          }
        }
      }
      
      return response;
    } catch (err) {
      return `❌ Error getting area status: ${err.message}`;
    }
  }

  async getTemperatureSummary() {
    try {
      const states = await this.ha.getStates();
      const temps = states.filter(e => 
        (e.entity_id.startsWith('sensor.') || e.entity_id.startsWith('climate.')) &&
        (e.attributes.unit_of_measurement === '°C' || e.attributes.unit_of_measurement === '°F' || e.attributes.unit_of_measurement === '°')
      );
      
      if (temps.length === 0) {
        return `❓ No temperature sensors found`;
      }
      
      let response = `🌡️ *Temperature Readings*\n\n`;
      for (const temp of temps) {
        const name = temp.attributes.friendly_name || temp.entity_id;
        const unit = temp.attributes.unit_of_measurement || '';
        const value = temp.state;
        response += `• ${name}: ${value}${unit}\n`;
      }
      
      return response;
    } catch (err) {
      return `❌ Error getting temperatures: ${err.message}`;
    }
  }

  async getLockStatus() {
    try {
      const locks = await this.ha.getEntitiesByType('lock');
      
      if (locks.length === 0) {
        return `🏠 No locks configured`;
      }
      
      let response = `🔐 *Lock Status*\n\n`;
      
      for (const lock of locks) {
        const name = lock.attributes.friendly_name || lock.entity_id;
        const status = lock.state === 'locked' ? '🔒' : '🔓';
        response += `${status} ${name}\n`;
      }
      
      return response;
    } catch (err) {
      return `❌ Error getting lock status: ${err.message}`;
    }
  }

  async listEntities(type) {
    try {
      const entities = await this.ha.getEntitiesByType(type);
      
      if (entities.length === 0) {
        return `❓ No ${type}s found`;
      }
      
      const onEntities = entities.filter(e => e.state === 'on').map(e => e.attributes.friendly_name || e.entity_id);
      const offEntities = entities.filter(e => e.state !== 'on').map(e => e.attributes.friendly_name || e.entity_id);
      
      let response = `*${type.charAt(0).toUpperCase() + type.slice(1)}s* (${entities.length} total)\n\n`;
      
      if (onEntities.length > 0) {
        response += `💡 On (${onEntities.length}):\n${onEntities.slice(0, 10).join(', ')}\n`;
        if (onEntities.length > 10) response += `...and ${onEntities.length - 10} more\n`;
        response += '\n';
      }
      
      if (offEntities.length > 0) {
        response += `⚪ Off (${offEntities.length}):\n${offEntities.slice(0, 10).join(', ')}\n`;
        if (offEntities.length > 10) response += `...and ${offEntities.length - 10} more\n`;
      }
      
      return response;
    } catch (err) {
      return `❌ Error listing entities: ${err.message}`;
    }
  }

  async listEntitiesByArea(area) {
    try {
      const entities = await this.ha.getEntitiesByArea(area);
      
      if (entities.length === 0) {
        return `❓ No entities found in: ${area}`;
      }
      
      let response = `*Entities in ${area}* (${entities.length}):\n\n`;
      
      // Group by domain
      const byDomain = {};
      for (const e of entities) {
        const domain = e.entity_id.split('.')[0];
        if (!byDomain[domain]) byDomain[domain] = [];
        byDomain[domain].push(e.attributes.friendly_name || e.entity_id);
      }
      
      for (const [domain, items] of Object.entries(byDomain).sort()) {
        response += `*${domain}:*\n${items.join(', ')}\n\n`;
      }
      
      return response;
    } catch (err) {
      return `❌ Error listing area entities: ${err.message}`;
    }
  }

  async turnOn(name) {
    const entity = this.findEntity(name);
    
    if (!entity) {
      return `❓ Entity not found: "${name}"\n\nTry "list lights" or "list switches" to see available entities.`;
    }
    
    try {
      await this.ha.turnOn(entity.entity_id);
      return `✅ Turned on: ${entity.attributes.friendly_name || entity.entity_id}`;
    } catch (err) {
      return `❌ Failed to turn on ${entity.attributes.friendly_name || entity.entity_id}: ${err.message}`;
    }
  }

  async turnOff(name) {
    const entity = this.findEntity(name);
    
    if (!entity) {
      return `❓ Entity not found: "${name}"`;
    }
    
    try {
      await this.ha.turnOff(entity.entity_id);
      return `✅ Turned off: ${entity.attributes.friendly_name || entity.entity_id}`;
    } catch (err) {
      return `❌ Failed to turn off: ${err.message}`;
    }
  }

  async toggle(name) {
    const entity = this.findEntity(name);
    
    if (!entity) {
      return `❓ Entity not found: "${name}"`;
    }
    
    try {
      await this.ha.toggle(entity.entity_id);
      const newState = entity.state === 'on' ? 'off' : 'on';
      return `🔄 Toggled ${entity.attributes.friendly_name || entity.entity_id} to ${newState}`;
    } catch (err) {
      return `❌ Failed to toggle: ${err.message}`;
    }
  }

  async setBrightness(name, level) {
    const entity = this.findEntity(name);
    
    if (!entity) {
      return `❓ Light not found: "${name}"`;
    }
    
    if (!entity.entity_id.startsWith('light.')) {
      return `❌ "${name}" is not a dimmable light`;
    }
    
    try {
      await this.ha.setBrightness(entity.entity_id, level);
      return `💡 Set ${entity.attributes.friendly_name || entity.entity_id} to ${level}% brightness`;
    } catch (err) {
      return `❌ Failed to set brightness: ${err.message}`;
    }
  }

  async getEntityStatus(name) {
    const entity = this.findEntity(name);
    
    if (!entity) {
      return `❓ Entity not found: "${name}"`;
    }
    
    const status = entity.state;
    const friendly = entity.attributes.friendly_name || entity.entity_id;
    
    let icon = '⚪';
    if (status === 'on' || status === 'home') icon = '🔵';
    if (status === 'off' || status === 'away') icon = '⚪';
    if (status === 'locked') icon = '🔒';
    if (status === 'unlocked') icon = '🔓';
    
    const lastChanged = new Date(entity.last_changed).toLocaleString();
    
    return `${icon} *${friendly}*\nStatus: ${status}\nLast changed: ${lastChanged}`;
  }
}

module.exports = CommandParser;
