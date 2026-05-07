#!/bin/bash

# =============================================================
# status.sh - 顯示開發環境狀態
# 位置：backtests/scripts/status.sh
# 執行：bash backtests/scripts/status.sh
#
# 用途：快速查看目前 Git 分支、工作區狀態、Docker 容器狀態
# 輸出：Git 狀態 / Docker 容器 / 分支列表 / 快速操作提示
# =============================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== 開發環境狀態 ===${NC}"
echo ""

# Git狀態
echo -e "${BLUE}📍 Git 狀態:${NC}"
echo -e "當前分支: ${GREEN}$(git branch --show-current)${NC}"
echo -e "最後提交: ${YELLOW}$(git log -1 --pretty=format:'%h - %s (%cr)')${NC}"

# 檢查是否有未提交變更
if ! git diff-index --quiet HEAD --; then
    echo -e "工作區狀態: ${YELLOW}有未提交變更${NC}"
else
    echo -e "工作區狀態: ${GREEN}乾淨${NC}"
fi

echo ""

# Docker狀態
echo -e "${BLUE}🐳 Docker 狀態:${NC}"
if docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(crypto|bot)" > /dev/null 2>&1; then
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "(crypto|bot|NAMES)"
else
    echo "沒有運行中的crypto bot容器"
fi

echo ""

# 分支資訊
echo -e "${BLUE}🌿 分支資訊:${NC}"
git branch -a | grep -E "(location|main|develop)" | sed 's/^/  /'

echo ""

# 快速操作提示
echo -e "${BLUE}🚀 快速操作:${NC}"
echo "  切換到元大: ./scripts/switch-location.sh 在元大開發"
echo "  切換到租屋處: ./scripts/switch-location.sh 在租屋處開發"
echo "  部署測試: ./scripts/deploy-test.sh"
echo "  同步到develop: ./scripts/sync-to-develop.sh"