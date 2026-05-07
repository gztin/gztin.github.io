#!/bin/bash

# Kill any existing dev containers
echo "🛑 Stopping existing dev containers..."
docker-compose -f docker-compose.dev.yml down

# Start Dev Environment
echo "🚀 Starting Development Environment..."
docker-compose -f docker-compose.dev.yml up -d

# Inject Data Updater (Modified for Dev)
echo "🔄 Injecting Data Updater..."
# We need to make sure the target directory exists in the container
docker exec gems-app-dev mkdir -p /app/public/api/data

# Copy updater script
docker cp data_updater.sh gems-app-dev:/app/data_updater.sh
docker exec gems-app-dev chmod +x /app/data_updater.sh

# Run updater in background
# Note: In Dev mode, we write to /app/public/api/data so Vite can serve it
docker exec -d gems-app-dev sh -c "DATA_DIR=/app/public/api/data /app/data_updater.sh"

echo "⏳ Waiting for Cloudflare Tunnel..."
sleep 5
echo "🔍 Fetching Public URL..."

# Get Tunnel URL
TUNNEL_URL=""
MAX_RETRIES=10
COUNT=0

while [ -z "$TUNNEL_URL" ] && [ $COUNT -lt $MAX_RETRIES ]; do
  TUNNEL_URL=$(docker logs gems-tunnel-dev 2>&1 | grep -o 'https://.*\.trycloudflare.com' | head -n 1)
  if [ -z "$TUNNEL_URL" ]; then
    sleep 2
    ((COUNT++))
    echo "   ...waiting for URL ($COUNT/$MAX_RETRIES)"
  fi
done

if [ -z "$TUNNEL_URL" ]; then
  echo "❌ Failed to get Tunnel URL. Check logs: docker logs gems-tunnel-dev"
else
  echo ""
  echo "✅ Development URL: $TUNNEL_URL"
  echo "⚠️  Keep this terminal open? No need! The containers run in background."
  echo "📝 Edit files in VS Code -> Save -> Browser updates automatically!"
  
  # Send Telegram Notification
  # Using a temporary node script to send notification if needed, or just curl
  TARGET_CHAT_ID="-5101783950"
  BOT_TOKEN="7678756268:AAEDGl2BmAfHPxWjcFpjjFNb3GI357zioBE"
  MSG="🚧 **Development Mode Started**%0AURL: $TUNNEL_URL%0A(Hot Reload Enabled)"
  
  curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
       -d chat_id="$TARGET_CHAT_ID" \
       -d text="🚧 *Development Mode Started*%0A🔗 $TUNNEL_URL%0A⚡️ Hot Reload Enabled" \
       -d parse_mode="Markdown" > /dev/null
fi
