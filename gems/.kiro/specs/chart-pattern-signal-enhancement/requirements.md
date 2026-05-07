# 圖案識別增強進場邏輯 - Requirements 文檔

## Introduction

本功能旨在增強現有的交易策略判斷邏輯，通過在追蹤期間（/TRACE 後）內部定時分析多時框的技術圖案，識別 20+ 種經典圖案，並將圖案識別結果作為加分項整合到現有的 RSI 評分和多時框一致性系統中。圖案識別不向用戶展示，僅內部處理，用於提升進場信號的準確性和信心度。

## Glossary

- **Chart_Pattern**: 由連續 K 線組成的技術圖案，用於預測價格走勢方向和反轉點
- **Pattern_Confidence**: 圖案識別的信心度評分，範圍 0-100%，基於圖案完整性、K 線數量、形態規則性等因素
- **Minimum_Candles**: 圖案有效性的最低 K 線要求，設定為 5 根
- **Multi_Timeframe_Analysis**: 在多個時間框架（15m/30m/1h/4h/1d）上同時進行圖案識別
- **Pattern_Consistency**: 多時框上識別到相同方向圖案的一致性指標
- **Signal_Boost**: 圖案識別對現有 RSI 評分的加分效果，範圍 0-20 分
- **RSI_Score**: 基於 RSI 6-12-24 組合計算的市場強度評分（0-100），已在現有系統中實現
- **Whale_Confidence**: 基於 Binance 大戶持倉比例計算的市場信心指標（0-100），已在現有系統中實現
- **Tracking_Period**: 用戶執行 /TRACE 命令後的監控期間，系統定時分析市場數據
- **Bullish_Pattern**: 預示價格上升的圖案（W 底、三重底、頭肩底、上升三角、上升楔形、杯柄、旗形上升、錘子線、吞沒線等）
- **Bearish_Pattern**: 預示價格下降的圖案（頭肩頂、三重頂、下降三角、下降楔形、旗形下降、雙頂、流星線、烏雲蓋頂等）
- **Neutral_Pattern**: 不具有明確方向性的圖案（矩形、對稱三角、菱形等）
- **Pattern_Validator**: 驗證圖案是否滿足最低 K 線要求和形態規則的模塊
- **Pattern_Scorer**: 計算圖案信心度評分的模塊
- **Integration_Point**: 圖案識別結果與現有 RSI 評分系統的整合位置

## Requirements

### Requirement 1: 圖案識別基礎框架

**User Story:** 作為交易策略系統，我需要建立圖案識別的基礎框架，以便在追蹤期間內部分析技術圖案。

#### Acceptance Criteria

1. THE Pattern_Recognizer SHALL support recognition of 20+ classical chart patterns including bullish patterns (W-bottom, triple-bottom, head-and-shoulders-bottom, ascending-triangle, ascending-wedge, cup-and-handle, ascending-flag, hammer, bullish-engulfing), bearish patterns (head-and-shoulders-top, triple-top, descending-triangle, descending-wedge, descending-flag, double-top, shooting-star, dark-cloud-cover), and neutral patterns (rectangle, symmetric-triangle, diamond)

2. WHEN a pattern is identified, THE Pattern_Validator SHALL verify that the pattern contains at least 5 candles before marking it as valid

3. THE Pattern_Recognizer SHALL assign a confidence score (0-100%) to each identified pattern based on pattern completeness, candle count, and adherence to pattern rules

4. THE Pattern_Recognizer SHALL classify each pattern as either Bullish_Pattern, Bearish_Pattern, or Neutral_Pattern based on its directional bias

5. THE Pattern_Recognizer SHALL store pattern metadata including pattern name, confidence score, start candle index, end candle index, and direction for later retrieval

### Requirement 2: 多時框圖案分析

**User Story:** 作為交易策略系統，我需要在多個時間框架上同時進行圖案識別，以便評估圖案的多時框一致性。

#### Acceptance Criteria

1. WHEN the system performs pattern analysis, THE Pattern_Analyzer SHALL analyze patterns across multiple timeframes: 15m, 30m, 1h, 4h, and 1d

2. FOR EACH timeframe, THE Pattern_Analyzer SHALL identify all active patterns and store them with their respective timeframe context

3. THE Pattern_Analyzer SHALL calculate Pattern_Consistency by counting how many timeframes have identified patterns in the same direction (Bullish, Bearish, or Neutral)

4. WHEN Pattern_Consistency is calculated, THE Pattern_Analyzer SHALL return a consistency count (0-5) indicating how many timeframes align with the primary direction

5. THE Pattern_Analyzer SHALL prioritize 15m as the primary timeframe for signal generation, with 30m/1h/4h/1d as supporting confirmation timeframes

### Requirement 3: 圖案信心度評分系統

**User Story:** 作為交易策略系統，我需要為每個識別的圖案計算信心度評分，以便評估圖案的可靠性。

#### Acceptance Criteria

1. THE Pattern_Scorer SHALL calculate confidence score based on: (a) pattern completeness (how well the pattern matches the ideal form), (b) candle count (more candles = higher confidence up to a maximum), (c) pattern rule adherence (how strictly the pattern follows technical rules)

2. WHEN calculating confidence score, THE Pattern_Scorer SHALL use the formula: base_score = (completeness_factor × 0.4) + (candle_count_factor × 0.3) + (rule_adherence_factor × 0.3), where each factor is normalized to 0-100

3. THE Pattern_Scorer SHALL apply a minimum confidence threshold of 50% before considering a pattern as valid for signal boosting

4. WHEN a pattern has confidence score >= 50%, THE Pattern_Scorer SHALL mark it as High_Confidence_Pattern; when score is 30-49%, mark as Medium_Confidence_Pattern; when score < 30%, mark as Low_Confidence_Pattern

5. THE Pattern_Scorer SHALL store confidence score history for each pattern to track confidence evolution as new candles form

### Requirement 4: 圖案與 RSI 評分的整合

**User Story:** 作為交易策略系統，我需要將圖案識別結果整合到現有的 RSI 評分系統中，以便增強進場信號的準確性。

#### Acceptance Criteria

1. WHEN a high-confidence bullish pattern is identified on 15m, THE Signal_Booster SHALL add 5-10 points to the RSI_Score (depending on pattern confidence: 50-70% confidence = +5, 70-85% confidence = +7, 85%+ confidence = +10)

2. WHEN a high-confidence bearish pattern is identified on 15m, THE Signal_Booster SHALL subtract 5-10 points from the RSI_Score (using the same confidence-based scaling)

3. WHEN multiple patterns are identified across different timeframes in the same direction, THE Signal_Booster SHALL apply an additional consistency bonus of +3 to +5 points (based on how many timeframes align)

4. THE Signal_Booster SHALL ensure that the boosted RSI_Score remains within the valid range of 0-100 after applying pattern-based adjustments

5. THE Signal_Booster SHALL apply pattern-based boosting ONLY when the pattern confidence is >= 50% AND the pattern has been confirmed for at least 2 consecutive analysis cycles (to avoid false signals from newly formed patterns)

### Requirement 5: 追蹤期間的定時圖案分析

**User Story:** 作為交易策略系統，我需要在追蹤期間定時分析圖案，以便及時捕捉新形成的交易信號。

#### Acceptance Criteria

1. WHEN the user executes /TRACE command, THE Tracking_Monitor SHALL start a periodic analysis cycle that runs every 5 minutes during the tracking period

2. DURING each analysis cycle, THE Tracking_Monitor SHALL perform pattern analysis on all configured timeframes without blocking the real-time signal generation

3. WHEN a new high-confidence pattern is detected during tracking, THE Tracking_Monitor SHALL update the internal pattern state and recalculate the boosted RSI_Score for the next signal evaluation

4. THE Tracking_Monitor SHALL maintain a pattern history log that records all patterns detected during the tracking period, including detection time, pattern name, confidence score, and timeframe

5. WHEN the tracking period ends (user executes /STOP or timeout occurs), THE Tracking_Monitor SHALL preserve the pattern history for post-analysis review but stop performing new pattern analysis

### Requirement 6: 圖案識別不向用戶展示

**User Story:** 作為交易策略系統，我需要確保圖案識別結果僅內部處理，不向用戶展示，以保持系統簡潔性。

#### Acceptance Criteria

1. THE User_Interface SHALL NOT display individual pattern names, confidence scores, or pattern-specific details in any user-facing messages or reports

2. WHEN generating entry signals or trade reports, THE Report_Formatter SHALL NOT include pattern identification details in the output message

3. THE Pattern_Analysis_Results SHALL be stored internally in the system state but SHALL NOT be included in the `/CHECK` command output or `/TRACE` status updates

4. THE Pattern_Boost_Effect SHALL be reflected implicitly in the final RSI_Score displayed to the user, without explicitly mentioning that patterns contributed to the score adjustment

5. WHERE advanced debugging is enabled, THE System SHALL allow internal logging of pattern analysis results for troubleshooting purposes, but this logging SHALL NOT be visible to regular users

### Requirement 7: 與現有系統的相容性

**User Story:** 作為交易策略系統，我需要確保圖案識別功能與現有的 RSI 評分、多時框一致性和大戶信心度系統相容。

#### Acceptance Criteria

1. THE Pattern_Integration_Module SHALL work seamlessly with the existing RSI_Score calculation without modifying the core RSI calculation logic

2. WHEN both pattern-based boost and multi-timeframe consistency bonus are applicable, THE Signal_Booster SHALL apply both bonuses cumulatively (pattern boost + consistency bonus) without double-counting

3. THE Pattern_Integration_Module SHALL respect the existing Whale_Confidence thresholds: when Whale_Confidence < 65%, require higher pattern confidence (>= 70%) for signal boosting; when Whale_Confidence >= 65%, allow pattern confidence >= 50% for signal boosting

4. THE Pattern_Integration_Module SHALL NOT modify the existing TP1/TP2/TP3 and stop-loss calculation logic; pattern recognition affects only the RSI_Score adjustment

5. THE Pattern_Integration_Module SHALL maintain backward compatibility: if pattern analysis fails or returns no patterns, the system SHALL fall back to the original RSI-based signal generation without errors

### Requirement 8: 優先實現的圖案列表

**User Story:** 作為交易策略系統，我需要優先實現高價值的圖案識別，以便快速獲得系統收益。

#### Acceptance Criteria

1. THE Pattern_Recognizer SHALL prioritize implementation of Phase 1 patterns: W-bottom, triple-bottom, head-and-shoulders-bottom, ascending-triangle, ascending-wedge, cup-and-handle, ascending-flag, hammer, bullish-engulfing (bullish patterns) and their bearish counterparts (head-and-shoulders-top, triple-top, descending-triangle, descending-wedge, descending-flag, double-top, shooting-star, dark-cloud-cover)

2. THE Pattern_Recognizer SHALL implement Phase 2 patterns (rectangle, symmetric-triangle, diamond, pennant) after Phase 1 patterns are fully tested and deployed

3. WHEN implementing each pattern, THE Pattern_Recognizer SHALL include pattern-specific validation rules that check for minimum candle requirements, price level relationships, and volume patterns where applicable

4. THE Pattern_Recognizer SHALL document the technical rules for each pattern in code comments, including the expected number of candles, price relationships, and confidence scoring criteria

5. WHERE a pattern is not yet implemented, THE Pattern_Recognizer SHALL gracefully skip it without throwing errors or affecting the analysis of other patterns

### Requirement 9: 加分權重建議

**User Story:** 作為交易策略系統，我需要定義合理的加分權重，以便平衡圖案識別對信號的影響。

#### Acceptance Criteria

1. THE Signal_Booster SHALL apply the following base weight for single-timeframe pattern boost: 50-70% confidence = +5 points, 70-85% confidence = +7 points, 85%+ confidence = +10 points (maximum single pattern boost = +10 points)

2. WHEN multiple patterns are identified across different timeframes in the same direction, THE Signal_Booster SHALL apply consistency bonus: 2 timeframes aligned = +2 points, 3 timeframes aligned = +3 points, 4+ timeframes aligned = +5 points (maximum consistency bonus = +5 points)

3. THE Signal_Booster SHALL ensure that the total pattern-based boost (single pattern + consistency bonus) does NOT exceed +15 points to prevent over-weighting pattern signals

4. WHEN Whale_Confidence < 65%, THE Signal_Booster SHALL reduce pattern boost by 30% (e.g., +10 becomes +7) to account for lower market conviction

5. THE Signal_Booster SHALL apply pattern boost ONLY to the 15m timeframe analysis; pattern boosts on higher timeframes (30m/1h/4h/1d) are used only for consistency calculation, not for direct RSI adjustment

### Requirement 10: 圖案驗證和邊界條件

**User Story:** 作為交易策略系統，我需要確保圖案識別的準確性和穩定性，通過嚴格的驗證和邊界條件處理。

#### Acceptance Criteria

1. THE Pattern_Validator SHALL reject any pattern that contains fewer than 5 candles, regardless of how well it matches the pattern form

2. WHEN a pattern is at the boundary of the analysis window (e.g., pattern starts at candle 1 or ends at the most recent candle), THE Pattern_Validator SHALL mark it as Incomplete_Pattern and assign lower confidence score (reduce confidence by 20-30%)

3. THE Pattern_Validator SHALL handle edge cases: (a) when there are fewer than 5 candles in the timeframe, return no patterns; (b) when multiple overlapping patterns are detected, select the one with highest confidence; (c) when a pattern is broken (price moves beyond pattern boundaries), mark it as Invalidated_Pattern

4. WHEN a pattern is invalidated (price breaks out of pattern boundaries), THE Pattern_Validator SHALL remove it from the active pattern list and stop applying its boost to RSI_Score

5. THE Pattern_Validator SHALL verify that pattern price levels (support, resistance, highs, lows) are consistent with the actual candle data before marking a pattern as valid

### Requirement 11: 系統性能和資源管理

**User Story:** 作為交易策略系統，我需要確保圖案識別不會影響系統性能和實時信號生成。

#### Acceptance Criteria

1. WHEN performing pattern analysis, THE Pattern_Analyzer SHALL complete the analysis for all timeframes within 2 seconds to avoid blocking real-time signal generation

2. THE Pattern_Analyzer SHALL use efficient algorithms (e.g., sliding window, dynamic programming) to identify patterns without iterating through all possible candle combinations

3. THE Pattern_Analyzer SHALL cache pattern analysis results for each timeframe and only recalculate when new candles arrive (not on every signal check)

4. WHEN memory usage for pattern history exceeds 50MB during a tracking period, THE System SHALL archive old pattern records to disk and keep only recent patterns (last 24 hours) in memory

5. THE Pattern_Analyzer SHALL implement a timeout mechanism: if pattern analysis takes longer than 3 seconds, it SHALL be interrupted and the system SHALL fall back to RSI-only signal generation without errors

### Requirement 12: 圖案識別的可測試性

**User Story:** 作為交易策略系統，我需要確保圖案識別邏輯可以被充分測試，以驗證其正確性。

#### Acceptance Criteria

1. THE Pattern_Recognizer SHALL provide a test interface that accepts synthetic candle data (OHLCV arrays) and returns identified patterns with confidence scores for unit testing

2. WHEN testing pattern recognition, THE Test_Framework SHALL support injection of known chart patterns (e.g., perfect W-bottom, perfect head-and-shoulders) and verify that the recognizer correctly identifies them with high confidence (>= 80%)

3. THE Test_Framework SHALL support injection of anti-patterns (data that looks similar to a pattern but violates key rules) and verify that the recognizer correctly rejects them or assigns low confidence (< 50%)

4. WHEN testing multi-timeframe consistency, THE Test_Framework SHALL support independent configuration of patterns on each timeframe and verify that consistency calculation is correct

5. THE Test_Framework SHALL provide a property-based testing interface to generate random candle sequences and verify that pattern recognition never crashes and always returns valid confidence scores (0-100%)

