# Implementation Plan

- [x] 1. 撰寫 Bug 條件探索測試（在修復前執行）
  - **Property 1: Fault Condition** - 多層驗證信號生成失效
  - **重要**: 此測試必須在未修復的代碼上執行並失敗 - 失敗確認 bug 存在
  - **不要嘗試修復測試或代碼當測試失敗時**
  - **注意**: 此測試編碼了預期行為 - 它將在實現後通過時驗證修復
  - **目標**: 揭示證明 bug 存在的反例
  - **範圍化 PBT 方法**: 針對確定性 bug，將屬性範圍限定在具體失敗案例以確保可重現性
  - 測試實現細節來自設計文檔中的 Fault Condition
  - 測試斷言應匹配設計文檔中的 Expected Behavior Properties
  - 在未修復的代碼上運行測試
  - **預期結果**: 測試失敗（這是正確的 - 證明 bug 存在）
  - 記錄發現的反例以理解根本原因
  - 當測試已撰寫、運行並記錄失敗時，標記任務完成
  - 測試案例應包含：
    - RSI 觀望區間測試（RSI 評分 40-60）：構造 15m 有 SMC Bullish OB 但 RSI 評分 47 的數據，驗證未修復代碼錯誤發出 LONG 信號
    - 多時區不一致測試：構造 15m LONG 但 1h/4h 為 SHORT/NEUTRAL 的數據，驗證未修復代碼錯誤發出 LONG 信號
    - 大戶信心度低測試：構造 15m 有信號但大戶信心度 57 且只有 1 個時間框架一致的數據，驗證未修復代碼錯誤發出信號
    - 邊界條件測試：RSI 評分剛好 60 或 40 的邊界情況
  - 驗證 isBugCondition 偽代碼邏輯：
    ```
    (15m.side IN ['LONG', 'SHORT'])
    AND (rsiScore >= 40 AND rsiScore <= 60)
    AND (countConsistentTrends(['15m', '1h', '4h']) < 2)
    AND signalIsGenerated(15m.side)
    ```
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. 撰寫保留屬性測試（在修復前執行）
  - **Property 2: Preservation** - 強勢市場信號保留
  - **重要**: 遵循觀察優先方法論
  - 在未修復的代碼上觀察非 bug 條件輸入的行為
  - 撰寫基於屬性的測試，捕獲來自 Preservation Requirements 的觀察行為模式
  - 基於屬性的測試生成許多測試案例以提供更強的保證
  - 在未修復的代碼上運行測試
  - **預期結果**: 測試通過（這確認了要保留的基線行為）
  - 當測試已撰寫、運行並在未修復代碼上通過時，標記任務完成
  - 測試案例應包含：
    - 強勢做多保留：RSI 72 + 15m/1h/4h 都是 LONG + SMC Bullish OB → 應發出 LONG 信號
    - 強勢做空保留：RSI 28 + 15m/1h/4h 都是 SHORT + SMC Bearish OB → 應發出 SHORT 信號
    - Resonance 信號保留：錘子線 + 穿透布林下軌 + 多時區支持 → 應發出 LONG 信號
    - 邊界強勢場景：RSI 61（剛超過 60）+ 2 個時間框架一致 → 應發出 LONG 信號
  - 使用 Property-Based Testing 生成大量強勢市場場景（RSI >60 或 <40，多時區一致）
  - 驗證修復前的正確信號生成行為
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 3. 修復策略判斷邏輯 Bug

  - [x] 3.1 新增 RSI 評分計算函數
    - 在 `getMultiTfAnalysis` 函數之前插入 `calculateRSIScore` 函數
    - 基於 RSI 6-12-24 組合計算 0-100 評分
    - 實現權重邏輯：RSI 24 (50%), RSI 12 (30%), RSI 6 (20%)
    - 實現趨勢加成：RSI 12 向上穿越 RSI 24 加 10 分，向下穿越減 10 分
    - 確保評分範圍在 0-100 之間
    - 同步修改 `src/scripts/telegram_query_bot.js` 和 `src/scripts/production/telegram_query_bot_prod.js`
    - _Bug_Condition: isBugCondition(input) where input.rsiScore >= 40 AND input.rsiScore <= 60_
    - _Expected_Behavior: RSI 評分 > 60 為強勢做多，< 40 為強勢做空，40-60 為觀望_
    - _Preservation: 不影響現有 RSI 6-12-24 計算邏輯_
    - _Requirements: 2.2_

  - [x] 3.2 新增多時區一致性檢查函數
    - 在 `getMultiTfAnalysis` 函數之前插入 `checkTrendConsistency` 函數
    - 接受參數：results（所有時間框架結果）、targetSide（目標方向）、keyTimeframes（關鍵時間框架陣列，預設 ['15m', '1h', '4h']）
    - 計算有多少個關鍵時間框架與目標方向一致
    - 返回一致性計數（0-3）
    - 同步修改兩個文件
    - _Bug_Condition: countConsistentTrends(['15m', '1h', '4h']) < 2_
    - _Expected_Behavior: 至少 2-3 個關鍵時間框架趨勢一致才發出信號_
    - _Preservation: 不影響現有 resonance 變數計算邏輯_
    - _Requirements: 2.3, 2.4, 2.6_

  - [x] 3.3 在 getMultiTfAnalysis 函數中整合 RSI 評分計算
    - 在每個時間框架分析循環中，計算並存儲 RSI 評分
    - 特別針對 15m 時間框架計算 RSI 評分
    - 確保 prevR12 和 prevR24 數據可用於趨勢加成計算
    - 將 RSI 評分存儲到 results['15m'] 對象中
    - 同步修改兩個文件
    - _Bug_Condition: 當前邏輯未計算 RSI 評分，導致無法過濾觀望區間_
    - _Expected_Behavior: 每個時間框架都有 RSI 評分可用於信號過濾_
    - _Preservation: 不影響現有 RSI 6-12-24 指標計算_
    - _Requirements: 2.2_

  - [x] 3.4 實現多層驗證邏輯
    - 在 `getMultiTfAnalysis` 函數末尾（第 430 行之後）新增多層驗證邏輯
    - 獲取 15m 的 RSI 評分
    - 獲取大戶信心度（從 fetchOIContext 函數，預設 50）
    - 實現驗證流程：
      1. 如果 RSI 評分在 40-60 區間，返回 NEUTRAL
      2. 檢查多時區一致性計數
      3. 如果大戶信心度 < 65，要求至少 3 個時間框架一致；否則要求至少 2 個
      4. 如果一致性不足，返回 NEUTRAL
    - 更新 main.side 和 side 變數為最終驗證結果
    - 同步修改兩個文件
    - _Bug_Condition: 當前邏輯缺少多層驗證，導致在市場條件不佳時仍發出信號_
    - _Expected_Behavior: 只在 RSI 評分明確且多時區一致時才發出信號_
    - _Preservation: 強勢市場條件下（RSI >60 或 <40 且多時區一致）的信號生成不受影響_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.5 更新返回對象以包含 RSI 評分和大戶信心度
    - 在 `getMultiTfAnalysis` 函數的返回對象中新增 rsiScore 和 whaleConfidence 欄位
    - 確保這些數據可用於報告顯示
    - 同步修改兩個文件
    - _Expected_Behavior: 返回對象包含完整的市場分析數據_
    - _Preservation: 不影響現有返回欄位（symbol, main, allTfs, strategyType, side）_
    - _Requirements: 2.1_

  - [x] 3.6 驗證 Bug 條件探索測試現在通過
    - **Property 1: Expected Behavior** - 多層驗證信號生成
    - **重要**: 重新運行任務 1 中的相同測試 - 不要撰寫新測試
    - 任務 1 中的測試編碼了預期行為
    - 當此測試通過時，確認預期行為已滿足
    - 運行任務 1 中的 Bug 條件探索測試
    - **預期結果**: 測試通過（確認 bug 已修復）
    - 驗證所有 bug 條件案例現在返回 NEUTRAL：
      - RSI 觀望區間（40-60）→ NEUTRAL
      - 多時區不一致（< 2 個一致）→ NEUTRAL
      - 大戶信心度低（< 65）且只有 2 個一致 → NEUTRAL
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.7 驗證保留測試仍然通過
    - **Property 2: Preservation** - 強勢市場信號保留
    - **重要**: 重新運行任務 2 中的相同測試 - 不要撰寫新測試
    - 運行任務 2 中的保留屬性測試
    - **預期結果**: 測試通過（確認無回歸）
    - 確認所有強勢市場場景仍然發出正確信號：
      - RSI >60 + 多時區一致 + SMC 確認 → LONG 信號
      - RSI <40 + 多時區一致 + SMC 確認 → SHORT 信號
      - Resonance 信號 + 多時區支持 → 正確信號
    - 確認修復後所有測試仍然通過（無回歸）
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Checkpoint - 確保所有測試通過
  - 運行所有探索測試和保留測試
  - 驗證 Bug 條件案例返回 NEUTRAL
  - 驗證強勢市場案例仍然發出正確信號
  - 驗證兩個文件（開發和正式環境）的修改同步
  - 如有問題，詢問用戶
