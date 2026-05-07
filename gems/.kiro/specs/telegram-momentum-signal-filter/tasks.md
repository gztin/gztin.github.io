# Implementation Tasks

## Feature: telegram-momentum-signal-filter

---

- [x] 1. 移除排名前 15 限制
  - [x] 1.1 在 `loopRankMonitor` 的候選過濾條件中，移除 `cur.rank <= 15` 判斷式
  - [x] 1.2 確認保留 `rankImproved >= 2`、`cur.rank < best`、`cur.change >= 3` 三個條件不變
  - File: `src/scripts/telegram_query_bot.js`

- [x] 2. 移除預告訊息與 editMessage 邏輯
  - [x] 2.1 刪除推送「📡 排行榜動能偵測 ... 正在分析進場條件...」的 sendMessage 呼叫區塊
  - [x] 2.2 刪除 `notifMsgIds` 變數宣告與相關賦值邏輯
  - [x] 2.3 刪除分析完畢後的 `editMessage` 更新區塊（`anySignal` 判斷與 editMessage 呼叫）
  - [x] 2.4 刪除 `anySignal` 變數（若已無其他用途）
  - File: `src/scripts/telegram_query_bot.js`

- [x] 3. 更新進場訊息格式，加入 TP1/TP2/TP3 與進場建議
  - [x] 3.1 在進場訊息中加入 `TP1 \`{tp1}\` · TP2 \`{tp2}\` · TP3 \`{tp3}\`` 一行
  - [x] 3.2 在進場訊息中加入 `📋 進場建議：做多 {base}，目標 TP1/TP2/TP3` 一行
  - File: `src/scripts/telegram_query_bot.js`

- [x] 4. 驗證修改正確性
  - [x] 4.1 確認 `loopRankMonitor` 函數中不再有任何 `editMessage` 呼叫
  - [x] 4.2 確認候選過濾邏輯中不再有 `rank <= 15` 條件
  - [x] 4.3 確認進場訊息字串包含 TP1、TP2、TP3 與「進場建議」文字
  - File: `src/scripts/telegram_query_bot.js`
