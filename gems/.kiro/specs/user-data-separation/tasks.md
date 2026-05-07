# 實作計畫：用戶資料分離 (User Data Separation)

## 概覽

依序建立 StateManager 模組、遷移腳本，再修改 Bot 主程式、Loop C、keyboards.js，最後串接所有元件。

## 任務

- [x] 1. 建立 StateManager 模組（`src/scripts/state_manager.js`）
  - 建立 `data/` 目錄（若不存在）
  - 實作 `loadGlobalState()` / `saveGlobalState(state)`，含原子寫入（tmp → rename）
  - 實作 `loadUserState(chatId)` / `saveUserState(chatId, state)`，含原子寫入
  - 實作 `getAllUserChatIds()`，掃描 `data/state_*.json` 並過濾出 chatId
  - 實作 `migrateFromLegacy()`，讀取 `data/bot_state.json`，分拆全域與用戶資料，備份舊檔
  - 所有讀取失敗時回傳預設值，不拋出例外
  - _需求：1.1–1.5, 2.1–2.6, 3.1–3.3, 4.1–4.6_

  - [ ]* 1.1 為 `loadGlobalState` / `saveGlobalState` 撰寫屬性測試
    - **Property 1: 全域狀態 round-trip**
    - **Validates: Requirements 1.1, 1.4, 1.5**

  - [ ]* 1.2 為 `loadUserState` / `saveUserState` 撰寫屬性測試
    - **Property 2: 用戶狀態 round-trip**
    - **Validates: Requirements 2.1, 2.4, 2.5**

  - [ ]* 1.3 為 `getAllUserChatIds` 撰寫屬性測試
    - **Property 3: getAllUserChatIds 包含所有已儲存用戶**
    - **Validates: Requirements 2.6**

  - [ ]* 1.4 為原子寫入撰寫屬性測試
    - **Property 4: 原子寫入後無暫存檔殘留**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 1.5 為 `migrateFromLegacy` 撰寫屬性測試
    - **Property 5: 遷移完整性**
    - **Validates: Requirements 4.2, 4.3, 4.6**

  - [x]* 1.6 撰寫 StateManager 單元測試（邊界條件與錯誤處理）
    - 測試 `loadGlobalState()` 在檔案不存在時回傳預設值（需求 1.2）
    - 測試 `loadUserState(chatId)` 在檔案不存在時回傳預設值（需求 2.2）
    - 測試損壞 JSON 時不拋出例外（需求 1.3, 2.3）
    - 測試 `migrateFromLegacy()` 在 `bot_state.json` 不存在時不拋出例外（需求 4.5）
    - 測試遷移完成後 `bot_state.json.bak` 存在（需求 4.4）

- [x] 2. 建立遷移腳本（`src/scripts/migrate_state.js`）
  - 引入 StateManager，呼叫 `migrateFromLegacy()`
  - 輸出遷移結果摘要（遷移了哪些 chatId、全域欄位）
  - 設計為可獨立執行（`node src/scripts/migrate_state.js`）
  - _需求：4.1–4.6_

- [x] 3. 更新 `src/scripts/keyboards.js`
  - 修改 `KEYBOARDS.ADMIN` 接受 `hasApiKey = false` 參數
  - 依 `hasApiKey` 動態決定按鈕文字：`🔗 連動模擬倉(未連接)` / `✅ 連動模擬倉(已連接)`
  - 將原 `🔑 設定 API Key` 按鈕替換為上述動態文字按鈕
  - _需求：6.1, 6.2, 6.3_

  - [ ]* 3.1 為按鈕文字動態化撰寫屬性測試
    - **Property 8: 按鈕文字動態反映 apiKey 狀態**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [x] 4. 更新 `src/scripts/telegram_query_bot.js`（第一部分：狀態讀寫替換）
  - 引入 StateManager 的所有函式
  - 移除舊的 `loadState()` / `saveState()` 函式定義
  - 將 `loadState()` 呼叫替換為 `loadGlobalState()` + 各用戶 `loadUserState(chatId)`
  - 將 `saveState()` 呼叫替換為 `saveGlobalState()` + `saveUserState(chatId, state)`
  - 啟動時呼叫 `migrateFromLegacy()`（若 `bot_state.json` 存在則自動遷移）
  - 更新 `lastUpdateId` 的讀寫改為操作 `globalState.lastUpdateId`
  - _需求：1.4, 1.5, 2.4, 2.5_

- [x] 5. 更新 `src/scripts/telegram_query_bot.js`（第二部分：API key 流程按用戶隔離）
  - 將 API key 驗證成功後的儲存邏輯改為 `saveUserState(chatId, userState)`
  - 讀取 API key 時改為 `loadUserState(chatId).credentials`，不再讀取全域 `bingx_credentials.json`
  - 更新所有呼叫 `KEYBOARDS.ADMIN()` 的地方，傳入 `hasApiKey` 參數
  - 按鈕文字 `🔑 設定 API Key` 的 handler 改為對應新按鈕文字
  - _需求：6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 5.1 為 API key 按用戶隔離撰寫屬性測試
    - **Property 9: API key 按用戶隔離儲存**
    - **Validates: Requirements 7.1, 7.3**

- [x] 6. 更新 Loop F（`telegram_query_bot.js` 中的 `loopRankMonitor`）
  - 將 Loop F 中遍歷 `botState.admins` 的邏輯改為遍歷 `getAllUserChatIds()`
  - 對每個 chatId 呼叫 `loadUserState(chatId)`，檢查 `credentials.apiKey`
  - 有 apiKey 且無相同 symbol 持倉 → 建立 `isPaper: true` 模擬倉，呼叫 `saveUserState`
  - 無 apiKey → 跳過，不開倉
  - 某用戶讀取失敗時 `continue`，不中斷整體迴圈
  - _需求：5.1–5.7_

  - [ ]* 6.1 為 Loop F 開倉邏輯撰寫屬性測試
    - **Property 6: Loop F 按 apiKey 決定是否開倉**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.7**

  - [ ]* 6.2 為 Loop F 不重複開倉撰寫屬性測試
    - **Property 7: Loop F 不重複開倉**
    - **Validates: Requirements 5.6**

- [x] 7. 更新 `src/scripts/loops/loopC_exit.js`（按用戶隔離）
  - 修改 `runLoopExit(ctx)` 改為遍歷 `getAllUserChatIds()`
  - 對每個 chatId 呼叫 `loadUserState(chatId)` 取得 `activeStrategies`
  - 出場後呼叫 `saveUserState(chatId, userState)` 持久化（含 history 更新）
  - 某用戶狀態讀取失敗時 `continue`，不中斷其他用戶處理
  - ctx 需傳入 `getAllUserChatIds`、`loadUserState`、`saveUserState`
  - _需求：8.1–8.4_

  - [ ]* 7.1 為 Loop C 出場記錄撰寫屬性測試
    - **Property 10: Loop C 出場記錄 round-trip**
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 7.2 撰寫 Loop C 用戶隔離單元測試
    - 測試某用戶狀態損壞時其他用戶仍被處理（需求 8.4）

- [x] 8. 最終整合與串接
  - 確認 `telegram_query_bot.js` 傳入 Loop C ctx 包含 `getAllUserChatIds`、`loadUserState`、`saveUserState`
  - 確認 `telegram_query_bot.js` 傳入 Loop F ctx 包含相同函式
  - 確認 `loopA_major.js` 的 `saveState` 呼叫已更新為按用戶儲存
  - 確認所有 `botState.activeStrategies` 的讀寫已改為對應用戶的 `userState`
  - _需求：5.5, 8.1_

- [ ] 9. 最終檢查點
  - 確認所有測試通過，詢問用戶是否有問題。
