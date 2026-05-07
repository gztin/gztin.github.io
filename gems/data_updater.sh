#!/bin/sh

# Base Directory
# If running locally (not in container), use ./public/api/data
if [ -d "./public" ]; then
    DATA_DIR="./public/api/data"
else
    # Default to Nginx path
    DATA_DIR="${DATA_DIR:-/usr/share/nginx/html/api/data}"
fi

mkdir -p "$DATA_DIR"

echo "🚀 Starting Data Updater (Interval: 60s)..."

while true; do
  echo "[$(date)] Fetching Binance Data..."
  
  # Loop through Symbols
  # Replaced XAUTUSDT with PAXGUSDT (Paxos Gold) as XAUT is not widely available on Binance API
  for symbol in BTCUSDT ETHUSDT PAXGUSDT XAGUSDT; do
    # Loop through Intervals
    for interval in 15m 30m 1h 4h 1d 1w; do
      
      # Try Futures API First
      OUTPUT_FILE="$DATA_DIR/${symbol}_${interval}.json"
      URL="https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100"
      
      # Use curl with a User-Agent to mimic a browser
      curl -s -H "User-Agent: Mozilla/5.0" "$URL" > "$OUTPUT_FILE"
      
      # Basic Validation (Check if file contains "code" which usually means error, or is empty)
      if grep -q "code" "$OUTPUT_FILE" || [ ! -s "$OUTPUT_FILE" ]; then
         # Fallback to Spot API if Futures failed
         echo "⚠️ Futures failed for $symbol $interval, trying Spot..."
         URL="https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=100"
         curl -s -H "User-Agent: Mozilla/5.0" "$URL" > "$OUTPUT_FILE"
      fi

      # Small sleep to be polite to API
      sleep 0.5
    done
  done

  echo "[$(date)] Update Cycle Completed. Sleeping 60s..."
  sleep 60
done
