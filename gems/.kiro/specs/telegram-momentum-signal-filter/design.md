# Design Document

## Feature: telegram-momentum-signal-filter

---

## Overview

本設計針對 `src/scripts/telegram_query_bot.js` 中的 `loopRankMonitor`（Loop F）函數進行精準修改。

Loop F 每 30 秒執行一次，從 BingX 抓取漲幅排行榜，偵測排名爬升的幣種，並對候選幣種執行動能分析（Stage 2 指標共振 + 15m 形態評分），若通過則推送進場訊號給所有 Admin。

**目前問題：**
1. 排名過濾條件 `cur.rank <= 15` 過嚴，有效信號被過濾
2. 發現候選幣種時立即推送「正在分析進場條件...」預告訊息，造成雜訊
3. 分析完畢後用 `editMessage` 更新通知，邏輯複雜且依賴預告訊息
4. 進場訊息缺少 TP1/TP2/TP3 目標價格與進場建議摘要

**優化目標：**
- 移除 `cur.rank <= 15` 限制，改為只要排名爬升 ≥ 2 名次即觸發
- 動能未達標時完全靜默（不傳送任何訊息）
- 達成進場信號時顯示完整進場建議（含 TP1/TP2/TP3、止損、進場理由）
- 移除「分析中」預告訊息與 `editMessage` 邏輯

---

## Architecture

修改範圍僅限於 `loopRankMonitor` 函數內部，不影響其他 Loop 或模組。

```
loopRankMonitor()
  │
  ├─ fetchBingxTickers()          ← 不變
  ├─ 排名比對（移除 rank <= 15）   ← 修改
  ├─ [移除] 推送預告訊息           ← 刪除
  ├─ secondStageFilter()          ← 不變
  ├─ fetchKlines() + detectBreakout() ← 不變
  ├─ [移除] editMessage 邏輯       ← 刪除
  └─ 推送完整進場訊息（含 TP）     ← 修改
```

整體流程保持兩階段設計：
- **Stage 1（快速過濾）**：ticker 排名比對，無 API 密集呼叫
- **Stage 2（深度分析）**：K 線 + 指標，只對通過 Stage 1 的候選幣種執行

---

## Components and Interfaces

### 修改的函數：`loopRankMonitor`

**輸入（不變）：**
- `rankSnapshot`：上一輪排名快照 `{ base: { rank, change, price } }`
- `rankBestRank`：各幣歷史最佳排名 `{ base: bestRank }`
- `botState.activeStrategies`：現有持倉，用於跳過已持倉幣種
- `botState.admins`：Admin chatId 列表

**候選條件（修改）：**

| 條件 | 舊邏輯 | 新邏輯 |
|------|--------|--------|
| 排名上限 | `cur.rank <= 15` | 移除（無上限） |
| 排名爬升 | `rankImproved >= 2` | 不變 |
| 歷史最佳 | `cur.rank < best` | 不變 |
| 漲幅門檻 | `cur.change >= 3` | 不變 |

**訊息邏輯（修改）：**

| 行為 | 舊邏輯 | 新邏輯 |
|------|--------|--------|
| 發現候選時 | 推送「正在分析...」預告 | 靜默 |
| 分析未達標 | editMessage 更新為「條件未達標」 | 靜默 |
| 分析達標 | 推送進場訊息（無 TP） | 推送完整進場訊息（含 TP1/TP2/TP3 + 進場建議） |
| 分析錯誤 | console.error（不變） | console.error（不變） |

### 進場訊息格式（新）

```
{emoji}📈 排行榜動能進場 {base}
排名 {rank} (+{rankImproved}名次)  漲幅 +{change}%
現價 `{price}`  槓桿 x{leverage}
SL `{sl}` ({slPct}%)
TP1 `{tp1}` · TP2 `{tp2}` · TP3 `{tp3}`
📋 進場建議：做多 {base}，目標 TP1/TP2/TP3
形態：{reasons}
```

---

## Data Models

### rankSnapshot（不變）

```js
// { [base: string]: { rank: number, change: number, price: number } }
rankSnapshot = {
  'BTC': { rank: 1, change: 5.2, price: 67000 },
  'ETH': { rank: 3, change: 3.8, price: 3500 },
}
```

### rankBestRank（不變）

```js
// { [base: string]: number }  數字越小越好
rankBestRank = {
  'BTC': 1,
  'ETH': 2,
}
```

### Candidate（不變）

```js
{
  rank: number,        // 目前排名
  base: string,        // 幣種（不含 USDT）
  price: number,       // 現價
  change: number,      // 24h 漲幅 %
  symbol: string,      // BingX symbol（含 -USDT）
  prevRank: number,    // 上一輪排名
  rankImproved: number // 爬升名次數
}
```

### EntrySignal（來自 detectBreakout，不變）

```js
{
  pass: boolean,
  price: number,
  sl: number,
  tp1: number,
  tp2: number,
  tp3: number,
  strength: 'HIGH' | 'MED' | 'LOW',
  reasons: string[]
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: 排名爬升門檻無上限

*For any* 幣種，只要其排名爬升 ≥ 2 名次、漲幅 ≥ 3%、且排名優於歷史最佳，就應被加入候選列表，無論其目前排名數字為何（不受前 15 名限制）。

**Validates: Requirements 1.1, 1.2**

### Property 2: 動能未達標時靜默

*For any* 候選列表，若所有候選幣種的動能分析均未通過（`secondStageFilter.pass === false` 或 `detectBreakout.pass === false`），則不應傳送任何訊息給 Admin。

**Validates: Requirements 2.1, 2.2**

### Property 3: 進場訊息包含完整 TP 資訊

*For any* 通過動能分析的進場信號，傳送給 Admin 的訊息字串應包含 TP1、TP2、TP3 的目標價格與「進場建議」摘要文字。

**Validates: Requirements 3.1, 3.2, 3.3**

### Property 4: 已持倉幣種跳過

*For any* 候選幣種，若 `activeStrategies` 中已存在該幣種的持倉，則不應傳送進場訊息。

**Validates: Requirements 3.4**

### Property 5: 保留條件的不變性

*For any* 執行輪次，候選過濾條件中「排名爬升 ≥ 2」、「優於歷史最佳排名」、「漲幅 ≥ 3%」三個條件應同時成立，缺一不可。

**Validates: Requirements 1.3, 1.4**

---

## Error Handling

| 情境 | 處理方式 |
|------|----------|
| `fetchBingxTickers` 回傳空陣列 | 提前 return，不執行後續邏輯 |
| `secondStageFilter` timeout / 錯誤 | `console.error` 記錄，跳過該幣種，不傳訊息 |
| `fetchKlines` timeout / 錯誤 | `console.error` 記錄，跳過該幣種，不傳訊息 |
| `detectBreakout` 回傳 null 或 pass: false | 跳過該幣種，不傳訊息 |
| `sendMessage` 失敗 | 現有 `sendMessage` 已有 try/catch，不影響主流程 |
| `loopRankMonitor` 整體錯誤 | 外層 try/catch 記錄至 console，`isRankRunning = false` 確保下輪可執行 |

---

## Testing Strategy

### 單元測試（Unit Tests）

針對 `loopRankMonitor` 的核心邏輯，使用 mock 隔離外部依賴：

1. **候選過濾邏輯測試**
   - 驗證移除 `rank <= 15` 後，排名 20 的幣種若爬升 ≥ 2 名次仍能進入候選
   - 驗證排名爬升 < 2 的幣種不進入候選
   - 驗證漲幅 < 3% 的幣種不進入候選
   - 驗證排名未優於歷史最佳的幣種不進入候選

2. **靜默邏輯測試**
   - mock `secondStageFilter` 回傳 `{ pass: false }`，驗證 `sendMessage` 未被呼叫
   - mock `detectBreakout` 回傳 `{ pass: false }`，驗證 `sendMessage` 未被呼叫
   - 驗證不存在任何 `editMessage` 呼叫

3. **進場訊息格式測試**
   - mock 所有分析函數回傳通過，驗證訊息包含 TP1/TP2/TP3 價格
   - 驗證訊息包含「進場建議：做多」文字
   - 驗證訊息包含 reasons 陣列內容

4. **已持倉跳過測試**
   - 設定 `activeStrategies` 含目標幣種，驗證 `sendMessage` 未被呼叫

### 屬性測試（Property-Based Tests）

使用 `fast-check`（JavaScript PBT 函式庫）進行屬性驗證，每個屬性測試執行 ≥ 100 次迭代。

**Property 1 測試：排名爬升無上限**
```
// Feature: telegram-momentum-signal-filter, Property 1: 排名爬升門檻無上限
// For any rank > 15, if rankImproved >= 2 and change >= 3 and rank < bestRank,
// the coin should be in candidates
fc.property(
  fc.integer({ min: 16, max: 100 }),  // rank > 15
  fc.integer({ min: 2, max: 10 }),    // rankImproved
  fc.float({ min: 3.0, max: 50.0 }),  // change
  (rank, rankImproved, change) => {
    const prevRank = rank + rankImproved;
    const bestRank = prevRank + 1;
    const result = filterCandidates([{ rank, base: 'TEST', change }], { TEST: { rank: prevRank } }, { TEST: bestRank });
    return result.length === 1;
  }
)
```

**Property 2 測試：動能未達標靜默**
```
// Feature: telegram-momentum-signal-filter, Property 2: 動能未達標時靜默
// For any candidates list where all stage2/breakout filters fail,
// sendMessage should never be called
fc.property(
  fc.array(fc.record({ base: fc.string(), rank: fc.integer() }), { minLength: 1 }),
  (candidates) => {
    const mockSendMessage = jest.fn();
    // mock secondStageFilter to always return { pass: false }
    // run loopRankMonitor logic
    expect(mockSendMessage).not.toHaveBeenCalled();
  }
)
```

**Property 3 測試：進場訊息包含完整 TP**
```
// Feature: telegram-momentum-signal-filter, Property 3: 進場訊息包含完整 TP 資訊
// For any valid entry signal with tp1/tp2/tp3, the message string should contain all three
fc.property(
  fc.float({ min: 0.001, max: 100000 }),  // price
  fc.float({ min: 0.001, max: 0.1 }),     // slPct
  (price, slPct) => {
    const sl = price * (1 - slPct);
    const risk = price - sl;
    const tp1 = price + risk * 1.0;
    const tp2 = price + risk * 1.618;
    const tp3 = price + risk * 2.618;
    const msg = buildEntryMessage({ price, sl, tp1, tp2, tp3, strength: 'HIGH', reasons: ['test'] }, { rank: 5, rankImproved: 3, change: 5.0, base: 'BTC' }, 10);
    return msg.includes('TP1') && msg.includes('TP2') && msg.includes('TP3') && msg.includes('進場建議');
  }
)
```

**測試設定：**
- 函式庫：`fast-check`
- 每個屬性測試最少 100 次迭代（`fc.configureGlobal({ numRuns: 100 })`）
- 外部依賴（`fetchBingxTickers`、`secondStageFilter`、`fetchKlines`、`detectBreakout`）全部 mock
