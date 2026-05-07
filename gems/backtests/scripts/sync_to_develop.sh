#!/bin/bash

# =============================================================
# sync_to_develop.sh - 同步 location 分支到 develop
# 位置：backtests/scripts/sync_to_develop.sh
# 執行：bash backtests/scripts/sync_to_develop.sh
#
# 用途：將目前 location/* 分支的變更合併到 develop 分支
# 前置條件：
#   - 必須在 location/* 分支
#   - 工作區必須乾淨（無未提交變更）
# 流程：推送當前分支 → 切換 develop → 合併 → 推送 → 切回原分支
# =============================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

current_branch=$(git branch --show-current)

echo -e "${BLUE}=== 同步 $current_branch 到 develop 分支 ===${NC}"

# 確保在location分支
if [[ ! "$current_branch" =~ ^location/ ]]; then
    echo -e "${RED}❌ 錯誤: 此腳本只能在location分支使用${NC}"
    echo -e "${YELLOW}當前分支: $current_branch${NC}"
    exit 1
fi

# 確保工作區乾淨
if ! git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}警告: 工作區有未提交的變更${NC}"
    echo "請先提交變更後再同步"
    exit 1
fi

# 推送當前分支
echo -e "${BLUE}推送當前分支到遠端...${NC}"
git push origin $current_branch

# 切換到develop分支
echo -e "${BLUE}切換到develop分支...${NC}"
git checkout develop

# 拉取最新develop
echo -e "${BLUE}拉取最新develop分支...${NC}"
git pull origin develop

# 合併當前location分支
echo -e "${BLUE}合併 $current_branch 到 develop...${NC}"
git merge origin/$current_branch --no-ff -m "Merge $current_branch into develop"

# 推送develop分支
echo -e "${BLUE}推送develop分支...${NC}"
git push origin develop

# 切換回原分支
echo -e "${BLUE}切換回 $current_branch 分支...${NC}"
git checkout $current_branch

echo -e "${GREEN}✅ 成功同步 $current_branch 到 develop 分支${NC}"