#!/bin/bash

# --- Crypto戰情室 原子化發布腳本 (Production Deploy) ---
# 此腳本會將 develop 代碼合併至 main，並據此構建正式區專屬鏡像。

echo "============================================"
echo "🚀 準備發布：測試區(develop) -> 正式區(main)..."
echo "============================================"

# 1. 環境安全檢查
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    echo "❌ 錯誤：必須在 develop 分支方可發起同步！(目前在: $CURRENT_BRANCH)"
    exit 1
fi

if [[ -n $(git status -s) ]]; then
    echo "⚠️ 警告：目前有未提交的變更，請先執行 git add & commit。"
    echo "目的是確保發布的代碼是經過記錄的穩定版本。"
    exit 1
fi

read -p "❓ 確定要將目前的開發成果同步到正式區嗎？(y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "🛑 已取消發布。"
    exit 1
fi

# 2. 自動化合併流程
echo "📦 正在合併為正式版本..."
git checkout main || exit 1
git merge develop --no-ff -m "Production: Release sync from develop" || {
    echo "❌ 合併發生衝突，請手動解決後再試。"
    git checkout develop
    exit 1
}

# 3. 構建生產環境專屬鏡像
echo "🏗️ 正在構建正式區鏡像 (cryptox-prod:latest)..."
# 使用 docker build 直接基於當前 main 分支的文件內容打包
docker build -t cryptox-prod:latest . || {
    echo "❌ 構建鏡像失敗！"
    git checkout develop
    exit 1
}

# 4. 重啟正式服務
echo "🔄 正在啟動正式區服務 (Production)..."
# 注意：這裡不再需要 cp .env，因為 docker-compose.yml 已鎖定 .env.production
docker-compose up -d

# 5. 清理並回到開發環境
echo "🔙 正在恢復開發環境..."
git checkout develop

echo "============================================"
echo "✅ 搞定！正式區已安裝最新鏡像，且與開發環境完全隔離。"
echo "============================================"
