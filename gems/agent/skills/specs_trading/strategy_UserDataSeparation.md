# 用戶資料分離架構 (User Data Separation)

> 版本：v1.0 | 2026-04

---

## 目標

將所有用戶資料從單一 `bot_state.json` 拆分為每用戶獨立檔案，並實作 Loop F 信號自動開模擬倉（需用戶設定 API key 才啟用）。

---

## 檔案架構

```
data/
  state_global.json          # 全域共用資料
  state_{chatId}.json        # 每個用戶獨立資料
```

### state_global.json 結構

```json
{
  "admins": ["931709772"],
  "whitelist": [],
  "rankSnapshot": {},
  "rankBestRank": {},
  "scanCooldown": {},
  "isRankRunning": false,
  "lastUpdateId": 0
}
```

### state_{chatId}.json 結構

```json
{
  "chatId": "931709772",
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

---

## 模擬倉連動規則

| 條件 | 行為 |
|------|------|
| `credentials.apiKey` 為空 | 不開模擬倉，只收頻道訊息 |
| `credentials.apiKey` 有值 | Loop F 信號自動開模擬倉 |
| 用戶刪除 API key | 停止新開模擬倉，現有倉位繼續監控至出場 |

---

## 按鈕文字規則

- 未設定 API key：`🔗 連動模擬倉(未連接)`
- 已設定 API key：`✅ 連動模擬倉(已連接)`

---

## Loop F 信號推送流程（更新後）

```
Loop F 偵測到進場信號
    ↓
推送訊息到頻道 -5264873133
    ↓
遍歷所有已知用戶（state_{chatId}.json 存在的）
    ↓
檢查 credentials.apiKey 是否有值
    ├── 有值 → 開模擬倉，記錄到該用戶的 state_{chatId}.json
    └── 無值 → 跳過，不開倉
```

---

## 資料讀寫規範

### loadUserState(chatId)
- 讀取 `data/state_{chatId}.json`
- 不存在則建立預設結構
- 回傳用戶 state 物件

### saveUserState(chatId, state)
- 寫入 `data/state_{chatId}.json`
- 原子寫入（先寫暫存檔再 rename）

### loadGlobalState()
- 讀取 `data/state_global.json`
- 不存在則建立預設結構

### saveGlobalState(state)
- 寫入 `data/state_global.json`

### getAllUserChatIds()
- 掃描 `data/` 目錄，找出所有 `state_{chatId}.json` 的 chatId
- 用於 Loop F 遍歷所有用戶

---

## 遷移規則（舊 bot_state.json → 新架構）

1. 讀取舊 `bot_state.json`
2. 全域資料寫入 `state_global.json`
3. 依 chatId 分組，各自寫入 `state_{chatId}.json`
4. 舊檔案保留為 `bot_state.json.bak`

---

## 觸發條件

| 情境 | 應參照 |
|------|--------|
| 修改 loadState / saveState | 本文件 |
| 修改 Loop F 開倉邏輯 | 本文件 + strategy_Entry.md |
| 修改 API key 設定流程 | 本文件 |
| 新增用戶相關功能 | 本文件 |
