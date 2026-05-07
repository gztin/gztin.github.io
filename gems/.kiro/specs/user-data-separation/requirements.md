# 需求文件：用戶資料分離 (User Data Separation)

## 簡介

目前系統將所有用戶資料（訂閱、持倉、歷史、API 憑證等）集中存放於單一 `bot_state.json`，導致多用戶場景下資料耦合、難以擴展，且 API 憑證無法按用戶獨立管理。

本功能將資料架構重構為：
- **每用戶獨立檔案**：`state_{chatId}.json`，存放個人持倉、歷史、憑證等
- **全域共用檔案**：`state_global.json`，存放管理員名單、白名單、排行榜快照等
- **Loop F 模擬倉連動**：信號觸發時，自動為有設定 API key 的用戶開模擬倉
- **管理者介面按鈕更名**：「設定 API Key」改為「連動模擬倉(未連接)」或「連動模擬倉(已連接)」

---

## 詞彙表

- **State_Manager**：負責讀寫用戶與全域狀態檔案的模組
- **Loop_F**：排行榜排名監控迴圈，每 30 秒執行一次，偵測排名爬升信號
- **User_State**：單一用戶的狀態物件，存放於 `state_{chatId}.json`
- **Global_State**：全域共用狀態物件，存放於 `state_global.json`
- **Paper_Position**：模擬倉，不下真實訂單，僅追蹤損益
- **Bot**：Telegram 機器人主程式（`telegram_query_bot.js`）
- **Admin_UI**：管理者在 Telegram 中看到的鍵盤介面
- **chatId**：Telegram 用戶的唯一識別碼（字串格式）
- **Credentials**：用戶的 BingX API Key 與 API Secret

---

## 需求

### 需求 1：全域狀態檔案結構

**User Story：** 身為系統管理員，我希望全域共用資料集中存放於獨立檔案，以便多用戶共享且不與個人資料混淆。

#### 驗收標準

1. THE State_Manager SHALL 將 `admins`、`whitelist`、`rankSnapshot`、`rankBestRank`、`scanCooldown`、`isRankRunning`、`lastUpdateId` 存放於 `data/state_global.json`
2. WHEN `data/state_global.json` 不存在時，THE State_Manager SHALL 建立包含預設空值的 `state_global.json`
3. IF `data/state_global.json` 讀取失敗，THEN THE State_Manager SHALL 記錄錯誤並回傳預設全域狀態物件，不中斷程式執行
4. THE State_Manager SHALL 提供 `loadGlobalState()` 函式，回傳全域狀態物件
5. THE State_Manager SHALL 提供 `saveGlobalState(state)` 函式，將全域狀態寫入 `data/state_global.json`

---

### 需求 2：用戶狀態檔案結構

**User Story：** 身為用戶，我希望我的持倉、歷史紀錄與 API 憑證存放於獨立檔案，以便資料隔離且不影響其他用戶。

#### 驗收標準

1. THE State_Manager SHALL 將每位用戶的 `activeStrategies`、`history`、`subscriptions`、`credentials`、`waitingState` 存放於 `data/state_{chatId}.json`
2. WHEN `data/state_{chatId}.json` 不存在時，THE State_Manager SHALL 建立包含預設空值的用戶狀態檔案
3. IF `data/state_{chatId}.json` 讀取失敗，THEN THE State_Manager SHALL 記錄錯誤並回傳該用戶的預設狀態物件，不中斷程式執行
4. THE State_Manager SHALL 提供 `loadUserState(chatId)` 函式，回傳指定用戶的狀態物件
5. THE State_Manager SHALL 提供 `saveUserState(chatId, state)` 函式，將用戶狀態寫入對應檔案
6. THE State_Manager SHALL 提供 `getAllUserChatIds()` 函式，掃描 `data/` 目錄並回傳所有 `state_{chatId}.json` 對應的 chatId 陣列

---

### 需求 3：原子寫入保護

**User Story：** 身為系統管理員，我希望狀態檔案寫入具備原子性，以防止程式崩潰時產生損壞的 JSON 檔案。

#### 驗收標準

1. WHEN `saveUserState(chatId, state)` 被呼叫時，THE State_Manager SHALL 先將資料寫入暫存檔 `state_{chatId}.json.tmp`，再以 rename 操作取代目標檔案
2. WHEN `saveGlobalState(state)` 被呼叫時，THE State_Manager SHALL 先將資料寫入暫存檔 `state_global.json.tmp`，再以 rename 操作取代目標檔案
3. IF rename 操作失敗，THEN THE State_Manager SHALL 記錄錯誤並保留暫存檔以供人工復原

---

### 需求 4：舊資料遷移

**User Story：** 身為系統管理員，我希望現有的 `bot_state.json` 能自動遷移至新架構，以便不遺失歷史資料。

#### 驗收標準

1. THE State_Manager SHALL 提供 `migrateFromLegacy()` 函式，讀取 `data/bot_state.json` 並執行遷移
2. WHEN `migrateFromLegacy()` 執行時，THE State_Manager SHALL 將全域欄位（`admins`、`whitelist`、`rankSnapshot`、`rankBestRank`、`scanCooldown`、`lastUpdateId`）寫入 `state_global.json`
3. WHEN `migrateFromLegacy()` 執行時，THE State_Manager SHALL 依 chatId 分組 `activeStrategies`，並將各用戶資料寫入對應的 `state_{chatId}.json`
4. WHEN `migrateFromLegacy()` 執行完成後，THE State_Manager SHALL 將原始 `bot_state.json` 重新命名為 `bot_state.json.bak`
5. IF `data/bot_state.json` 不存在，THEN THE State_Manager SHALL 跳過遷移並記錄提示訊息
6. FOR ALL chatId 存在於舊 `activeStrategies` 中，遷移後 `loadUserState(chatId).activeStrategies` SHALL 包含相同的策略資料（遷移完整性）

---

### 需求 5：Loop F 模擬倉連動

**User Story：** 身為有設定 API key 的用戶，我希望 Loop F 偵測到進場信號時自動為我開模擬倉，以便即時追蹤信號損益。

#### 驗收標準

1. WHEN Loop_F 偵測到符合進場條件的信號時，THE Bot SHALL 推送訊息至頻道 `-5264873133`
2. WHEN Loop_F 偵測到符合進場條件的信號時，THE Bot SHALL 遍歷所有 `getAllUserChatIds()` 回傳的 chatId
3. WHEN 遍歷用戶時，IF 用戶的 `credentials.apiKey` 為空字串或未設定，THEN THE Bot SHALL 跳過該用戶，不開模擬倉
4. WHEN 遍歷用戶時，IF 用戶的 `credentials.apiKey` 有值，THEN THE Bot SHALL 在該用戶的 `activeStrategies` 中建立 `isPaper: true` 的模擬倉記錄
5. WHEN 模擬倉建立後，THE Bot SHALL 呼叫 `saveUserState(chatId, state)` 將記錄持久化
6. IF 該用戶已有相同幣種的持倉（`activeStrategies` 中存在相同 symbol），THEN THE Bot SHALL 跳過，不重複開倉
7. WHILE 用戶刪除 API key 後，THE Bot SHALL 停止為該用戶開新模擬倉，但現有模擬倉繼續由 Loop C 監控至出場

---

### 需求 6：管理者介面按鈕更名

**User Story：** 身為用戶，我希望管理者介面的 API key 設定按鈕能清楚顯示連接狀態，以便一眼判斷是否已連動模擬倉。

#### 驗收標準

1. WHEN 用戶尚未設定 API key 時，THE Admin_UI SHALL 顯示按鈕文字為 `🔗 連動模擬倉(未連接)`
2. WHEN 用戶已設定 API key 時，THE Admin_UI SHALL 顯示按鈕文字為 `✅ 連動模擬倉(已連接)`
3. THE Admin_UI SHALL 根據當前用戶的 `credentials.apiKey` 動態決定按鈕文字，而非使用靜態字串
4. WHEN 用戶點擊「連動模擬倉」按鈕時，THE Bot SHALL 觸發與原「設定 API Key」相同的 API key 輸入流程

---

### 需求 7：API Key 設定流程按用戶隔離

**User Story：** 身為用戶，我希望我設定的 API key 只影響我自己的帳號，不影響其他用戶。

#### 驗收標準

1. WHEN 用戶完成 API key 驗證後，THE Bot SHALL 將 `apiKey` 與 `apiSecret` 儲存至該用戶的 `state_{chatId}.json` 的 `credentials` 欄位
2. THE Bot SHALL 不再使用全域共用的 `bingx_credentials.json` 儲存用戶 API key
3. WHEN `loadUserState(chatId)` 被呼叫時，THE State_Manager SHALL 回傳包含 `credentials.apiKey`、`credentials.apiSecret`、`credentials.paperEnabled` 欄位的物件
4. IF 用戶的 `credentials.apiKey` 為空，THEN THE Bot SHALL 在 API key 相關操作中顯示「尚未設定」提示，而非嘗試讀取全域憑證檔案

---

### 需求 8：Loop C 出場監控按用戶隔離

**User Story：** 身為用戶，我希望 Loop C 只監控屬於我的持倉，以便出場通知準確發送給正確的用戶。

#### 驗收標準

1. WHEN Loop C 執行時，THE Bot SHALL 遍歷所有用戶的 `state_{chatId}.json`，分別處理各用戶的 `activeStrategies`
2. WHEN 模擬倉出場條件成立時，THE Bot SHALL 將出場通知發送至對應的 `chatId`
3. WHEN 模擬倉出場後，THE Bot SHALL 將出場記錄寫入該用戶的 `history`，並呼叫 `saveUserState(chatId, state)` 持久化
4. IF 某用戶的狀態檔案讀取失敗，THEN THE Bot SHALL 記錄錯誤並繼續處理其他用戶，不中斷整體 Loop C 執行
