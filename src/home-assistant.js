// Home Assistant API Client
const axios = require('axios');
const WebSocket = require('ws');
const logger = require('./logger');

class HomeAssistant {
  constructor(baseUrl, token) {
    this.url = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.restClient = axios.create({
      baseURL: this.url,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    this.ws = null;
    this.subscribers = [];
  }

  async testConnection() {
    const response = await this.restClient.get('/api/');
    return response.data;
  }

  async getStates() {
    const response = await this.restClient.get('/api/states');
    return response.data;
  }

  async getState(entityId) {
    const response = await this.restClient.get(`/api/states/${entityId}`);
    return response.data;
  }

  async callService(domain, service, serviceData = {}) {
    const response = await this.restClient.post(
      `/api/services/${domain}/${service}`,
      serviceData
    );
    return response.data;
  }

  async turnOn(entityId) {
    return this.callService('homeassistant', 'turn_on', { entity_id: entityId });
  }

  async turnOff(entityId) {
    return this.callService('homeassistant', 'turn_off', { entity_id: entityId });
  }

  async toggle(entityId) {
    return this.callService('homeassistant', 'toggle', { entity_id: entityId });
  }

  async setBrightness(entityId, brightness) {
    return this.callService('light', 'turn_on', {
      entity_id: entityId,
      brightness_pct: brightness
    });
  }

  async setTemperature(entityId, temperature) {
    return this.callService('climate', 'set_temperature', {
      entity_id: entityId,
      temperature: temperature
    });
  }

  async getConfig() {
    const response = await this.restClient.get('/api/config');
    return response.data;
  }

  async getServices() {
    const response = await this.restClient.get('/api/services');
    return response.data;
  }

  async getEntitiesByType(type) {
    const states = await this.getStates();
    return states.filter(e => e.entity_id.startsWith(`${type}.`));
  }

  async getEntitiesByArea(area) {
    const states = await this.getStates();
    // Area matching is heuristic based on entity_id or friendly name
    return states.filter(e => {
      if (e.attributes.friendly_name) {
        return e.attributes.friendly_name.toLowerCase().includes(area.toLowerCase());
      }
      return e.entity_id.toLowerCase().includes(area.toLowerCase().replace(/\s+/g, '_'));
    });
  }

  getAreaStateSummary(entities) {
    const summary = {
      lights: [],
      switches: [],
      climate: [],
      sensors: [],
      locked: 0,
      unlocked: 0,
      on: 0,
      off: 0
    };

    for (const e of entities) {
      const domain = e.entity_id.split('.')[0];
      const isOn = e.state === 'on' || e.state === 'home' || e.state === 'open';

      if (domain === 'light') {
        summary.lights.push({ id: e.entity_id, state: e.state, brightness: e.attributes.brightness });
      } else if (domain === 'switch') {
        summary.switches.push({ id: e.entity_id, state: e.state });
      } else if (domain === 'lock') {
        if (e.state === 'locked') summary.locked++;
        else summary.unlocked++;
      } else if (domain === 'climate') {
        summary.climate.push({ id: e.entity_id, state: e.state, temp: e.attributes.temperature });
      } else if (domain === 'sensor' || domain === 'binary_sensor') {
        summary.sensors.push({ id: e.entity_id, state: e.state, unit: e.attributes.unit_of_measurement });
      }

      if (isOn) summary.on++;
      else summary.off++;
    }

    return summary;
  }

  // WebSocket for real-time events
  subscribeToEvents(callback) {
    const wsUrl = this.url.replace('http', 'ws') + '/api/websocket';
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      logger.info('HA WebSocket connected');
      
      // Authenticate
      this.ws.send(JSON.stringify({
        type: 'auth',
        access_token: this.token
      }));
    });

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      
      if (msg.type === 'auth_ok') {
        logger.info('HA WebSocket authenticated');
        
        // Subscribe to state changes
        this.ws.send(JSON.stringify({
          id: 1,
          type: 'subscribe_events',
          event_type: 'state_changed'
        }));
      }
      
      if (msg.type === 'event' && msg.event.event_type === 'state_changed') {
        callback(msg.event.data);
      }
    });

    this.ws.on('error', (err) => {
      logger.error('HA WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      logger.warn('HA WebSocket closed, reconnecting in 5s...');
      setTimeout(() => this.subscribeToEvents(callback), 5000);
    });

    this.subscribers.push(callback);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = HomeAssistant;
