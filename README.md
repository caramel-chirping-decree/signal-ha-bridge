# Signal ↔ Home Assistant Bridge Bot

A Dockerized bridge service that connects Signal messaging with Home Assistant automation. Control your home, monitor devices, and receive alerts - all through Signal (individual chats or groups).

## Features

- **Two-way communication**: Control HA from Signal, receive HA notifications in Signal
- **Group Support**: Run in a Signal group for whole-family access, or individual DMs
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
- `HA_TOKEN`: Long-lived access token from HA Profile → Long-Lived Access Tokens
- `SIGNAL_API_URL`: Signal CLI REST API URL
- `SIGNAL_NUMBER`: Your bot's Signal phone number
- `ALLOWED_NUMBERS`: Comma-separated list of allowed phone numbers

Optional group settings:
- `GROUP_MODE=true`: Enable Signal group for HA notifications
- `GROUP_NAME`: Name for the HA group (default: "Home Assistant Bot")

### 3. Run with Docker

```bash
./setup.sh
# Or manually:
docker-compose up -d
```

## Group Mode vs Individual Mode

### Individual Mode (default)
- Each authorized number can DM the bot
- Responses go back to the sender
- Good for personal use

### Group Mode
Set `GROUP_MODE=true` in `.env`:
- Bot auto-creates a Signal group
- All `ALLOWED_NUMBERS` are added to the group
- Commands work in the group (any member can control HA)
- Proactive notifications (motion, unlocks) broadcast to the group
- Good for families/households

**Group Commands:**
- `list groups` - Show all Signal groups
- `create group [name]` - Create a new group

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

### Discovery
- `help` - Show available commands
- `list lights` - Show all light entities
- `list switches` - Show all switches
- `list [room]` - Show entities in room

## Troubleshooting

### Status command not working

1. **Check HA connection:**
   ```bash
   docker-compose logs | grep "Connected to Home Assistant"
   ```
   If not connected, verify `HA_URL` and `HA_TOKEN`.

2. **Enable debug mode:**
   Set `DEBUG_MODE=true` in `.env` and restart:
   ```bash
   docker-compose restart
   docker-compose logs -f
   ```

3. **Test HA token:**
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        http://YOUR_HA_URL/api/
   ```

4. **Check entity names:**
   The bot fuzzy-matches names. Try exact entity IDs if friendly names don't work:
   - `light.living_room` instead of "living room light"

### Group mode not working

1. **Signal CLI must support groups:**
   Check your Signal CLI version supports group APIs.

2. **Check group permissions:**
   Bot needs to be group admin to add members.

3. **Verify groups list:**
   Send `list groups` to see available groups.

### Messages not being received

1. **Check Signal CLI:**
   ```bash
   curl http://localhost:8080/v1/about
   ```

2. **Check allowed numbers:**
   Make sure your number is in `ALLOWED_NUMBERS` (with country code).

3. **Check logs:**
   ```bash
   docker-compose logs -f signal-ha-bridge
   ```

## Architecture

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Signal    │──────▶│   Bridge    │──────▶│ Home Assistant│
│    App      │◀──────│    Bot      │◀──────│   (REST/WS) │
└─────────────┘       └─────────────┘       └─────────────┘
                            │
                       ┌─────────────┐
                       │  Signal     │
                       │   Group     │
                       └─────────────┘
```

## Development

```bash
npm install
npm run dev
```

## License

MIT
