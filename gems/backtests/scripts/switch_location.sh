#!/bin/bash

# =============================================================
# switch_location.sh - 多地開發分支切換
# 位置：backtests/scripts/switch_location.sh
# 執行：bash backtests/scripts/switch_location.sh [指令]
#
# 用途：在不同地點（元大/租屋處）開發時快速切換對應分支
# 支援指令：
#   在元大開發 / 元大 / yuanta   → location/yuanta
#   在租屋處開發 / 租屋處 / home  → location/home
#   回到主分支 / main             → main
#   測試環境 / develop            → develop
#   status / 狀態                 → 顯示當前狀態
# =============================================================

set -e

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 顯示當前狀態
show_status() {
    echo -e "${BLUE}=== 當前開發環境狀態 ===${NC}"
    echo -e "當前分支: ${GREEN}$(git branch --show-current)${NC}"
    echo -e "最後提交: ${YELLOW}$(git log -1 --pretty=format:'%h - %s (%cr)')${NC}"
    echo ""
}

# 切換到指定分支
switch_to_branch() {
    local target_branch=$1
    local location_name=$2
    
    echo -e "${BLUE}正在切換到 ${location_name} 開發環境...${NC}"
    
    # 確保工作區乾淨
    if ! git diff-index --quiet HEAD --; then
        echo -e "${YELLOW}警告: 工作區有未提交的變更${NC}"
        echo "請先提交或暫存變更後再切換分支"
        return 1
    fi
    
    # 切換分支
    git checkout $target_branch
    
    # 拉取最新變更
    echo -e "${BLUE}正在同步最新變更...${NC}"
    git pull origin $target_branch
    
    echo -e "${GREEN}✅ 成功切換到 ${location_name} 開發環境${NC}"
    show_status
}

# 主要邏輯
case "$1" in
    "在租屋處開發"|"租屋處"|"home")
        switch_to_branch "location/home" "租屋處"
        ;;
    "在元大開發"|"元大"|"yuanta")
        switch_to_branch "location/yuanta" "元大"
        ;;
    "回到主分支"|"main"|"production")
        switch_to_branch "main" "正式環境"
        ;;
    "測試環境"|"develop")
        switch_to_branch "develop" "測試環境"
        ;;
    "status"|"狀態"|"")
        show_status
        ;;
    *)
        echo -e "${RED}❌ 不支援的指令: $1${NC}"
        echo ""
        echo -e "${BLUE}支援的指令:${NC}"
        echo "  在租屋處開發 / 租屋處 / home"
        echo "  在元大開發 / 元大 / yuanta"
        echo "  回到主分支 / main / production"
        echo "  測試環境 / develop"
        echo "  status / 狀態 (顯示當前狀態)"
        echo ""
        echo -e "${BLUE}使用範例:${NC}"
        echo "  ./scripts/switch-location.sh 在元大開發"
        echo "  ./scripts/switch-location.sh 租屋處"
        echo "  ./scripts/switch-location.sh status"
        exit 1
        ;;
esac