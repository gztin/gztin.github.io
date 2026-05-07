---
name: Unified Workflow (開發與維運流程)
description: 從本地開發、改版更新到正式部署的全流程指引。
---

# Unified Workflow (開發與維運流程)

本手冊定義了從需求分析到正式上線的完整步驟，確保每次改版都穩定有序。

---

## 分支架構

| 分支 | 用途 |
|------|------|
| `office`（或其他功能分支） | 開發 / 測試環境，對應 `gem-dev` 容器（port 8081） |
| `main` | 正式環境，測試通過後才合併進來 |

- 所有新功能在分支上開發，測試沒問題才合併到 `main`
- `main` 永遠是穩定版本

---

## ⚡ 觸發條件（何時應遵循此規範）

| 觸發情境 | 必做步驟 |
|---------|---------|
| 修改 `src/scripts/` 任何 `.js` 檔案 | 第二步（更新 CHANGELOG）→ 第三步（commit） |
| 修改 `agent/skills/` 任何 `.md` 檔案 | 第三步（commit） |
| 用戶說「更新策略」、「部署」、「上線」 | 第二步 → 第三步 → 第四步 |
| 用戶說「commit」、「push」、「合併」 | 第三步（含格式檢查） |
| 用戶說「更新改版資訊」 | 使用 `npm run release:update -- ...` 自動執行第二步 → 第三步 → push |
| 完成一個功能實作 | 第二步 → 第三步 |

**CHANGELOG 格式檢查清單（每次 commit 前必確認）：**
- [ ] 版本號格式：`[vX.Y.Z] - YYYY-MM-DD`
- [ ] 標題一行：`### 🔧 簡短說明`
- [ ] 條目 ≤ 10 點
- [ ] 總字數 ≤ 300 字
- [ ] 不包含子彈點的子項目（只有一層）
- [ ] 只保留最新版本，舊版本全部移除

---

## 🚀 流程四步驟

### 第一步：開發 (Development)
1. 在功能分支（如 `office`）上修改程式碼
2. 重啟 `gem-dev` 容器驗證：`docker restart gem-dev`
3. 使用測試機器人（@stageGGTBOT）確認功能正常

### 第二步：更新改版資訊 (Changelog)
1. 在根目錄的 **`BOT_CHANGELOG.md`** 中記錄本次變動
   - 格式：`[vX.Y.Z] - YYYY-MM-DD`
   - **總字數不超過 300 字**
   - **摘要條目不超過 10 點**
   - **只有一層條目，不使用子彈點**
   - **只保留最新版本的內容，舊版本紀錄全部移除**
   - 優先使用 `npm run release:update -- --version vX.Y.Z --title "..." --bullet "..." --commit "..." --push --stage <path>`
   - `--bullet` 可重複提供，但不得超過 10 次
   - `--stage` 只列入本次改版相關檔案，禁止納入 `data/*.json`、`data/bot.lock`、回測結果、log、credentials

### 第三步：提交與推送 (Commit & Push)
1. 若使用 `release:update`，由腳本自動 `git add`、`git diff --cached --check`、`git commit`、`git push`
2. 若手動處理，禁止 `git add -A`；只能 stage 本次相關檔案
3. `git commit -m "feat|fix|chore: [說明]"`
4. `git push origin <分支名>`

### 第四步：合併到 main (Merge)
測試確認沒問題後：
1. `git checkout main`
2. `git merge <分支名> --no-ff -m "merge: vX.Y.Z from <分支名>"`
3. `git push origin main`
4. `git checkout <分支名>`（切回繼續開發）
5. 重啟容器套用最新版：`docker restart gem-dev`

> ⚠️ **Runtime 資料不列入 commit**
> 以下為執行期動態資料，已列入 `.gitignore`，**絕對不可手動 `git add`**：
> - `bot_state*.json` — 白名單、進場策略、追蹤清單
> - `bot_history.json` — 歷史戰績紀錄
> - `contracts.json` — 合約資料
