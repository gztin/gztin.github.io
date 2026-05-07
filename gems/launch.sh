#!/bin/bash

# =============================================
# CryptoX 一鍵啟動腳本
# =============================================
TG_BOT_TOKEN="7678756268:AAEDGl2BmAfHPxWjcFpjjFNb3GI357zioBE"
TG_CHAT_ID="-5101783950"

echo "🚀 正在啟動 CryptoX 系統..."
echo "📊 建置映像檔並啟動服務..."

# 1. Build and start
docker compose up -d --build

echo ""
echo "⏳ 等待 Cloudflare Tunnel 建立連線 (約 30 秒)..."

# 2. Wait for tunnel URL
MAX_RETRIES=60
COUNT=0
URL=""

while [ $COUNT -lt $MAX_RETRIES ]; do
    URL=$(docker compose logs --no-color --since 1m tunnel 2>&1 | grep -a -o "https://[-a-zA-Z0-9]*\.trycloudflare\.com" | tail -n 1)
    
    if [ -n "$URL" ]; then
        echo ""
        echo "✅ 成功獲取網址: $URL"
        break
    fi
    
    sleep 2
    COUNT=$((COUNT+1))
    echo -n "."
done

echo ""

if [ -n "$URL" ]; then
    # 3. Send Telegram notification
    MESSAGE="🚀 *CryptoX 系統已啟動！*%0A%0A🔗 儀表板網址：%0A$URL%0A%0A📊 資料更新程式已自動啟動%0A🔔 策略通知已就緒"
    
    echo "📤 正在發送 Telegram 通知..."
    
    RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot$TG_BOT_TOKEN/sendMessage" \
        -d chat_id="$TG_CHAT_ID" \
        -d text="$MESSAGE" \
        -d parse_mode="Markdown")
        
    if [[ "$RESPONSE" == *"\"ok\":true"* ]]; then
        echo "📨 通知已成功發送至 Telegram！"
    else
        echo "❌ Telegram 通知發送失敗"
    fi
else
    echo "❌ 無法獲取 Tunnel 網址 (逾時)。"
    echo "請手動檢查: docker compose logs tunnel"
fi

echo ""
echo "=========================================="
echo "  CryptoX 啟動完成"
echo "  本機: http://localhost:8080"
echo "  外網: $URL"
echo "=========================================="
