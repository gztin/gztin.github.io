# 策略判斷邏輯 Bug 修復設計

## Overview

此 Bug 修復針對 Telegram Bot 的交易策略判斷邏輯缺陷。當前邏輯過度依賴單一時間框架（15m）的 SMC/SNR 信號，忽略了多時區趨勢一致性和 RSI 評分，導致在市場條件不佳時發出錯誤的交易信號。

修復策略採用多層驗證機制：
1. 將 15m SMC/SNR 信號從主要觸發條件降級為輔助確認條件
2. 引入 RSI 評分閾值檢查（觀望區間 40-60）
3. 要求至少 2-3 個關鍵時間框架趨勢一致
4. 納入大戶信心度作為信號強度調節因子

## Glossary

- **Bug_Condition (C)**: 當 15m 時間框架檢測到 SMC/SNR 信號，但其他時間框架趨勢不一致或 RSI 評分處於觀望區間時，系統仍發出交易信號
- **Property (P)**: 修復後系統應該只在多時區趨勢一致且 RSI 評分明確（>60 或 <40）時才發出信號
- **Preservation**: 當市場條件強勢（RSI 評分明確 + 多時區一致 + SMC/SNR 確認）時，系統必須繼續發出正確的交易信號
- **getMultiTfAnalysis**: `telegram_query_bot.js` 中的核心函數，負責多時區技術分析和策略判斷
- **side**: 交易方向判斷結果（LONG/SHORT/NEUTRAL）
- **strategyType**: 策略類型（趨勢波段/短期反彈/觀望）
- **resonance**: 多時區共振標記，當 1h/4h/1d 與 15m 趨勢一致時為 true
- **RSI 評分**: 基於 RSI 6-12-24 組合計算的市場強度評分（0-100）
- **大戶信心度**: 基於 Binance 大戶持倉比例計算的市場信心指標（0-100）

## Bug Details

### Fault Condition

Bug 發生在 `getMultiTfAnalysis` 函數的策略判斷邏輯中（第 426 行）。當前邏輯使用單一條件判斷交易方向：

```javascript
side: (resonanceLong || (rsiLong && curP > ema50 && (nearSupport || smcLong))) ? 'LONG' 
    : (resonanceShort || (rsiShort && curP < ema50 && (nearResist || smcShort))) ? 'SHORT' 
    : 'NEUTRAL'
```

此邏輯的問題在於：
1. 只要 15m 時間框架的 `rsiLong` 為 true 且檢測到 SMC/SNR 信號，就會發出 LONG 信號
2. 未檢查 RSI 評分是否處於觀望區間（40-60）
3. 未驗證其他時間框架（5m, 1h, 4h, 1d）的趨勢一致性
4. 未考慮大戶信心度作為信號過濾條件

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { tfData: Object, rsiScore: Number, whaleConfidence: Number }
  OUTPUT: boolean
  
  RETURN (input.tfData['15m'].side IN ['LONG', 'SHORT'])
         AND (input.rsiScore >= 40 AND input.rsiScore <= 60)
         AND (countConsistentTrends(input.tfData, ['15m', '1h', '4h']) < 2)
         AND signalIsGenerated(input.tfData['15m'].side)
END FUNCTION

FUNCTION countConsistentTrends(tfData, timeframes)
  targetSide := tfData['15m'].side
  count := 0
  FOR EACH tf IN timeframes DO
    IF tfData[tf].side == targetSide THEN count := count + 1
  END FOR
  RETURN count
END FUNCTION
```

### Examples

**範例 1: RSI 觀望區間但仍發出信號**
- 15m: SMC Bullish OB 檢測到，rsiLong=true，curP > ema50 → 發出 LONG 信號
- RSI 評分: 47/100（觀望 NEUTRAL）
- RSI 24 大方向: 向下（偏空）
- 預期行為: 應返回 NEUTRAL，不發出信號
- 實際行為: 發出 LONG 信號 ❌

**範例 2: 多時區趨勢不一致但仍發出信號**
- 15m: 盤整 NEUTRAL
- 5m: 看跌 SHORT
- 1h: 看跌 SHORT
- 4h: 盤整 NEUTRAL
- 1d: 盤整 NEUTRAL
- 15m 檢測到 SMC Bullish OB → 發出 LONG 信號
- 預期行為: 應返回 NEUTRAL（大部分時間框架不支持做多）
- 實際行為: 發出 LONG 信號 ❌

**範例 3: 大戶信心度低但仍發出信號**
- 15m: SMC Bullish OB，rsiLong=true
- 大戶信心度: 57/100（中等偏低）
- 預期行為: 應降低信號強度或要求更嚴格的多時區一致性
- 實際行為: 直接發出 LONG 信號，未考慮大戶信心度 ❌

**範例 4: 強勢做多場景（應該發出信號）**
- RSI 評分: 72/100（強勢做多）
- 15m: LONG，SMC Bullish OB
- 1h: LONG
- 4h: LONG
- 大戶信心度: 78/100
- 預期行為: 發出 LONG 信號 ✅
- 實際行為: 發出 LONG 信號 ✅（此為正確行為，需保留）

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- 當 RSI 評分 > 60 且至少 2-3 個關鍵時間框架趨勢一致為 LONG，且 SMC/SNR 顯示支撐信號時，系統必須繼續發出 LONG 信號
- 當 RSI 評分 < 40 且至少 2-3 個關鍵時間框架趨勢一致為 SHORT，且 SMC/SNR 顯示壓力信號時，系統必須繼續發出 SHORT 信號
- 檢測到 resonanceLong（錘子線/看漲吞沒 + 穿透布林下軌）且多時區趨勢支持時，系統必須繼續發出 LONG 信號
- 檢測到 resonanceShort（流星線/看跌吞沒 + 穿透布林上軌）且多時區趨勢支持時，系統必須繼續發出 SHORT 信號
- TP1/TP2/TP3 和止損價位計算邏輯必須保持不變
- 交易報告生成和格式化輸出邏輯必須保持不變

**Scope:**
所有在強勢市場條件下（RSI 評分明確 + 多時區一致）的正確信號生成行為應完全不受影響。此修復只針對市場條件不佳時的錯誤信號過濾。

## Hypothesized Root Cause

基於代碼分析，最可能的問題根源是：

1. **過度簡化的信號判斷邏輯**: 第 426 行的 `side` 判斷使用單一布林表達式，未分層驗證市場條件
   - 只檢查 15m 時間框架的技術指標
   - 未整合 RSI 評分和多時區趨勢分析結果
   - 缺乏信號強度分級機制

2. **RSI 評分未被使用**: 雖然代碼中計算了 RSI 6-12-24，但未將其轉換為評分並用於信號過濾
   - `rsiLong` 和 `rsiShort` 只是簡單的布林條件
   - 未檢查 RSI 是否處於觀望區間（40-60）

3. **多時區趨勢一致性檢查不足**: 雖然計算了 `resonance` 變數，但只用於決定策略類型，未用於信號過濾
   - `resonance` 只檢查 1h/4h/1d 是否與 15m 一致
   - 未要求最少時間框架數量的一致性

4. **大戶信心度未整合**: 代碼中有 `fetchOIContext` 函數獲取大戶數據，但未用於策略判斷邏輯
   - OI 數據只用於調整 TP/SL 倍數
   - 未作為信號過濾條件

## Correctness Properties

Property 1: Fault Condition - 多層驗證信號生成

_For any_ 市場數據輸入，當 15m 時間框架檢測到 SMC/SNR 信號時，修復後的函數 SHALL 執行以下多層驗證才能發出 LONG/SHORT 信號：
1. RSI 評分必須明確（LONG: >60, SHORT: <40）
2. 至少 2 個關鍵時間框架（從 15m, 1h, 4h 中）趨勢一致
3. 若大戶信心度 < 65，則要求至少 3 個時間框架一致

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - 強勢市場信號保留

_For any_ 市場數據輸入，當 RSI 評分明確（>60 或 <40）且至少 2-3 個關鍵時間框架趨勢一致，且 SMC/SNR 顯示確認信號時，修復後的函數 SHALL 產生與原始函數相同的 LONG/SHORT 信號，保留所有正確的強勢市場交易信號。

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

假設我們的根因分析正確，需要進行以下修改：

**File**: `src/scripts/telegram_query_bot.js` 和 `src/scripts/production/telegram_query_bot_prod.js`

**Function**: `getMultiTfAnalysis`

**Specific Changes**:

1. **新增 RSI 評分計算函數**（插入在 `getMultiTfAnalysis` 之前）:
   ```javascript
   function calculateRSIScore(rsi6, rsi12, rsi24, prevR12, prevR24) {
     // 基於 RSI 6-12-24 組合計算 0-100 評分
     // >60: 強勢做多, <40: 強勢做空, 40-60: 觀望
     const r24Weight = 0.5, r12Weight = 0.3, r6Weight = 0.2;
     const baseScore = r24 * r24Weight + r12 * r12Weight + r6 * r6Weight;
     
     // 趨勢加成：RSI 12 向上穿越 RSI 24 加分
     const trendBonus = (r12 > prevR24 && prevR12 <= prevR24) ? 10 : 
                        (r12 < prevR24 && prevR12 >= prevR24) ? -10 : 0;
     
     return Math.max(0, Math.min(100, baseScore + trendBonus));
   }
   ```

2. **新增多時區一致性檢查函數**:
   ```javascript
   function checkTrendConsistency(results, targetSide, keyTimeframes = ['15m', '1h', '4h']) {
     let consistentCount = 0;
     for (const tf of keyTimeframes) {
       if (results[tf] && results[tf].side === targetSide) {
         consistentCount++;
       }
     }
     return consistentCount;
   }
   ```

3. **修改 `getMultiTfAnalysis` 函數內的信號判斷邏輯**（第 355-430 行區域）:
   - 在每個時間框架分析循環中，計算 RSI 評分並存儲
   - 在最終信號判斷前，整合 RSI 評分、多時區一致性、大戶信心度

4. **重構 `side` 判斷邏輯**（第 426 行）:
   ```javascript
   // 原邏輯（錯誤）:
   side: (resonanceLong || (rsiLong && curP > ema50 && (nearSupport || smcLong))) ? 'LONG' : ...
   
   // 新邏輯（修復後）:
   // 先計算初步信號
   const preliminarySide = (resonanceLong || (rsiLong && curP > ema50 && (nearSupport || smcLong))) ? 'LONG' 
                         : (resonanceShort || (rsiShort && curP < ema50 && (nearResist || smcShort))) ? 'SHORT' 
                         : 'NEUTRAL';
   
   // 存儲初步信號，稍後進行多層驗證
   side: preliminarySide
   ```

5. **在 `getMultiTfAnalysis` 函數末尾新增多層驗證邏輯**（第 430 行之後）:
   ```javascript
   // 計算 15m 的 RSI 評分
   const main = results['15m'];
   const rsiScore = calculateRSIScore(
     main.rsi6, main.rsi12, main.rsi24, 
     results['15m'].prevR12, results['15m'].prevR24
   );
   
   // 獲取大戶信心度（如果可用）
   const oiData = await fetchOIContext(symbol);
   const whaleConfidence = oiData?.convictionScore || 50;
   
   // 多層驗證
   let finalSide = main.side;
   
   if (main.side !== 'NEUTRAL') {
     // 檢查 RSI 評分是否在觀望區間
     if (rsiScore >= 40 && rsiScore <= 60) {
       finalSide = 'NEUTRAL'; // RSI 觀望，不發出信號
     } else {
       // 檢查多時區一致性
       const consistentCount = checkTrendConsistency(results, main.side, ['15m', '1h', '4h']);
       const requiredConsistency = whaleConfidence < 65 ? 3 : 2;
       
       if (consistentCount < requiredConsistency) {
         finalSide = 'NEUTRAL'; // 多時區不一致，不發出信號
       }
     }
   }
   
   // 更新 main.side 和返回值
   main.side = finalSide;
   const side = finalSide;
   ```

6. **保存 RSI 評分和大戶信心度到返回對象**（用於報告顯示）:
   ```javascript
   return { 
     symbol, 
     main, 
     allTfs: results, 
     strategyType, 
     side,
     rsiScore,        // 新增
     whaleConfidence  // 新增
   };
   ```

7. **同步修改正式環境文件**: 將所有修改同步應用到 `src/scripts/production/telegram_query_bot_prod.js`

## Testing Strategy

### Validation Approach

測試策略採用兩階段方法：首先在未修復代碼上運行探索性測試以確認 bug 存在並理解根因，然後在修復後驗證信號生成正確性和行為保留性。

### Exploratory Fault Condition Checking

**Goal**: 在實施修復前，在未修復代碼上運行測試以確認 bug 存在並驗證根因假設。

**Test Plan**: 構造模擬市場數據，包含 bug 條件（RSI 觀望區間、多時區不一致），在未修復的 `getMultiTfAnalysis` 函數上運行，觀察是否錯誤發出信號。

**Test Cases**:
1. **RSI 觀望區間測試**: 構造 15m 有 SMC 信號但 RSI 評分 47 的數據（將在未修復代碼上失敗 - 錯誤發出 LONG 信號）
2. **多時區不一致測試**: 構造 15m LONG 但 1h/4h 為 SHORT/NEUTRAL 的數據（將在未修復代碼上失敗 - 錯誤發出 LONG 信號）
3. **大戶信心度低測試**: 構造 15m 有信號但大戶信心度 57 且只有 1 個時間框架一致的數據（將在未修復代碼上失敗 - 錯誤發出信號）
4. **邊界條件測試**: RSI 評分剛好 60 或 40 的邊界情況（觀察未修復代碼行為）

**Expected Counterexamples**:
- 未修復代碼會在 RSI 觀望區間時仍發出 LONG/SHORT 信號
- 未修復代碼會在多時區不一致時仍發出信號
- 可能的根因：缺少 RSI 評分閾值檢查、缺少多時區一致性驗證

### Fix Checking

**Goal**: 驗證修復後的函數在所有 bug 條件輸入下都能正確返回 NEUTRAL，不發出錯誤信號。

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := getMultiTfAnalysis_fixed(input)
  ASSERT result.side == 'NEUTRAL'
  ASSERT result.strategyType == '建議觀望'
END FOR
```

**Test Cases**:
1. RSI 評分在 40-60 區間 → 應返回 NEUTRAL
2. 只有 1 個時間框架與 15m 一致 → 應返回 NEUTRAL
3. 大戶信心度 < 65 且只有 2 個時間框架一致 → 應返回 NEUTRAL
4. 組合條件：RSI 47 + 多時區不一致 + 大戶信心度低 → 應返回 NEUTRAL

### Preservation Checking

**Goal**: 驗證修復後的函數在強勢市場條件下（非 bug 條件）產生與原始函數相同的信號，確保不影響正確的交易信號。

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getMultiTfAnalysis_original(input).side == getMultiTfAnalysis_fixed(input).side
END FOR
```

**Testing Approach**: 使用 Property-Based Testing 生成大量強勢市場場景（RSI >60 或 <40，多時區一致），驗證修復前後信號一致。

**Test Plan**: 先在未修復代碼上觀察強勢市場場景的正確信號生成行為，然後編寫 PBT 測試捕獲這些行為，確保修復後保持不變。

**Test Cases**:
1. **強勢做多保留**: RSI 72 + 15m/1h/4h 都是 LONG + SMC Bullish OB → 修復前後都應發出 LONG 信號
2. **強勢做空保留**: RSI 28 + 15m/1h/4h 都是 SHORT + SMC Bearish OB → 修復前後都應發出 SHORT 信號
3. **Resonance 信號保留**: 錘子線 + 穿透布林下軌 + 多時區支持 → 修復前後都應發出 LONG 信號
4. **邊界強勢場景**: RSI 61（剛超過 60）+ 2 個時間框架一致 → 修復前後都應發出 LONG 信號

### Unit Tests

- 測試 `calculateRSIScore` 函數的評分計算邏輯（邊界值 40/60，趨勢加成）
- 測試 `checkTrendConsistency` 函數的一致性計數（0/1/2/3 個時間框架一致）
- 測試 RSI 觀望區間過濾邏輯（40-60 應返回 NEUTRAL）
- 測試多時區一致性要求邏輯（< 2 個一致應返回 NEUTRAL）
- 測試大戶信心度調節邏輯（< 65 時要求 3 個一致）
- 測試邊界條件（RSI 剛好 40/60，一致性剛好 2/3）

### Property-Based Tests

- 生成隨機市場數據（RSI 0-100，各時間框架隨機 LONG/SHORT/NEUTRAL），驗證：
  - RSI 在 40-60 時必定返回 NEUTRAL
  - 一致性不足時必定返回 NEUTRAL
  - RSI >60 且一致性足夠時必定發出 LONG 信號
- 生成隨機強勢市場場景，驗證修復前後信號一致（preservation property）
- 測試大戶信心度對一致性要求的影響（< 65 vs >= 65）

### Integration Tests

- 使用真實歷史市場數據測試完整流程（從 Binance API 獲取數據 → 分析 → 信號生成）
- 測試兩個文件的修改同步性（`telegram_query_bot.js` 和 `telegram_query_bot_prod.js` 行為一致）
- 測試信號生成後的報告格式化（`formatReport` 函數應正確顯示 RSI 評分和大戶信心度）
- 測試 `/CHECK` 命令的完整流程（包含進度更新、圖表生成、報告發送）
- 測試 `/TRACE` 自動監控流程（確保修復後不會頻繁發出錯誤信號）
