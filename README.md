# Signal ↔ Home Assistant Bridge Bot

A Dockerized bridge service that connects Signal messaging with Home Assistant automation. Monitor your home, control devices, and receive alerts - all through Signal.

## Features

- **Two-way communication**: Control HA from Signal, receive HA notifications in Signal
- **Real-time monitoring**: WebSocket connection to HA for instant event updates
- **Command parsing**: Natural language commands like "turn off living room lights"
- **Entity discovery**: Auto-discover HA entities and make them controllable
- **Secure**: No sensitive data in chat history, private tokens in environment
- **Dockerized**: Single container deployment

## Quick Start

### 1. Signal CLI REST API Setup

You need a running Signal CLI REST API instance:

```yaml
# docker-compose.yml for Signal CLI
version: '3.8'
services:
  signal-cli:
    image: bbernhard/signal-cli-rest-api:latest
    environment:
      - MODE=normal
    volumes:
      - ./signal-cli-data:/home/.local/share/signal-cli
    ports:
      - "8080:8080"
```

Register your number first:
```bash
curl -X POST http://localhost:8080/v1/qrcode
# Scan QR code with Signal app
curl -X POST http://localhost:8080/v1/register
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:
- `HA_URL`: Home Assistant URL (e.g., http://homeassistant:8123)
- `HA_TOKEN`: Long-lived access token from HA Profile
- `SIGNAL_API_URL`: Signal CLI REST API URL
- `SIGNAL_NUMBER`: Your bot's Signal phone number
- `ALLOWED_NUMBERS`: Comma-separated list of allowed phone numbers

### 3. Run with Docker

```bash
docker-compose up -d
```

## Supported Commands

### Device Control
- `turn on [entity]` - Turn on lights, switches
- `turn off [entity]` - Turn off devices
- `toggle [entity]` - Toggle a switch
- `dim [entity] to [percentage]%` - Set light brightness

### Status Queries
- `status` - Get full home status summary
- `status [room]` - Get status of specific room/area
- `temperature` - Get all temperature readings
- `locks` - Check all lock statuses
- `is [entity] on?` - Check specific entity state

### Automation
- `run [automation]` - Trigger an automation
- `reload automations` - Refresh automations list

### Monitoring
- `subscribe [entity]` - Get notifications for entity changes
- `unsubscribe [entity]` - Stop notifications
- `list subscriptions` - Show active subscriptions

### Discovery
- `help` - Show available commands
- `list lights` - Show all light entities
- `list switches` - Show all switches
- `list [room]` - Show entities in room

## Architecture

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Signal    │──────▶│   Bridge    │──────▶│ Home Assistant│
│    App      │◀──────│    Bot      │◀──────│   (REST/WS) │
└─────────────┘       └─────────────┘       └─────────────┘
                            │
                       ┌─────────────┐
                       │  WebSocket  │
                       │  Server     │
                       └─────────────┘
```

## Development

```bash
npm install
npm run dev
```

## License

MIT
