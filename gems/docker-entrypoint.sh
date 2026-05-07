#!/bin/sh

echo "🤖 Starting Telegram Bot..."

mkdir -p /app/data

cd /app

# Watchdog: auto-restart bot on crash
while true; do
    echo "[WATCHDOG] $(date '+%Y-%m-%d %H:%M:%S') Starting Bot..."
    node --dns-result-order=ipv4first src/scripts/telegram_query_bot.js
    EXIT_CODE=$?
    echo "[WATCHDOG] $(date '+%Y-%m-%d %H:%M:%S') Bot exited with code $EXIT_CODE. Restarting in 5s..."
    sleep 5
done
