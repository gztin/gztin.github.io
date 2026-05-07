---
name: Trading Specifications (交易策略規範)
description: 核心交易邏輯、掃描進場、持倉監測與出場管理規範。
---

# Trading Specifications (交易策略規範)

本技能定義機器人的完整交易邏輯，從掃描選幣、進場確認、持倉監控到出場管理。

---

## ⚡ 觸發條件（何時應遵循此規範）

以下情況發生時，**必須**參照本規範：

| 觸發情境 | 應參照文件 |
|---------|---------|
| 修改 `src/scripts/loops/` 任何 loop 檔案 | 對應的策略文件（Entry / ExitManagement / PositionMonitor） |
| 修改 `src/scripts/scanner.js` 的進場邏輯 | `strategy_Entry.md` |
| 修改出場條件（TP/SL/BE/移動止損） | `strategy_ExitManagement.md` |
| 用戶說「優化策略」、「調整進場條件」 | `strategy_Entry.md` + 先跑回測驗證 |
| 用戶說「改出場邏輯」、「調整止損」 | `strategy_ExitManagement.md` |
| 策略參數有任何變動 | 更新對應 `.md` 文件的參數速查表 |
| 跑完回測要上線 | 先通過 `validation/` 四層驗證再 commit |

---

## 📂 策略文件索引

- 🎯 **[進場策略 (Entry Strategy)](./strategy_Entry.md)**
  掃描器規則、初篩條件、Loop A/D/E 掃描架構、起漲/起跌形態評分、開單規則、反向換倉條件。

- 👁️ **[持倉監測 (Position Monitor)](./strategy_PositionMonitor.md)**
  Loop B：每 30 秒背景執行，偵測 15m K 線反轉形態、資金費率、OI 異常。結果存入 strategy 物件，用戶查詢 `/LIST` 時顯示，不主動推送訊息。

- 💰 **[止盈/止損管理 (Exit Management)](./strategy_ExitManagement.md)**
  Loop C：每 1 秒執行，移動止損邏輯 + SL Fallback 出場。TP 由 BingX 自動處理。

---

## Loop 架構總覽

**Loop A** — 主流幣掃描（BTC/ETH/XAU/OIL100），每 1 秒
- 多空雙向評估，有反向訊號時執行換倉

**Loop B** — 反轉偵測 + 指標警告，每 1 分鐘
- 15m K 線背景執行，結果存入 strategy，/LIST 查詢時顯示，不主動平倉

**Loop C** — SL Fallback 備援，每 1 秒
- BingX 止損單備援 + 48h 超時保護，TP 由 BingX 自動處理

**Loop D** — 抄底偵測（三針戰法），每 1 秒
- 跌幅第一的幣種，做多

**Loop E** — 抄頂偵測（評分制），每 1 秒
- 漲幅第一的幣種，做空，評分 ≥ 75 才開單

---

## 核心參數速查

- 掃描幣種：BTC、ETH、XAU（黃金）、OIL100（原油）（固定），Loop D/E 掃排行榜極端幣
- 方向：多空雙向（LONG / SHORT）
- 保證金：固定 3 USDT/筆
- 槓桿：BTC/ETH 75x；其他 HIGH=10x / MED=7x / LOW=5x
- 掃描頻率：Loop A/D/E 每 1 秒；Loop B 每 1 分鐘；Loop C 每 1 秒
- 冷卻機制：無時間冷卻，以持倉狀態控制

**Loop A 進場參數（v3 優化版）**
- 4h 過濾：RSI(14) > 55 + 收盤 > EMA(89)（多）/ RSI < 45 + 收盤 < EMA(89)（空）
- 1h 動能：EMA34 > EMA89 + RSI > 52 + 5根內曾穿越50 + 量 > 1.4x
- 15m 形態門檻：≥ 5 分（舊版 4 分）
- 錨點要求：BOS 或 EMA 排列至少一個成立
- SL 上限：距離 > 4%（舊版 8%）
- 第二階段共振：≥ 5 分

**出場架構（v3）**
- 主要出場：BingX TP1(1R)/TP2(1.618R)/TP3(2.618R) + SL 自動執行
- Loop B：純監測警告，不主動平倉
- Loop C：SL Fallback 備援（BingX 未執行時介入）+ 48h 超時保護
