# 專案結構說明

> 最後更新：2026-04-20

---

## 頂層目錄概覽

```
gems/
├── src/            主要程式碼（Bot 核心 + Agent 系統）
├── backtests/      回測工具與策略驗證
├── agent/          策略規範文件（Skills）
├── signals/        Agent 信號通訊目錄（runtime，不 commit）
├── data/           Bot 執行期狀態資料（runtime，不 commit）
├── k_data/         K 線歷史資料快取（runtime，不 commit）
├── ignoreCommit/   本機敏感設定（不 commit）
└── [根目錄]        Docker、部署腳本、環境設定
```

---

## src/scripts/ — Bot 核心

#### 主程式

**`telegram_query_bot.js`** — 主程式入口，約 626 行。
負責初始化環境、啟動所有交易 loop、將 Telegram 訊息路由到 `handleUpdate`。
本身不包含業務邏輯，只做組裝和調度。

---

#### core/ — 基礎設施

**`state_manager.js`** — 狀態讀寫層。
管理 `data/state_global.json` 和 `data/state_{chatId}.json`，提供原子寫入（tmp → rename）防止資料損毀。所有需要讀寫狀態的模組都透過這裡操作。

**`telegram_api.js`** — Telegram API 工具層。
封裝所有對 Telegram 的 HTTP 呼叫：`sendMessage`、`sendPhoto`、`sendDocument`、`editMessage`、`deleteMessage`、`curl`。其他模組透過 context 注入使用，不直接 import。

**`indicators.js`** — 技術指標計算。
提供 `ema`、`rsi`、`atr`、`avgVolume` 等純函式，無副作用，供 scanner 和 analysis 使用。

**`agent_monitor.js`** — 市場監控 Agent。
每小時分析所有用戶的交易 history，偵測勝率下滑、連續虧損、單筆大虧等異常，將信號寫入 `signals/` 目錄供 Orchestrator 處理。

---

#### config/ — 設定檔

**`bot.config.js`** — Bot 核心設定。
包含管理員 ID、策略參數（ADX 門檻、RSI 嚴格度）、止盈倍數（1R/1.618R/2.618R）、監控週期。含敏感資訊，不 commit，複製 `bot.config.example.js` 建立。

**`bot.config.example.js`** — 設定範本，可安全 commit，說明每個欄位的用途。

**`adaptive_params.json`** — 自適應策略參數快取，由 `AdaptiveWeights` 自動更新，不需手動編輯。

**`mappings.json`** — 幣種名稱對應表（BingX symbol ↔ 顯示名稱）。

---

#### trading/ — 交易邏輯

**`scanner.js`** — 核心掃描引擎。
實作進場訊號偵測的完整邏輯，包含 `detectBreakout`（多頭 BOS）、`detectBreakdown`（空頭 BOS）、`detectTrendEntry`（趨勢進場備用路徑）、`secondStageFilter`（第二階段指標共振）、`monitorPosition`（持倉監測）。

**`bingx_trader.js`** — BingX 交易所 API 封裝。
處理所有與 BingX 的交互：開單、平倉、查詢持倉、計算最大槓桿、查詢資金費率和 OI（未平倉量）。

**`analysis.js`** — 多時框技術分析層。
提供 `getMultiTfAnalysis`（同時分析 5m/15m/30m/1h/4h/1d 六個時框）、`formatReport`（格式化分析報告）、`fetchBinanceData`、`fetchOIContext`。內含完整 TA 物件，涵蓋 SMC 結構分析、ADX、RSI 背離、布林帶、MACD 等。

**`adaptive_weights.js`** — 自適應策略權重系統。
根據近期交易勝率動態調整進場門檻（勝率高時放寬、低時收緊）。`/STATS` 指令查看當前權重，`/RETUNE` 手動觸發重新計算。

**`chart_generator.js`** — K 線圖表生成。
接收 K 線資料和分析結果，生成圖表並回傳圖片 URL，供 `sendPhoto` 發送給用戶。

**`pattern_detector.js`** — K 線形態偵測工具，輔助 scanner.js 識別特定形態。

**`vegas.js`** — Vegas Channel 策略指標。
實作 EMA 帶狀通道、市場結構轉換（MSS）、CHoCH（性格改變）偵測，供 Loop B 監測使用。

---

#### ui/ — 使用者介面

**`commands.js`** — 所有 Telegram 指令的處理邏輯，約 1472 行。
透過 `createCommandHandlers(ctx)` 工廠函式接收 context（botState、sendMessage 等），回傳 `{ handleUpdate, handleCallbackQuery }`。涵蓋 `/CHECK`、`/LIST`、`/HISTORY`、`/EXPORT`、`/SETAPI`、`/STATS` 等所有指令。

**`keyboards.js`** — Telegram 鍵盤佈局定義。
定義主選單、工具選單、管理員選單、幣種操作選單等所有 inline keyboard 和 reply keyboard 的結構。

---

#### loops/ — 交易 Loop

每個 loop 是獨立的執行單元，由主程式用 `setInterval` 定時觸發，互不阻塞。

**`loopA_major.js`** — Loop A，每 1 秒。
掃描主流幣（BTC/ETH/XAU/OIL100），多空雙向評估，三階段過濾（4h 結構 → 1h 動能 → 15m 形態）。偵測到反向訊號時執行換倉（持倉 ≥15 分鐘且損益 > -3%）。

**`loopC_exit.js`** — Loop C，每 1 秒。
SL Fallback 備援機制。正常情況下 BingX 止損單自動執行，Loop C 作為最後防線。另處理 48h 超時深度虧損保護，以及 TP1 達標後的 EMA20 跌破出場。

**`loopDE_extreme.js`** — Loop D，每 1 秒。
抄底偵測，掃描 BingX 跌幅第一的幣種，使用三針戰法做多。

**`loopE_short.js`** — Loop E，每 1 秒。
抄頂偵測，掃描漲幅第一的幣種，評分制（滿分 100，≥75 才開空單）。

**`loopF_rank.js`** — Loop F，每 5 秒。
排行榜穩定爬升偵測。對前 30 名幣種跑線性回歸，R² > 0.6 + 斜率向上 + 低點遞增才列入清單，推送到 Telegram 頻道。

---

#### tests/ — 測試腳本

`loopC_exit.test.js` 和 `state_manager.test.js` 是單元測試。其餘為整合測試和問題重現腳本，用於開發期驗證邏輯正確性。

---

## src/agents/ — Multi-Agent 系統

信號驅動的自動策略演化系統。Bot 偵測到績效異常時，Agent 之間自動協作，提出並驗證參數調整建議，最終由人工確認後套用。

**`orchestrator.js`** — 調度器。
讀取 `signals/` 目錄的待處理信號，根據信號類型分派給對應 Agent，協調整個對話流程。

**`strategist.js`** — 策略分析師。
分析績效問題，根據策略文件提出參數調整建議。與 Backtester 進行最多 3 輪對話，每輪根據對方反饋調整方向。

**`backtester.js`** — 回測驗證師。
接收 Strategist 的建議，透過統計估算或實際回測評估可行性，給出預期勝率和反饋意見。

**`risk.js`** — 風險評估師。
評估連續虧損、單筆大虧等風險信號，給出風險等級（LOW/MEDIUM/HIGH/CRITICAL）和建議行動。

**`engineer.js`** — 實作工程師。
讀取 `ENGINEER_TASK` 信號，根據 `PARAM_MAP` 對應表找到程式碼中的確切位置，產出 diff 報告。`--apply` 模式下實際修改檔案並備份原檔。

#### Agent 工作流程

```
Bot 執行 → history 勝率下滑
  ↓ agent_monitor（每小時自動執行）
signals/STRATEGY_DEGRADED.json
  ↓ orchestrator
Strategist ←→ Backtester（最多 3 輪對話）
  ↓ 達成共識
signals/ENGINEER_TASK.json → engineer（dry-run）
  ↓
signals/DEPLOY_READY.json + diff 報告 → Telegram 通知管理員
  ↓ 人工確認
node src/agents/engineer.js --apply
```

#### 手動執行

```bash
node src/scripts/core/agent_monitor.js          # 立即執行一次監控檢查
node src/agents/orchestrator.js --dry-run       # 處理待辦信號
node src/agents/engineer.js                     # 產出變更報告
node src/agents/engineer.js --apply             # 套用變更
```

---

## backtests/ — 回測工具

**`validation/engine.js`** — 四層統計驗證引擎的核心。
實作 Walk-Forward（滾動校準驗證）、CPCV（組合交叉驗證）、Deflated Sharpe Ratio（校正選擇偏差）、Regime Analysis（牛熊震盪分季驗證）、Monte Carlo（10,000 次模擬最壞情況）。

**`validation/run_loopA_validation.js`** — 執行 Loop A 的完整四層驗證，輸出通過/失敗判決。

**`validation/run_4h_filter_sweep.js`** — 對 4h 過濾條件做參數掃描，找出最佳 RSI 和 EMA 門檻組合。

**`validation/results/`** — 驗證結果 CSV/XLSX，本地用，不 commit。

**`configs/`** — 回測設定檔，定義幣種和時間範圍。

**`loopTests/`** — Loop 邏輯的獨立測試腳本。

**`scripts/`** — 部署和伺服器同步的 shell 腳本。

---

## agent/ — 策略規範文件（Skills）

這個目錄有兩個用途：
1. **Kiro 開發輔助**：Kiro 修改策略相關程式碼時會自動讀取，確保改動符合策略規範。
2. **Agent 知識庫**：未來 `strategist.js` 升級為 LLM 驅動時，這些文件將作為 system prompt 來源。

**`skills/specs_trading/strategy_Entry.md`** — 進場策略完整規範，包含三階段過濾邏輯、各評分項目的分值、錨點過濾規則、所有參數的當前值和調整範圍。

**`skills/specs_trading/strategy_ExitManagement.md`** — 出場管理規範，說明 TP1/TP2/TP3 的計算方式（以 R 為基礎的斐波那契擴展）、Loop C SL Fallback 的四個觸發條件。

**`skills/specs_trading/strategy_PositionMonitor.md`** — 持倉監測規範，定義 Loop B 的反轉偵測邏輯和警告推送規則（只推警告，不主動平倉）。

**`skills/specs_trading/strategy_RankMomentum.md`** — Loop F 排行榜動能策略規範。

**`skills/specs_trading/strategy_RiskManager.md`** — 風險管理規範，包含倉位上限設定和連續虧損的處理原則。

**`skills/specs_trading/validation/`** — 四層驗證的執行標準，定義各層的通過門檻（如 Walk-Forward 需 ≥70% 段落獲利）。

**`skills/workflow/SKILL.md`** — 開發與維運流程，定義分支架構、CHANGELOG 格式規範、commit/push/merge 的標準步驟。

---

## signals/ — Agent 信號目錄（runtime）

Agent 之間的通訊媒介，所有 `.json` 和 `.txt` 不 commit（`.gitkeep` 除外）。

信號生命週期：產生 → Orchestrator 讀取處理 → 重命名為 `processed_*`。

信號類型說明：
- `STRATEGY_DEGRADED` — 勝率下滑，觸發 Strategist ←→ Backtester 對話
- `CONSECUTIVE_LOSS` — 連續虧損，觸發 Risk Agent 評估
- `LARGE_LOSS` — 單筆大虧，觸發 Risk Agent 評估
- `ENGINEER_TASK` — Agent 達成共識的任務，Engineer 讀取後產出 diff 報告
- `DEPLOY_READY` — 變更報告就緒，等待人工確認
- `CHANGES_APPLIED` — 變更已套用的記錄

---

## 根目錄重要檔案

**`.env`** — 環境變數，包含 `TG_TOKEN`（Telegram Bot Token）、`LOCATION`（home/office/laptop）等。不 commit，複製 `.env.example` 建立。

**`BOT_CHANGELOG.md`** — 版本更新記錄，`/VERSION` 指令直接讀取此檔案顯示給用戶。

**`docker-compose.yml` / `Dockerfile`** — 容器化部署設定，定義 dev 和 prod 兩個環境。

**`package.json`** — `npm run bot` 啟動主程式，`npm run bot:dev` 使用本地 data 目錄。

**`bot_history.json` / `contracts.json` / `tracklist.json`** — Legacy 資料檔，新版已移至 `data/state_*.json`，保留供向後相容。

---

## data/ — 執行期資料（不 commit）

**`state_global.json`** — 全域狀態，包含管理員清單、白名單、排行榜快照、掃描冷卻時間。

**`state_{chatId}.json`** — 各用戶的獨立狀態，包含持倉（activeStrategies）、歷史戰績（history）、API 憑證、訂閱清單。

**`{SYMBOL}_{interval}.json`** — K 線資料快取，由 `fetchBinanceData` 自動寫入，TTL 8 分鐘後重新抓取。

---

## ignoreCommit/ — 本機敏感設定（不 commit）

**`channels.json`** — Telegram 頻道 ID 設定，包含 Loop A 推送頻道、momentum 頻道、管理員 chat ID 等。不同部署環境有不同的頻道設定，因此不 commit。
