#!/bin/bash

# =============================================================
# deploy.sh - 部署腳本
# 位置：backtests/scripts/deploy.sh
# 執行：bash backtests/scripts/deploy.sh
#
# 用途：依照目前所在分支自動判斷部署環境
#   main     → 正式環境（docker-compose.yml，port 8080）
#   其他分支  → 測試環境（docker-compose.dev.yml，port 8081）
#
# 前置條件：工作區必須乾淨（無未提交變更）
# 流程：確認分支 → 建置 Docker → 停止舊容器 → 啟動新容器
# =============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

current_branch=$(git branch --show-current)

echo -e "${BLUE}=== 部署腳本 ===${NC}"
echo -e "當前分支: ${GREEN}$current_branch${NC}"
echo -e "最後提交: ${YELLOW}$(git log -1 --pretty=format:'%h - %s (%cr)')${NC}"
echo ""

# 確保工作區乾淨
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}❌ 工作區有未提交的變更，請先提交後再部署${NC}"
    exit 1
fi

# 依分支判斷環境
if [ "$current_branch" = "main" ]; then
    LOCATION="home"
    COMPOSE_FILE="docker-compose.yml"
elif [ "$current_branch" = "office" ]; then
    LOCATION="office"
    COMPOSE_FILE="docker-compose.yml"
else
    LOCATION="laptop"
    COMPOSE_FILE="docker-compose.yml"
fi

echo -e "${YELLOW}⚠️  即將部署 ${LOCATION} 環境（分支: ${current_branch}）${NC}"
read -p "確認部署? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "部署已取消"
    exit 0
fi

echo -e "${BLUE}建置 Docker 映像...${NC}"
docker build -t crypto-bot:latest .

echo -e "${BLUE}停止現有容器...${NC}"
docker-compose -f $COMPOSE_FILE down || true

echo -e "${BLUE}啟動容器...${NC}"
docker-compose -f $COMPOSE_FILE up -d

echo -e "${GREEN}✅ 部署完成 → ${LOCATION}（分支: ${current_branch}）${NC}"
echo -e "${BLUE}查看日誌: docker-compose -f ${COMPOSE_FILE} logs -f${NC}"
