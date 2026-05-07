#!/bin/bash

# GEMS Office Docker 啟動腳本
# 用途：快速建置並啟動 Docker 容器

set -e

echo "🚀 開始建置 GEMS Office Docker 映像..."

# 建置 Docker 映像
docker build -t gems-office:latest .

echo "✅ 映像建置完成！"
echo ""
echo "📦 可用的啟動選項："
echo "  1. 正式環境 (Production): docker-compose up -d gems-office"
echo "  2. 測試環境 (Test):       docker-compose up -d gems-office-test"
echo "  3. 台北環境 (Taipei):     docker-compose up -d gems-office-taipei"
echo "  4. 全部啟動:              docker-compose up -d"
echo ""

read -p "請選擇要啟動的環境 (1-4, 或按 Enter 跳過): " choice

case $choice in
  1)
    echo "🌐 啟動正式環境..."
    docker-compose up -d gems-office prod-tunnel
    ;;
  2)
    echo "🧪 啟動測試環境..."
    docker-compose up -d gems-office-test
    ;;
  3)
    echo "🏢 啟動台北環境..."
    docker-compose up -d gems-office-taipei
    ;;
  4)
    echo "🌍 啟動所有環境..."
    docker-compose up -d
    ;;
  *)
    echo "⏭️  跳過啟動，請手動執行 docker-compose up -d"
    ;;
esac

echo ""
echo "✨ 完成！"
echo ""
echo "📊 查看容器狀態: docker-compose ps"
echo "📝 查看日誌: docker-compose logs -f gems-office"
echo "🛑 停止服務: docker-compose down"
