# 設計文件：用戶資料分離 (User Data Separation)

## 概覽

本功能將現有的單一 `bot_state.json` 重構為多檔案架構：
- `data/state_global.json`：全域共用資料（管理員名單、白名單、排行榜快照等）
- `data/state_{chatId}.json`：每位用戶的獨立資料（持倉、歷史、API 憑證等）

同時更新 Loop F（排行榜監控）以遍歷所有用戶並按 API key 決定是否開模擬倉，更新 Loop C（出場監控）以按用戶隔離處理，並更新管理者介面按鈕文字以動態反映連接狀態。

---

## 架構

```
telegram_query_bot.js
    │
    ├── StateManager（新模組 src/scripts/state_manager.js）
    │       ├── loadGlobalState()
    │       ├── saveGlobalState(state)
    │       ├── loadUserState(chatId)
    │       ├── saveUserState(chatId, state)
    │       ├── getAllUserChatIds()
    │       └── migrateFromLegacy()
    │
    ├── loopRankMonitor()（Loop F）
    │       └── 遍歷 getAllUserChatIds()，按 credentials.apiKey 開模擬倉
    │
    ├── loopExit()（Loop C）
    │       └── 遍歷 getAllUserChatIds()，按用戶處理 activeStrategies
    │
    └── KEYBOARDS.ADMIN(chatId, hasApiKey)
            └── 動態按鈕文字
```

### 資料流

```
Bot 啟動
  └─ loadGlobalState() → globalState（記憶體）
  └─ 各用戶資料按需 loadUserState(chatId)

Loop F 觸發
  └─ 推送頻道訊息
  └─ getAllUserChatIds()
       └─ for each chatId:
            loadUserState(chatId)
            if credentials.apiKey → 建立模擬倉
            saveUserState(chatId, state)

Loop C 觸發
  └─ getAllUserChatIds()
       └─ for each chatId:
            loadUserState(chatId)
            處理 activeStrategies
            saveUserState(chatId, state)
```

---

## 元件與介面

### StateManager（`src/scripts/state_manager.js`）

```javascript
// 全域狀態
export function loadGlobalState(): GlobalState
export function saveGlobalState(state: GlobalState): void

// 用戶狀態
export function loadUserState(chatId: string): UserState
export function saveUserState(chatId: string, state: UserState): void
export function getAllUserChatIds(): string[]

// 遷移
export function migrateFromLegacy(): void
```

### KEYBOARDS.ADMIN（`src/scripts/keyboards.js`）

```javascript
// 新增 hasApiKey 參數，動態決定按鈕文字
ADMIN: (hasApiKey = false) => ({
    keyboard: [
        [{ text: hasApiKey ? '✅ 連動模擬倉(已連接)' : '🔗 連動模擬倉(未連接)' }],
        // ...
    ]
})
```

呼叫端需傳入當前用戶的 `credentials.apiKey` 是否有值：
```javascript
const userState = loadUserState(chatId);
const hasApiKey = !!userState.credentials?.apiKey;
KEYBOARDS.ADMIN(hasApiKey)
```

---

## 資料模型

### GlobalState

```typescript
interface GlobalState {
    admins: string[];
    whitelist: string[];
    rankSnapshot: Record<string, { rank: number; change: number; price: number }>;
    rankBestRank: Record<string, number>;
    scanCooldown: Record<string, number>;
    isRankRunning: boolean;
    lastUpdateId: number;
}
```

預設值：
```json
{
    "admins": [],
    "whitelist": [],
    "rankSnapshot": {},
    "rankBestRank": {},
    "scanCooldown": {},
    "isRankRunning": false,
    "lastUpdateId": 0
}
```

### UserState

```typescript
interface Credentials {
    apiKey: string;
    apiSecret: string;
    paperEnabled: boolean;
}

interface UserState {
    chatId: string;
    activeStrategies: Record<string, Strategy>;
    history: HistoryEntry[];
    subscriptions: Record<string, any>;
    credentials: Credentials;
    waitingState: Record<string, any>;
}
```

預設值：
```json
{
    "chatId": "",
    "activeStrategies": {},
    "history": [],
    "subscriptions": {},
    "credentials": {
        "apiKey": "",
        "apiSecret": "",
        "paperEnabled": false
    },
    "waitingState": {}
}
```

### 檔案路徑規則

| 資料類型 | 路徑 |
|---------|------|
| 全域狀態 | `data/state_global.json` |
| 用戶狀態 | `data/state_{chatId}.json` |
| 全域暫存 | `data/state_global.json.tmp` |
| 用戶暫存 | `data/state_{chatId}.json.tmp` |
| 舊檔備份 | `data/bot_state.json.bak` |

---

## 正確性屬性

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 全域狀態 round-trip

*For any* 合法的 GlobalState 物件，呼叫 `saveGlobalState(state)` 後再呼叫 `loadGlobalState()`，應回傳與原始物件深度相等的物件。

**Validates: Requirements 1.1, 1.4, 1.5**

---

### Property 2: 用戶狀態 round-trip

*For any* 合法的 chatId 字串與 UserState 物件，呼叫 `saveUserState(chatId, state)` 後再呼叫 `loadUserState(chatId)`，應回傳與原始物件深度相等的物件。

**Validates: Requirements 2.1, 2.4, 2.5**

---

### Property 3: getAllUserChatIds 包含所有已儲存用戶

*For any* 一組 chatId 集合，對每個 chatId 呼叫 `saveUserState` 後，`getAllUserChatIds()` 的回傳陣列應包含該集合中的所有 chatId。

**Validates: Requirements 2.6**

---

### Property 4: 原子寫入後無暫存檔殘留

*For any* 合法的狀態物件，呼叫 `saveUserState` 或 `saveGlobalState` 完成後，對應的 `.tmp` 暫存檔不應存在於 `data/` 目錄中。

**Validates: Requirements 3.1, 3.2**

---

### Property 5: 遷移完整性

*For any* 合法的舊格式 `bot_state.json`（包含任意 chatId 的 `activeStrategies`），呼叫 `migrateFromLegacy()` 後，對每個原始 chatId 呼叫 `loadUserState(chatId).activeStrategies`，應包含與舊檔案中相同的策略資料。

**Validates: Requirements 4.2, 4.3, 4.6**

---

### Property 6: Loop F 按 apiKey 決定是否開倉

*For any* 用戶集合，Loop F 信號觸發後：
- 對 `credentials.apiKey` 為空字串的用戶，其 `activeStrategies` 不應新增任何記錄
- 對 `credentials.apiKey` 有值的用戶，其 `activeStrategies` 應新增 `isPaper: true` 的模擬倉記錄

**Validates: Requirements 5.2, 5.3, 5.4, 5.7**

---

### Property 7: Loop F 不重複開倉

*For any* 已有相同 symbol 持倉的用戶，Loop F 信號觸發後，該用戶的 `activeStrategies` 中相同 symbol 的記錄數量不應增加。

**Validates: Requirements 5.6**

---

### Property 8: 按鈕文字動態反映 apiKey 狀態

*For any* 用戶，`KEYBOARDS.ADMIN(hasApiKey)` 的回傳鍵盤中：
- `hasApiKey = false` 時，應包含文字 `🔗 連動模擬倉(未連接)`
- `hasApiKey = true` 時，應包含文字 `✅ 連動模擬倉(已連接)`

**Validates: Requirements 6.1, 6.2, 6.3**

---

### Property 9: API key 按用戶隔離儲存

*For any* chatId 和 apiKey 字串，儲存後呼叫 `loadUserState(chatId).credentials.apiKey`，應回傳相同的 apiKey 值。

**Validates: Requirements 7.1, 7.3**

---

### Property 10: Loop C 出場記錄 round-trip

*For any* 用戶的模擬倉出場事件，出場後呼叫 `loadUserState(chatId).history`，應包含該出場記錄（含 symbol、exitPrice、reason 等欄位）。

**Validates: Requirements 8.2, 8.3**

---

## 錯誤處理

| 情境 | 處理方式 |
|------|---------|
| `state_global.json` 不存在 | 建立並回傳預設 GlobalState |
| `state_{chatId}.json` 不存在 | 建立並回傳預設 UserState |
| JSON 解析失敗（損壞檔案） | 記錄 `console.error`，回傳預設狀態，不拋出例外 |
| `rename` 操作失敗 | 記錄 `console.error`，保留 `.tmp` 暫存檔供人工復原 |
| `bot_state.json` 不存在（遷移時） | 記錄提示訊息，跳過遷移，不拋出例外 |
| Loop C 某用戶狀態讀取失敗 | 記錄錯誤，`continue` 繼續處理下一個用戶 |
| Loop F 某用戶狀態讀取失敗 | 記錄錯誤，`continue` 繼續處理下一個用戶 |

---

## 測試策略

### 雙軌測試方法

本功能採用單元測試與屬性測試並行的策略：
- **單元測試**：驗證具體範例、邊界條件、錯誤處理
- **屬性測試**：驗證對所有合法輸入均成立的普遍性質

### 單元測試重點

- `loadGlobalState()` 在檔案不存在時回傳預設值（需求 1.2）
- `loadUserState(chatId)` 在檔案不存在時回傳預設值（需求 2.2）
- `migrateFromLegacy()` 在 `bot_state.json` 不存在時不拋出例外（需求 4.5）
- `migrateFromLegacy()` 完成後 `bot_state.json.bak` 存在（需求 4.4）
- 損壞 JSON 檔案時 `loadGlobalState()` / `loadUserState()` 不拋出例外（需求 1.3, 2.3）
- Loop C 某用戶狀態損壞時其他用戶仍被處理（需求 8.4）

### 屬性測試重點

使用 [fast-check](https://github.com/dubzzz/fast-check)（JavaScript PBT 函式庫）。

每個屬性測試最少執行 **100 次**迭代。

每個屬性測試需加上標籤註解：
```
// Feature: user-data-separation, Property {N}: {property_text}
```

| 屬性 | 測試方式 | 生成器 |
|------|---------|--------|
| Property 1 | `fc.record(...)` 生成任意 GlobalState，save → load 比對 | `fc.string()`, `fc.array()` |
| Property 2 | `fc.string()` 生成 chatId，`fc.record(...)` 生成 UserState，save → load 比對 | `fc.string()`, `fc.record()` |
| Property 3 | `fc.array(fc.string())` 生成 chatId 集合，全部 save 後確認 getAllUserChatIds 包含所有 | `fc.array(fc.string())` |
| Property 4 | 任意狀態 save 後確認 `.tmp` 不存在 | `fc.record()` |
| Property 5 | `fc.record(...)` 生成舊格式狀態，遷移後逐一比對 | `fc.record()` |
| Property 6 | `fc.array(fc.record({apiKey: fc.string()}))` 生成用戶集合，觸發 Loop F 後驗證開倉邏輯 | `fc.record()` |
| Property 7 | 生成已有持倉的用戶，觸發 Loop F 後確認倉位數量不變 | `fc.record()` |
| Property 8 | `fc.boolean()` 生成 hasApiKey，確認按鈕文字正確 | `fc.boolean()` |
| Property 9 | `fc.string()` 生成 chatId 和 apiKey，save → load 比對 | `fc.string()` |
| Property 10 | 生成任意出場事件，觸發出場後確認 history 包含記錄 | `fc.record()` |
