# Bugfix Requirements Document

## Introduction

Telegram Bot 的交易策略判斷邏輯存在嚴重缺陷，會在市場條件不佳時發出錯誤的交易信號。當前邏輯過度依賴單一時間框架（15m）的 SMC/SNR 信號，忽略了多時區趨勢一致性和 RSI 評分，導致在大部分時間框架顯示盤整或看跌、RSI 評分顯示「觀望」的情況下，仍然發出做多信號。

此 Bug 影響兩個文件：
- `src/scripts/telegram_query_bot.js`（測試/開發環境）
- `src/scripts/production/telegram_query_bot_prod.js`（正式環境）

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN 15m 時間框架檢測到 SMC Bullish Order Block 或強支撐，且 RSI 條件滿足（rsiLong && curP > ema50）THEN 系統發出 LONG 信號，即使其他時間框架（5m, 1h, 4h, 1d）顯示看跌或盤整

1.2 WHEN RSI 評分為 47/100（觀望 NEUTRAL）且 RSI 24 大方向向下（偏空）THEN 系統仍然發出 LONG 信號，因為邏輯未檢查 RSI 評分閾值

1.3 WHEN 多時區趨勢顯示 5m 看跌、15m 盤整、30m 盤整、1h 看跌、4h 盤整、1d 盤整（大部分時間框架不支持做多）THEN 系統仍然發出 LONG 信號，因為邏輯只檢查 15m 時間框架

1.4 WHEN 大戶信心度僅為 57/100（中等偏低）THEN 系統仍然發出交易信號，因為邏輯未納入大戶信心度閾值檢查

1.5 WHEN 15m 時間框架檢測到 SMC Bearish Order Block 或強壓力，且 RSI 條件滿足（rsiShort && curP < ema50）THEN 系統發出 SHORT 信號，即使其他時間框架顯示看漲或盤整

### Expected Behavior (Correct)

2.1 WHEN 15m 時間框架檢測到 SMC/SNR 信號 THEN 系統 SHALL 將其作為輔助確認條件，而非主要觸發條件，必須配合多時區趨勢一致性和 RSI 評分才能發出信號

2.2 WHEN RSI 評分低於 60 且高於 40（觀望區間）THEN 系統 SHALL 不發出 LONG 或 SHORT 信號，返回 NEUTRAL

2.3 WHEN 至少 2-3 個關鍵時間框架（15m, 1h, 4h）趨勢一致為 LONG，且 RSI 評分 > 60 THEN 系統 SHALL 發出 LONG 信號

2.4 WHEN 至少 2-3 個關鍵時間框架（15m, 1h, 4h）趨勢一致為 SHORT，且 RSI 評分 < 40 THEN 系統 SHALL 發出 SHORT 信號

2.5 WHEN 大戶信心度低於 65/100 THEN 系統 SHALL 降低信號強度或要求更嚴格的多時區一致性（例如需要 3 個時間框架一致而非 2 個）

2.6 WHEN 多時區趨勢不一致（例如 15m 看漲但 1h 和 4h 看跌）THEN 系統 SHALL 返回 NEUTRAL，不發出交易信號

### Unchanged Behavior (Regression Prevention)

3.1 WHEN RSI 評分 > 60 且至少 2-3 個關鍵時間框架趨勢一致為 LONG，且 SMC/SNR 顯示支撐信號 THEN 系統 SHALL CONTINUE TO 發出 LONG 信號（這是正確的強勢做多場景）

3.2 WHEN RSI 評分 < 40 且至少 2-3 個關鍵時間框架趨勢一致為 SHORT，且 SMC/SNR 顯示壓力信號 THEN 系統 SHALL CONTINUE TO 發出 SHORT 信號（這是正確的強勢做空場景）

3.3 WHEN 檢測到 resonanceLong（錘子線/看漲吞沒 + 穿透布林下軌）且多時區趨勢支持 THEN 系統 SHALL CONTINUE TO 發出 LONG 信號（這是正確的反轉信號）

3.4 WHEN 檢測到 resonanceShort（流星線/看跌吞沒 + 穿透布林上軌）且多時區趨勢支持 THEN 系統 SHALL CONTINUE TO 發出 SHORT 信號（這是正確的反轉信號）

3.5 WHEN 計算 TP1/TP2/TP3 和止損價位 THEN 系統 SHALL CONTINUE TO 使用現有的斐波那契和風險回報比計算邏輯

3.6 WHEN 生成交易報告和格式化輸出 THEN 系統 SHALL CONTINUE TO 使用現有的 formatReport 函數邏輯
