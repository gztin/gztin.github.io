# Requirements Document

## Introduction

本功能針對 Telegram 查詢機器人（`telegram_query_bot.js`）的 Loop F 排行榜動能偵測邏輯進行優化。

目前 Loop F 的問題：
1. 排名限制過嚴（前 15 名 + 歷史最佳限制），導致有效信號被過濾
2. 動能分析未達標時仍會傳送「分析中」通知訊息，造成雜訊
3. 達成進場信號時，訊息缺乏簡要說明（進場理由摘要）

優化目標：
- 取消排名前 15 限制，改為只要排名爬升 ≥ 2 名次即觸發動能分析
- 動能分析未達標時，完全不傳送任何訊息（靜默處理）
- 達成進場信號時，顯示進場建議與簡要說明

## Glossary

- **Loop_F**: 排行榜排名監控迴圈，每 30 秒執行一次，掃描 BingX 漲幅排行榜
- **Rank_Monitor**: Loop F 的核心邏輯，負責偵測排名爬升並觸發動能分析
- **Momentum_Analyzer**: 動能分析模組，包含 `secondStageFilter`（Stage 2 指標共振）與 `detectBreakout`（15m 形態評分）
- **Entry_Signal**: 進場信號，當 Stage 2 與 15m 形態評分均通過時產生
- **rankSnapshot**: 記錄上一輪各幣種排名的快照物件
- **rankBestRank**: 記錄各幣種歷史最佳排名的物件
- **Candidate**: 符合排名爬升條件、待進行動能分析的幣種
- **Admin**: 機器人管理員，接收進場信號通知的 Telegram 用戶

---

## Requirements

### Requirement 1：取消排名上限限制

**User Story:** 作為交易員，我希望排行榜監控不受排名前 15 的限制，這樣才能捕捉到更多潛在的動能機會。

#### Acceptance Criteria

1. WHEN Loop_F 執行排名比對時，THE Rank_Monitor SHALL 對所有排名爬升 ≥ 2 名次的幣種觸發動能分析，不限制排名必須在前 15 名以內。
2. WHEN 一個幣種的排名爬升 ≥ 2 名次時，THE Rank_Monitor SHALL 將該幣種加入 Candidate 列表，無論其目前排名數字為何。
3. THE Rank_Monitor SHALL 保留「排名必須優於歷史最佳（rankBestRank）」的條件，以避免重複推送同一波動能。
4. THE Rank_Monitor SHALL 保留「漲幅 ≥ 3%」的前置過濾條件，以確保只分析具有實質漲幅的幣種。

---

### Requirement 2：動能未達標時靜默處理

**User Story:** 作為交易員，我希望只在有實際進場機會時才收到通知，避免收到無意義的「分析中」或「條件未達標」訊息。

#### Acceptance Criteria

1. WHEN Loop_F 偵測到 Candidate 列表不為空時，THE Rank_Monitor SHALL 不傳送任何「正在分析進場條件」的預告訊息。
2. WHEN Momentum_Analyzer 對所有 Candidate 完成分析且無任何 Entry_Signal 產生時，THE Rank_Monitor SHALL 不傳送任何訊息給 Admin。
3. IF Momentum_Analyzer 分析過程中發生 timeout 或錯誤，THEN THE Rank_Monitor SHALL 僅記錄錯誤至 console，不傳送錯誤通知給 Admin。
4. THE Rank_Monitor SHALL 移除分析完畢後更新通知訊息（editMessage）的邏輯，因為預告訊息已不再傳送。

---

### Requirement 3：達成進場信號時顯示進場建議與簡要說明

**User Story:** 作為交易員，我希望收到進場信號時，訊息包含清楚的進場建議與簡要說明，讓我能快速判斷是否執行。

#### Acceptance Criteria

1. WHEN Entry_Signal 產生時，THE Rank_Monitor SHALL 傳送包含以下資訊的進場訊息給所有 Admin：
   - 幣種名稱與信號強度 emoji（🔥 HIGH / ⭐ MED / 📌 LOW）
   - 目前排名與爬升名次
   - 漲幅百分比
   - 現價、槓桿倍數
   - 止損價格與止損距離百分比
   - 進場理由摘要（reasons 陣列，以「·」分隔）
2. WHEN Entry_Signal 產生時，THE Rank_Monitor SHALL 在進場訊息中加入一行「📋 進場建議：做多 [幣種]，目標 TP1/TP2/TP3」的簡要說明。
3. WHEN Entry_Signal 產生時，THE Rank_Monitor SHALL 在進場訊息中顯示 TP1、TP2、TP3 的目標價格。
4. IF 同一幣種已有持倉（activeStrategies 中存在），THEN THE Rank_Monitor SHALL 跳過該幣種，不傳送進場訊息。

---

### Requirement 4：訊號過濾邏輯完整性

**User Story:** 作為系統，我希望動能偵測的過濾邏輯保持一致，確保只有真正達標的信號才會觸發通知。

#### Acceptance Criteria

1. THE Momentum_Analyzer SHALL 依序執行 Stage 2 指標共振過濾（`secondStageFilter`）與 15m 形態評分（`detectBreakout`），兩者均通過才視為 Entry_Signal 成立。
2. WHEN `secondStageFilter` 回傳 `pass: false` 時，THE Momentum_Analyzer SHALL 跳過該 Candidate，不繼續執行 15m 形態分析。
3. WHEN `detectBreakout` 回傳 `pass: false` 或 `null` 時，THE Momentum_Analyzer SHALL 跳過該 Candidate，不產生 Entry_Signal。
4. THE Rank_Monitor SHALL 在每輪執行後更新 rankSnapshot 與 rankBestRank，確保下一輪比對使用最新排名資料。
