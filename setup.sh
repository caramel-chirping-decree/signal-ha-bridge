#!/bin/bash
# Setup script for Signal ↔ Home Assistant Bridge

set -e

echo "🦞 Signal ↔ Home Assistant Bridge Setup"
echo "========================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker and Docker Compose found"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo ""
    echo "📝 Please edit .env with your configuration:"
    echo "   - HA_URL: Your Home Assistant URL"
    echo "   - HA_TOKEN: Your HA long-lived access token"
    echo "   - SIGNAL_API_URL: Signal CLI REST API URL"
    echo "   - SIGNAL_NUMBER: Your Signal bot phone number"
    echo "   - ALLOWED_NUMBERS: Comma-separated list of allowed numbers"
    echo ""
    echo "After editing .env, run this script again."
    exit 1
fi

echo "✅ .env file found"
echo ""

# Check if Signal CLI is reachable
if grep -q "SIGNAL_API_URL=http://localhost" .env; then
    echo "⚠️  SIGNAL_API_URL is set to localhost. Make sure Signal CLI is running."
    echo "   Or update SIGNAL_API_URL to point to your Signal CLI instance."
    echo ""
fi

# Build and run
echo "🔨 Building Docker image..."
docker-compose build

echo ""
echo "🚀 Starting Signal ↔ Home Assistant Bridge..."
docker-compose up -d

echo ""
echo "✅ Bridge is running!"
echo ""
echo "Logs: docker-compose logs -f"
echo "Stop: docker-compose down"
echo ""
echo "Send 'help' to your Signal bot to test!"
