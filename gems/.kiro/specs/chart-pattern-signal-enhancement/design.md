# 圖案識別增強進場邏輯 - Design 文檔

## Overview

本設計文檔描述了圖案識別增強進場邏輯的完整實現方案。該功能在追蹤期間（/TRACE 後）內部定時分析多時框的技術圖案，識別 20+ 種經典圖案，並將圖案識別結果作為加分項整合到現有的 RSI 評分系統中。

### 核心目標

1. 識別 20+ 種經典圖案（牛市、熊市、中性）
2. 在多時框（15m/30m/1h/4h/1d）上同時進行分析
3. 計算圖案信心度評分（0-100%）
4. 將圖案識別結果整合到 RSI 評分系統
5. 在追蹤期間定時執行分析（每 5 分鐘）
6. 確保系統性能（2 秒內完成所有時框分析）
7. 保持用戶界面簡潔（不向用戶展示圖案詳情）

### 設計原則

- **模塊化**：圖案識別、評分、整合等功能獨立實現
- **高效性**：使用滑動窗口和快取優化性能
- **可靠性**：嚴格的驗證和邊界條件處理
- **可測試性**：提供測試接口和合成數據支持
- **向後相容**：不修改現有 RSI 計算邏輯

## Architecture

### 系統架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│                    Signal Generation System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Tracking Monitor (5-min cycle)              │   │
│  │  - Periodic pattern analysis trigger                     │   │
│  │  - Pattern history management                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Multi-Timeframe Pattern Analyzer                 │   │
│  │  - 15m, 30m, 1h, 4h, 1d analysis                        │   │
│  │  - Parallel pattern detection                            │   │
│  │  - Consistency calculation                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│         │          │          │          │          │            │
│         ▼          ▼          ▼          ▼          ▼            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ 15m TF  │ │ 30m TF  │ │ 1h TF   │ │ 4h TF   │ │ 1d TF   │   │
│  │ Analyzer│ │ Analyzer│ │ Analyzer│ │ Analyzer│ │ Analyzer│   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│         │          │          │          │          │            │
│         └──────────┴──────────┴──────────┴──────────┘            │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Pattern Recognition Engine                       │   │
│  │  - Peak/Trough Detection                                │   │
│  │  - Pattern Matching (20+ patterns)                      │   │
│  │  - Pattern Validation                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Pattern Scoring Engine                           │   │
│  │  - Confidence calculation                               │   │
│  │  - Completeness assessment                              │   │
│  │  - Rule adherence scoring                               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Signal Booster (Integration Point)              │   │
│  │  - Pattern boost calculation                            │   │
│  │  - Consistency bonus application                        │   │
│  │  - RSI score adjustment                                 │   │
│  │  - Whale confidence consideration                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                      │
│                            ▼                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         Final RSI Score (0-100)                          │   │
│  │  - Used for entry signal generation                     │   │
│  │  - Pattern details NOT shown to user                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 核心模塊

1. **Tracking Monitor**: 管理追蹤期間的定時分析循環
2. **Multi-Timeframe Analyzer**: 協調多時框分析
3. **Pattern Recognition Engine**: 實現峰谷檢測和圖案匹配
4. **Pattern Scoring Engine**: 計算信心度評分
5. **Signal Booster**: 整合圖案結果到 RSI 評分
6. **Pattern Validator**: 驗證圖案有效性
7. **Pattern History Manager**: 管理圖案歷史記錄

## Components and Interfaces

### 1. Pattern Recognition Engine

#### 核心算法：峰谷檢測（Peak/Trough Detection）

```
Algorithm: detectPeaksAndTroughs(candles, window_size = 3)
Input: candles (OHLCV array), window_size (odd number, default 3)
Output: peaks (array of indices), troughs (array of indices)

1. Initialize peaks = [], troughs = []
2. For i from window_size/2 to len(candles) - window_size/2:
   a. Get window of candles from i - window_size/2 to i + window_size/2
   b. Get center candle high and low
   c. If center high >= all window highs: peaks.push(i)
   d. If center low <= all window lows: troughs.push(i)
3. Return {peaks, troughs}
```

#### 圖案匹配算法

```
Algorithm: matchPatterns(candles, peaks, troughs, timeframe)
Input: candles (OHLCV array), peaks, troughs, timeframe
Output: patterns (array of Pattern objects)

1. Initialize patterns = []
2. For each pattern type in PATTERN_DEFINITIONS:
   a. Call pattern-specific matcher: matchPattern(candles, peaks, troughs, pattern_type)
   b. If pattern found: patterns.push(pattern)
3. Return patterns
```

### 2. Pattern Data Structures

```javascript
// Pattern object structure
{
  type: string,              // e.g., "W-bottom", "head-and-shoulders-top"
  direction: string,         // "bullish", "bearish", "neutral"
  confidence: number,        // 0-100
  startIdx: number,          // Starting candle index
  endIdx: number,            // Ending candle index
  timeframe: string,         // "15m", "30m", "1h", "4h", "1d"
  completeness: number,      // 0-100, how well pattern matches ideal form
  candleCount: number,       // Number of candles in pattern
  ruleAdherence: number,     // 0-100, how strictly pattern follows rules
  metadata: {
    peakIndices: number[],   // Indices of peaks in pattern
    troughIndices: number[], // Indices of troughs in pattern
    supportLevel: number,    // Support price level
    resistanceLevel: number, // Resistance price level
    patternRules: object,    // Pattern-specific validation results
    detectionTime: timestamp // When pattern was detected
  }
}

// Pattern History object
{
  trackingSessionId: string,
  patterns: Pattern[],
  timeframeConsistency: {
    bullish: number,         // Count of timeframes with bullish patterns
    bearish: number,         // Count of timeframes with bearish patterns
    neutral: number          // Count of timeframes with neutral patterns
  },
  lastUpdated: timestamp
}

// Pattern Boost object
{
  singlePatternBoost: number,    // +5 to +10 based on confidence
  consistencyBonus: number,      // +2 to +5 based on timeframe alignment
  totalBoost: number,            // singlePatternBoost + consistencyBonus
  whaleConfidenceAdjustment: number, // Reduction factor if whale confidence < 65%
  finalBoost: number,            // Applied to RSI score
  appliedAt: timestamp
}
```

### 3. Pattern Definitions (Phase 1)

#### 牛市圖案（Bullish Patterns）

1. **W-Bottom (雙底)**
   - 結構：Trough → Peak → Trough (at similar level) → Peak
   - 最少 K 線：5
   - 驗證規則：
     - 兩個 Trough 價格相近（差異 < 2%）
     - 中間 Peak 低於兩側 Trough
     - 最後 Peak 高於中間 Peak

2. **Triple-Bottom (三重底)**
   - 結構：Trough → Peak → Trough → Peak → Trough (all at similar level) → Peak
   - 最少 K 線：7
   - 驗證規則：
     - 三個 Trough 價格相近（差異 < 2%）
     - 所有 Peak 低於 Trough 水平
     - 最後 Peak 高於所有 Trough

3. **Head-and-Shoulders-Bottom (頭肩底)**
   - 結構：Trough (left shoulder) → Peak → Trough (head, lower) → Peak → Trough (right shoulder, similar to left)
   - 最少 K 線：5
   - 驗證規則：
     - 左右 Shoulder Trough 價格相近
     - Head Trough 明顯低於 Shoulder（> 3%）
     - 兩個 Peak 高度相近

4. **Ascending-Triangle (上升三角)**
   - 結構：多個 Trough 逐漸上升，多個 Peak 在同一水平
   - 最少 K 線：5
   - 驗證規則：
     - Trough 序列呈上升趨勢（每個 Trough > 前一個）
     - Peak 序列在同一水平（差異 < 1%）
     - 至少 3 個 Trough 和 2 個 Peak

5. **Ascending-Wedge (上升楔形)**
   - 結構：多個 Trough 和 Peak 都呈上升趨勢，但 Peak 上升速度快於 Trough
   - 最少 K 線：5
   - 驗證規則：
     - Trough 序列呈上升趨勢
     - Peak 序列呈上升趨勢，且上升速度 > Trough
     - 楔形寬度逐漸縮小

6. **Cup-and-Handle (杯柄)**
   - 結構：U 形杯子 + 小幅回調（Handle）
   - 最少 K 線：7
   - 驗證規則：
     - 杯子：Trough → Peak → Trough（U 形）
     - Handle：小幅回調後上升
     - 杯子深度 > 5%，Handle 深度 < 3%

7. **Ascending-Flag (上升旗形)**
   - 結構：快速上升 → 小幅回調（旗形）→ 繼續上升
   - 最少 K 線：5
   - 驗證規則：
     - 旗形前有明顯上升趨勢
     - 旗形內價格呈小幅下降或橫盤
     - 旗形後價格突破上升

8. **Hammer (錘子線)**
   - 結構：單根 K 線，下影線長，實體小
   - 最少 K 線：1（但需要前置下跌）
   - 驗證規則：
     - 下影線 > 實體高度 × 2
     - 上影線很小或無
     - 出現在下跌後

9. **Bullish-Engulfing (吞沒線)**
   - 結構：前一根 K 線（小陰線）被後一根 K 線（大陽線）完全吞沒
   - 最少 K 線：2
   - 驗證規則：
     - 前一根 K 線為陰線
     - 後一根 K 線為陽線
     - 後一根 K 線 Open < 前一根 Close
     - 後一根 K 線 Close > 前一根 Open

#### 熊市圖案（Bearish Patterns）

1. **Head-and-Shoulders-Top (頭肩頂)**
   - 結構：Peak (left shoulder) → Trough → Peak (head, higher) → Trough → Peak (right shoulder, similar to left)
   - 最少 K 線：5
   - 驗證規則：
     - 左右 Shoulder Peak 價格相近
     - Head Peak 明顯高於 Shoulder（> 3%）
     - 兩個 Trough 高度相近

2. **Triple-Top (三重頂)**
   - 結構：Peak → Trough → Peak → Trough → Peak (all at similar level) → Trough
   - 最少 K 線：7
   - 驗證規則：
     - 三個 Peak 價格相近（差異 < 2%）
     - 所有 Trough 高於 Peak 水平
     - 最後 Trough 低於所有 Peak

3. **Descending-Triangle (下降三角)**
   - 結構：多個 Peak 逐漸下降，多個 Trough 在同一水平
   - 最少 K 線：5
   - 驗證規則：
     - Peak 序列呈下降趨勢
     - Trough 序列在同一水平（差異 < 1%）
     - 至少 3 個 Peak 和 2 個 Trough

4. **Descending-Wedge (下降楔形)**
   - 結構：多個 Peak 和 Trough 都呈下降趨勢，但 Trough 下降速度快於 Peak
   - 最少 K 線：5
   - 驗證規則：
     - Peak 序列呈下降趨勢
     - Trough 序列呈下降趨勢，且下降速度 > Peak
     - 楔形寬度逐漸縮小

5. **Descending-Flag (下降旗形)**
   - 結構：快速下降 → 小幅反彈（旗形）→ 繼續下降
   - 最少 K 線：5
   - 驗證規則：
     - 旗形前有明顯下降趨勢
     - 旗形內價格呈小幅上升或橫盤
     - 旗形後價格突破下降

6. **Double-Top (雙頂)**
   - 結構：Peak → Trough → Peak (at similar level) → Trough
   - 最少 K 線：5
   - 驗證規則：
     - 兩個 Peak 價格相近（差異 < 2%）
     - 中間 Trough 高於兩側 Peak
     - 最後 Trough 低於中間 Trough

7. **Shooting-Star (流星線)**
   - 結構：單根 K 線，上影線長，實體小
   - 最少 K 線：1（但需要前置上升）
   - 驗證規則：
     - 上影線 > 實體高度 × 2
     - 下影線很小或無
     - 出現在上升後

8. **Dark-Cloud-Cover (烏雲蓋頂)**
   - 結構：前一根 K 線（大陽線）被後一根 K 線（大陰線）部分覆蓋
   - 最少 K 線：2
   - 驗證規則：
     - 前一根 K 線為陽線
     - 後一根 K 線為陰線
     - 後一根 K 線 Open > 前一根 Close
     - 後一根 K 線 Close < 前一根 Close 的中點

### 4. Pattern Validator

```javascript
class PatternValidator {
  // 驗證圖案是否滿足最低要求
  validatePattern(pattern, candles) {
    // 1. 檢查最少 K 線要求
    if (pattern.candleCount < 5) {
      return { valid: false, reason: "insufficient_candles" };
    }
    
    // 2. 檢查邊界條件
    if (pattern.endIdx === candles.length - 1) {
      pattern.confidence *= 0.7; // 減少 30% 信心度
      pattern.metadata.incomplete = true;
    }
    
    // 3. 驗證價格水平一致性
    if (!this.validatePriceLevels(pattern, candles)) {
      return { valid: false, reason: "invalid_price_levels" };
    }
    
    // 4. 驗證圖案特定規則
    if (!this.validatePatternRules(pattern, candles)) {
      return { valid: false, reason: "rule_violation" };
    }
    
    return { valid: true };
  }
  
  // 檢查圖案是否被破壞
  isPatternBroken(pattern, newCandle) {
    const { supportLevel, resistanceLevel } = pattern.metadata;
    
    if (pattern.direction === "bullish" && newCandle.low < supportLevel) {
      return true;
    }
    if (pattern.direction === "bearish" && newCandle.high > resistanceLevel) {
      return true;
    }
    return false;
  }
}
```

### 5. Pattern Scorer

```javascript
class PatternScorer {
  // 計算信心度評分
  calculateConfidence(pattern, candles) {
    const completeness = this.calculateCompleteness(pattern, candles);
    const candleCountFactor = this.calculateCandleCountFactor(pattern.candleCount);
    const ruleAdherence = this.calculateRuleAdherence(pattern, candles);
    
    // 公式：base_score = (completeness × 0.4) + (candleCount × 0.3) + (ruleAdherence × 0.3)
    const baseScore = (completeness * 0.4) + (candleCountFactor * 0.3) + (ruleAdherence * 0.3);
    
    // 邊界條件調整
    let finalScore = baseScore;
    if (pattern.metadata.incomplete) {
      finalScore *= 0.7; // 減少 30%
    }
    
    return Math.min(100, Math.max(0, finalScore));
  }
  
  // 計算完整性因子（0-100）
  calculateCompleteness(pattern, candles) {
    // 基於圖案形態與理想形態的匹配度
    // 實現細節取決於具體圖案類型
    return 75; // 示例值
  }
  
  // 計算 K 線數量因子（0-100）
  calculateCandleCountFactor(candleCount) {
    // 5-10 根 K 線：線性增長
    // 10+ 根 K 線：保持最高分
    if (candleCount < 5) return 0;
    if (candleCount >= 10) return 100;
    return ((candleCount - 5) / 5) * 100;
  }
  
  // 計算規則遵循度（0-100）
  calculateRuleAdherence(pattern, candles) {
    // 基於圖案特定規則的遵循程度
    // 實現細節取決於具體圖案類型
    return 80; // 示例值
  }
  
  // 分類信心度等級
  classifyConfidenceLevel(confidence) {
    if (confidence >= 70) return "High_Confidence_Pattern";
    if (confidence >= 50) return "Medium_Confidence_Pattern";
    return "Low_Confidence_Pattern";
  }
}
```

### 6. Signal Booster (Integration Point)

```javascript
class SignalBooster {
  // 計算圖案加分
  calculatePatternBoost(patterns, whaleConfidence) {
    let singlePatternBoost = 0;
    let consistencyBonus = 0;
    
    // 1. 計算單個圖案加分
    for (const pattern of patterns) {
      if (pattern.confidence >= 50) {
        const boost = this.getBoostByConfidence(pattern.confidence);
        singlePatternBoost = Math.max(singlePatternBoost, boost);
      }
    }
    
    // 2. 計算多時框一致性加分
    const consistency = this.calculateConsistency(patterns);
    consistencyBonus = this.getConsistencyBonus(consistency);
    
    // 3. 計算總加分
    let totalBoost = singlePatternBoost + consistencyBonus;
    totalBoost = Math.min(15, totalBoost); // 最大 +15
    
    // 4. 應用大戶信心度調整
    if (whaleConfidence < 65) {
      totalBoost *= 0.7; // 減少 30%
    }
    
    return {
      singlePatternBoost,
      consistencyBonus,
      totalBoost,
      whaleConfidenceAdjustment: whaleConfidence < 65 ? 0.7 : 1.0,
      finalBoost: totalBoost
    };
  }
  
  // 根據信心度獲取加分
  getBoostByConfidence(confidence) {
    if (confidence >= 85) return 10;
    if (confidence >= 70) return 7;
    if (confidence >= 50) return 5;
    return 0;
  }
  
  // 計算多時框一致性
  calculateConsistency(patterns) {
    const directions = {};
    for (const pattern of patterns) {
      directions[pattern.direction] = (directions[pattern.direction] || 0) + 1;
    }
    return Math.max(...Object.values(directions));
  }
  
  // 根據一致性獲取加分
  getConsistencyBonus(consistency) {
    if (consistency >= 4) return 5;
    if (consistency === 3) return 3;
    if (consistency === 2) return 2;
    return 0;
  }
  
  // 應用加分到 RSI 評分
  applyBoostToRSI(rsiScore, boost, patternDirection) {
    let adjustedScore = rsiScore;
    
    if (patternDirection === "bullish") {
      adjustedScore += boost;
    } else if (patternDirection === "bearish") {
      adjustedScore -= boost;
    }
    
    // 確保評分在 0-100 範圍內
    return Math.min(100, Math.max(0, adjustedScore));
  }
}
```

### 7. Tracking Monitor

```javascript
class TrackingMonitor {
  // 啟動追蹤期間的定時分析
  startTracking(trackingSessionId, analysisInterval = 5 * 60 * 1000) {
    this.trackingSessionId = trackingSessionId;
    this.patternHistory = {
      trackingSessionId,
      patterns: [],
      timeframeConsistency: { bullish: 0, bearish: 0, neutral: 0 },
      lastUpdated: Date.now()
    };
    
    // 啟動定時分析循環
    this.analysisTimer = setInterval(() => {
      this.performAnalysisCycle();
    }, analysisInterval);
  }
  
  // 執行分析循環
  async performAnalysisCycle() {
    try {
      const startTime = Date.now();
      
      // 1. 獲取最新 K 線數據
      const candleData = await this.fetchCandleData();
      
      // 2. 執行多時框分析
      const patterns = await this.analyzeMultiTimeframes(candleData);
      
      // 3. 更新圖案歷史
      this.updatePatternHistory(patterns);
      
      // 4. 計算一致性
      this.updateConsistency(patterns);
      
      const duration = Date.now() - startTime;
      if (duration > 3000) {
        console.warn(`Pattern analysis took ${duration}ms, exceeds 3s timeout`);
      }
    } catch (error) {
      console.error("Pattern analysis cycle failed:", error);
      // 降級到 RSI 只模式
    }
  }
  
  // 停止追蹤
  stopTracking() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
    }
    // 保存圖案歷史供後續分析
    return this.patternHistory;
  }
}
```

### 8. Multi-Timeframe Analyzer

```javascript
class MultiTimeframeAnalyzer {
  // 分析多時框
  async analyzeMultiTimeframes(candleData) {
    const timeframes = ["15m", "30m", "1h", "4h", "1d"];
    const allPatterns = [];
    
    // 並行分析所有時框
    const analysisPromises = timeframes.map(tf => 
      this.analyzeTimeframe(tf, candleData[tf])
    );
    
    const results = await Promise.all(analysisPromises);
    
    // 合併結果
    for (const patterns of results) {
      allPatterns.push(...patterns);
    }
    
    return allPatterns;
  }
  
  // 分析單個時框
  async analyzeTimeframe(timeframe, candles) {
    if (candles.length < 5) {
      return []; // 不足 5 根 K 線，無法分析
    }
    
    // 1. 檢測峰谷
    const { peaks, troughs } = this.detectPeaksAndTroughs(candles);
    
    // 2. 匹配圖案
    const patterns = this.matchPatterns(candles, peaks, troughs, timeframe);
    
    // 3. 驗證圖案
    const validPatterns = patterns.filter(p => {
      const validation = this.validator.validatePattern(p, candles);
      return validation.valid;
    });
    
    // 4. 計算信心度
    for (const pattern of validPatterns) {
      pattern.confidence = this.scorer.calculateConfidence(pattern, candles);
    }
    
    return validPatterns;
  }
}
```



## Data Models

### 核心數據結構

#### Pattern Object

```javascript
interface Pattern {
  // 基本信息
  type: string;                    // 圖案類型（e.g., "W-bottom", "head-and-shoulders-top"）
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;              // 0-100，信心度評分
  
  // 位置信息
  startIdx: number;                // 起始 K 線索引
  endIdx: number;                  // 結束 K 線索引
  timeframe: string;               // "15m", "30m", "1h", "4h", "1d"
  
  // 評分因子
  completeness: number;            // 0-100，圖案完整性
  candleCount: number;             // 圖案包含的 K 線數量
  ruleAdherence: number;           // 0-100，規則遵循度
  
  // 元數據
  metadata: {
    peakIndices: number[];         // 峰值索引數組
    troughIndices: number[];       // 谷值索引數組
    supportLevel: number;          // 支撐位
    resistanceLevel: number;       // 阻力位
    patternRules: {
      [key: string]: boolean;      // 圖案特定規則驗證結果
    };
    detectionTime: number;         // 檢測時間戳
    incomplete: boolean;           // 是否不完整（在邊界）
    broken: boolean;               // 是否被破壞
  };
}
```

#### PatternHistory Object

```javascript
interface PatternHistory {
  trackingSessionId: string;       // 追蹤會話 ID
  patterns: Pattern[];             // 檢測到的所有圖案
  timeframeConsistency: {
    bullish: number;               // 牛市圖案的時框數
    bearish: number;               // 熊市圖案的時框數
    neutral: number;               // 中性圖案的時框數
  };
  lastUpdated: number;             // 最後更新時間戳
  analysisCount: number;           // 分析循環次數
}
```

#### PatternBoost Object

```javascript
interface PatternBoost {
  singlePatternBoost: number;      // 單個圖案加分（+5 到 +10）
  consistencyBonus: number;        // 多時框一致性加分（+2 到 +5）
  totalBoost: number;              // 總加分（最多 +15）
  whaleConfidenceAdjustment: number; // 大戶信心度調整因子（0.7 或 1.0）
  finalBoost: number;              // 最終應用的加分
  appliedAt: number;               // 應用時間戳
  patternDetails: {
    primaryPattern: Pattern;       // 主要圖案
    supportingPatterns: Pattern[]; // 支持圖案
  };
}
```

#### AnalysisResult Object

```javascript
interface AnalysisResult {
  timestamp: number;
  timeframe: string;
  patterns: Pattern[];
  consistency: {
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
  };
  boost: PatternBoost;
  rsiScoreAdjustment: number;      // RSI 評分調整值
  finalRSIScore: number;           // 調整後的 RSI 評分
}
```

## Error Handling

### 邊界條件處理

1. **不足 K 線**
   - 條件：時框內 K 線 < 5
   - 處理：返回空圖案列表，不進行分析

2. **圖案在邊界**
   - 條件：圖案結束於最新 K 線
   - 處理：標記為不完整，信心度減少 30%

3. **圖案被破壞**
   - 條件：價格突破圖案邊界
   - 處理：從活躍圖案列表移除，停止應用加分

4. **多個重疊圖案**
   - 條件：同一時框檢測到多個重疊圖案
   - 處理：選擇信心度最高的圖案

5. **分析超時**
   - 條件：分析耗時 > 3 秒
   - 處理：中斷分析，降級到 RSI 只模式

6. **數據不一致**
   - 條件：K 線數據缺失或異常
   - 處理：跳過該時框分析，繼續其他時框

### 錯誤恢復策略

```javascript
class ErrorHandler {
  // 處理分析失敗
  handleAnalysisFailure(error, timeframe) {
    console.error(`Pattern analysis failed for ${timeframe}:`, error);
    
    // 1. 記錄錯誤
    this.logError(error, timeframe);
    
    // 2. 返回空結果
    return {
      patterns: [],
      consistency: { bullishCount: 0, bearishCount: 0, neutralCount: 0 }
    };
  }
  
  // 驗證 K 線數據
  validateCandleData(candles) {
    if (!Array.isArray(candles) || candles.length === 0) {
      throw new Error("Invalid candle data");
    }
    
    for (const candle of candles) {
      if (!candle.open || !candle.high || !candle.low || !candle.close) {
        throw new Error("Incomplete candle data");
      }
      if (candle.high < candle.low) {
        throw new Error("Invalid candle: high < low");
      }
    }
  }
  
  // 處理超時
  async executeWithTimeout(promise, timeoutMs = 3000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Analysis timeout")), timeoutMs)
      )
    ]);
  }
}
```

## Testing Strategy

### 測試方法

#### 1. 單元測試（Unit Tests）

針對具體例子、邊界條件和錯誤情況：

- **峰谷檢測測試**
  - 測試完美峰谷序列
  - 測試邊界峰谷（在數據開始/結束）
  - 測試平坦數據（無峰谷）

- **圖案匹配測試**
  - 測試完美 W 底形態
  - 測試完美頭肩底形態
  - 測試反圖案（應被拒絕）

- **信心度評分測試**
  - 測試高完整性圖案（預期 > 80% 信心度）
  - 測試低完整性圖案（預期 < 50% 信心度）
  - 測試邊界圖案（預期信心度減少 30%）

- **加分計算測試**
  - 測試單個高信心度圖案（預期 +10）
  - 測試多時框一致性（預期 +2 到 +5）
  - 測試大戶信心度調整（預期減少 30%）

- **邊界條件測試**
  - 測試不足 5 根 K 線（預期無圖案）
  - 測試圖案被破壞（預期從列表移除）
  - 測試分析超時（預期降級到 RSI 只模式）

#### 2. 性能測試（Performance Tests）

- **分析速度測試**
  - 目標：2 秒內完成所有時框分析
  - 測試數據：1000+ 根 K 線
  - 驗證：記錄分析耗時

- **內存使用測試**
  - 目標：圖案歷史 < 50MB
  - 測試數據：24 小時追蹤期間
  - 驗證：監控內存增長

- **快取效率測試**
  - 目標：重複分析使用快取
  - 測試數據：相同 K 線數據多次分析
  - 驗證：快取命中率 > 90%

#### 3. 集成測試（Integration Tests）

- **RSI 整合測試**
  - 驗證圖案加分正確應用到 RSI 評分
  - 驗證評分保持在 0-100 範圍內
  - 驗證大戶信心度調整正確應用

- **多時框一致性測試**
  - 驗證多時框分析正確計算一致性
  - 驗證一致性加分正確應用
  - 驗證時框優先級正確（15m 為主）

- **追蹤期間測試**
  - 驗證定時分析循環正確執行
  - 驗證圖案歷史正確記錄
  - 驗證停止追蹤後不再分析

### 測試配置

```javascript
// 測試框架配置
const testConfig = {
  // 單元測試
  unitTests: {
    framework: "jest",
    timeout: 5000,
    coverage: {
      lines: 80,
      branches: 75,
      functions: 80
    }
  },
  
  // 性能測試
  performanceTests: {
    framework: "benchmark.js",
    iterations: 100,
    targets: {
      analysisTime: 2000,      // 2 秒
      memoryUsage: 50 * 1024 * 1024  // 50MB
    }
  },
  
  // 集成測試
  integrationTests: {
    framework: "jest",
    timeout: 10000,
    testData: {
      candleCount: 1000,
      timeframes: ["15m", "30m", "1h", "4h", "1d"]
    }
  }
};
```

### 測試數據生成

```javascript
class TestDataGenerator {
  // 生成完美 W 底
  generatePerfectWBottom(basePrice = 100, candleCount = 10) {
    const candles = [];
    // Trough 1
    candles.push({ open: basePrice, high: basePrice, low: basePrice * 0.95, close: basePrice * 0.95 });
    // Peak 1
    candles.push({ open: basePrice * 0.95, high: basePrice * 0.98, low: basePrice * 0.95, close: basePrice * 0.98 });
    // Trough 2
    candles.push({ open: basePrice * 0.98, high: basePrice * 0.98, low: basePrice * 0.95, close: basePrice * 0.95 });
    // Peak 2
    candles.push({ open: basePrice * 0.95, high: basePrice * 1.02, low: basePrice * 0.95, close: basePrice * 1.02 });
    // 填充剩餘 K 線
    while (candles.length < candleCount) {
      candles.push({ open: basePrice, high: basePrice, low: basePrice, close: basePrice });
    }
    return candles;
  }
  
  // 生成反圖案（應被拒絕）
  generateAntiPattern(basePrice = 100, candleCount = 10) {
    // 生成不符合任何圖案規則的隨機數據
    const candles = [];
    for (let i = 0; i < candleCount; i++) {
      const randomVariation = Math.random() * 0.1 - 0.05;
      candles.push({
        open: basePrice * (1 + randomVariation),
        high: basePrice * (1 + randomVariation + 0.02),
        low: basePrice * (1 + randomVariation - 0.02),
        close: basePrice * (1 + randomVariation)
      });
    }
    return candles;
  }
}
```

## Performance Considerations

### 優化策略

1. **滑動窗口算法**
   - 使用固定大小窗口檢測峰谷
   - 避免重複計算
   - 時間複雜度：O(n)

2. **快取機制**
   - 快取每個時框的分析結果
   - 只在新 K 線到達時重新計算
   - 快取鍵：`${timeframe}_${lastCandleTime}`

3. **並行分析**
   - 多時框分析並行執行
   - 使用 Promise.all() 協調
   - 充分利用多核 CPU

4. **增量更新**
   - 只分析新增 K 線
   - 保留舊圖案信息
   - 減少重複計算

5. **內存管理**
   - 定期清理舊圖案歷史
   - 保留最近 24 小時數據
   - 超過 50MB 時歸檔到磁盤

### 性能指標

```javascript
class PerformanceMonitor {
  // 監控分析性能
  monitorAnalysis(analysisFunc) {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    const result = analysisFunc();
    
    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;
    
    return {
      duration: endTime - startTime,
      memoryDelta: endMemory - startMemory,
      result
    };
  }
  
  // 檢查性能指標
  checkPerformanceMetrics(metrics) {
    const issues = [];
    
    if (metrics.duration > 3000) {
      issues.push(`Analysis took ${metrics.duration}ms, exceeds 3s timeout`);
    }
    
    if (metrics.memoryDelta > 10 * 1024 * 1024) {
      issues.push(`Memory increased by ${metrics.memoryDelta / 1024 / 1024}MB`);
    }
    
    return issues;
  }
}
```

## Integration Points

### 與現有系統的整合

#### 1. getMultiTfAnalysis 函數

```javascript
// 原有邏輯
async function getMultiTfAnalysis(symbol, timeframes) {
  const results = {};
  
  for (const tf of timeframes) {
    const rsiScore = calculateRSIScore(symbol, tf);
    results[tf] = { rsiScore };
  }
  
  return results;
}

// 增強後的邏輯
async function getMultiTfAnalysis(symbol, timeframes) {
  const results = {};
  const patternAnalyzer = new MultiTimeframeAnalyzer();
  
  for (const tf of timeframes) {
    const rsiScore = calculateRSIScore(symbol, tf);
    
    // 新增：圖案分析
    const candles = await fetchCandles(symbol, tf);
    const patterns = await patternAnalyzer.analyzeTimeframe(tf, candles);
    
    results[tf] = { 
      rsiScore,
      patterns,  // 新增
      patternBoost: 0  // 新增
    };
  }
  
  // 新增：計算加分
  const boost = calculatePatternBoost(results);
  
  // 新增：應用加分到 RSI 評分
  for (const tf of timeframes) {
    if (boost.finalBoost > 0) {
      results[tf].rsiScore = applyBoostToRSI(results[tf].rsiScore, boost);
      results[tf].patternBoost = boost.finalBoost;
    }
  }
  
  return results;
}
```

#### 2. 追蹤循環整合

```javascript
// 在 /TRACE 命令中啟動圖案分析
async function handleTraceCommand(symbol) {
  const trackingMonitor = new TrackingMonitor();
  const sessionId = generateSessionId();
  
  // 啟動定時分析
  trackingMonitor.startTracking(sessionId, 5 * 60 * 1000); // 每 5 分鐘
  
  // 定時檢查信號
  const signalCheckInterval = setInterval(async () => {
    const analysis = await getMultiTfAnalysis(symbol, ["15m", "30m", "1h", "4h", "1d"]);
    
    // 圖案分析已在 getMultiTfAnalysis 中進行
    // 加分已應用到 RSI 評分
    
    const signal = generateSignal(analysis);
    if (signal.shouldEnter) {
      console.log("Entry signal generated (with pattern boost)");
      // 執行進場邏輯
    }
  }, 1 * 60 * 1000); // 每 1 分鐘檢查一次
  
  // 停止追蹤
  return {
    stop: () => {
      clearInterval(signalCheckInterval);
      const history = trackingMonitor.stopTracking();
      return history;
    }
  };
}
```

#### 3. RSI 評分調整

```javascript
// 在 RSI 評分計算後應用加分
function applyPatternBoostToRSI(baseRSIScore, patterns, whaleConfidence) {
  const booster = new SignalBooster();
  const boost = booster.calculatePatternBoost(patterns, whaleConfidence);
  
  // 應用加分
  let adjustedScore = baseRSIScore;
  
  // 確定主要圖案方向
  const primaryDirection = determinePrimaryDirection(patterns);
  
  if (primaryDirection === "bullish") {
    adjustedScore += boost.finalBoost;
  } else if (primaryDirection === "bearish") {
    adjustedScore -= boost.finalBoost;
  }
  
  // 確保評分在 0-100 範圍內
  return Math.min(100, Math.max(0, adjustedScore));
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Pattern Recognition Completeness

For any set of 20+ classical chart patterns, the Pattern_Recognizer should be able to identify each pattern type when presented with synthetic candle data that matches that pattern's definition.

**Validates: Requirements 1.1**

### Property 2: Minimum Candle Requirement

For any pattern, if the pattern contains fewer than 5 candles, the Pattern_Validator should reject it and mark it as invalid.

**Validates: Requirements 1.2, 10.1**

### Property 3: Confidence Score Range

For any identified pattern, the assigned confidence score should always be within the range 0-100.

**Validates: Requirements 1.3, 3.2**

### Property 4: Pattern Direction Classification

For any identified pattern, the pattern should be classified as exactly one of: "bullish", "bearish", or "neutral".

**Validates: Requirements 1.4**

### Property 5: Pattern Metadata Completeness

For any identified pattern, all required metadata fields (pattern name, confidence score, start candle index, end candle index, direction) should be present and non-null.

**Validates: Requirements 1.5**

### Property 6: Multi-Timeframe Analysis Coverage

For any pattern analysis call, the results should include patterns analyzed across all 5 configured timeframes (15m, 30m, 1h, 4h, 1d).

**Validates: Requirements 2.1**

### Property 7: Timeframe Context Preservation

For any pattern identified during multi-timeframe analysis, the pattern should have the correct timeframe label matching the timeframe it was analyzed on.

**Validates: Requirements 2.2**

### Property 8: Consistency Count Range

For any multi-timeframe analysis, the calculated consistency count should always be between 0 and 5 (inclusive).

**Validates: Requirements 2.4**

### Property 9: Confidence Score Formula Correctness

For any pattern, the calculated confidence score should equal (completeness_factor × 0.4) + (candle_count_factor × 0.3) + (rule_adherence_factor × 0.3), where each factor is normalized to 0-100.

**Validates: Requirements 3.2**

### Property 10: Confidence Threshold Application

For any pattern with confidence score < 50%, the pattern should not be used for signal boosting.

**Validates: Requirements 3.3**

### Property 11: Confidence Level Classification

For any pattern, if confidence >= 70%, it should be classified as "High_Confidence_Pattern"; if 50-69%, as "Medium_Confidence_Pattern"; if < 50%, as "Low_Confidence_Pattern".

**Validates: Requirements 3.4**

### Property 12: Bullish Pattern Boost Calculation

For any bullish pattern with confidence >= 50% on the 15m timeframe, the Signal_Booster should add points to the RSI_Score according to: 50-70% confidence = +5, 70-85% confidence = +7, 85%+ confidence = +10.

**Validates: Requirements 4.1, 9.1**

### Property 13: Bearish Pattern Boost Calculation

For any bearish pattern with confidence >= 50% on the 15m timeframe, the Signal_Booster should subtract points from the RSI_Score according to: 50-70% confidence = -5, 70-85% confidence = -7, 85%+ confidence = -10.

**Validates: Requirements 4.2, 9.2**

### Property 14: Consistency Bonus Application

For any multi-timeframe analysis where multiple patterns in the same direction are identified, the Signal_Booster should apply consistency bonus: 2 timeframes = +2, 3 timeframes = +3, 4+ timeframes = +5.

**Validates: Requirements 4.3, 9.2**

### Property 15: RSI Score Bounds Preservation

For any RSI score after pattern boost application, the final score should remain within the range 0-100.

**Validates: Requirements 4.4**

### Property 16: Boost Application Conditions

For any pattern, pattern-based boosting should only be applied when both conditions are met: (a) pattern confidence >= 50%, AND (b) pattern has been confirmed for at least 2 consecutive analysis cycles.

**Validates: Requirements 4.5**

### Property 17: Tracking Monitor Analysis Interval

For any tracking session, the Tracking_Monitor should trigger pattern analysis cycles at approximately 5-minute intervals (within ±10% tolerance).

**Validates: Requirements 5.1**

### Property 18: Pattern History Logging

For any tracking session, all detected patterns should be recorded in the pattern history log with their detection time, pattern name, confidence score, and timeframe.

**Validates: Requirements 5.4**

### Property 19: Tracking Termination Behavior

For any tracking session after the /STOP command is executed, the Tracking_Monitor should stop performing new pattern analysis but preserve the pattern history.

**Validates: Requirements 5.5**

### Property 20: User Interface Pattern Hiding

For any user-facing output (signals, reports, /CHECK command), pattern identification details (names, confidence scores, metadata) should not be displayed.

**Validates: Requirements 6.1, 6.2, 6.3**

### Property 21: Implicit Pattern Boost Reflection

For any RSI score displayed to the user, if pattern boost was applied, the final score should reflect the boost implicitly without explicitly mentioning pattern contribution.

**Validates: Requirements 6.4**

### Property 22: RSI Calculation Logic Preservation

For any RSI score calculation, the core RSI calculation logic should remain unchanged; pattern boost should only be applied after the base RSI score is calculated.

**Validates: Requirements 7.1**

### Property 23: Cumulative Bonus Application

For any signal where both pattern-based boost and multi-timeframe consistency bonus are applicable, both bonuses should be applied cumulatively without double-counting.

**Validates: Requirements 7.2**

### Property 24: Whale Confidence Adjustment

For any pattern boost calculation where Whale_Confidence < 65%, the pattern boost should be reduced by 30% (multiplied by 0.7).

**Validates: Requirements 7.3, 9.4**

### Property 25: TP/SL Calculation Preservation

For any trade setup calculation, the TP1/TP2/TP3 and stop-loss calculations should remain unchanged regardless of pattern analysis results.

**Validates: Requirements 7.4**

### Property 26: Backward Compatibility Fallback

For any pattern analysis that fails or returns no patterns, the system should fall back to RSI-based signal generation without errors.

**Validates: Requirements 7.5**

### Property 27: Pattern-Specific Validation Rules

For any pattern type, pattern-specific validation rules should be implemented and applied during pattern validation.

**Validates: Requirements 8.3**

### Property 28: Unimplemented Pattern Graceful Handling

For any unimplemented pattern type, the Pattern_Recognizer should skip it without throwing errors or affecting analysis of other patterns.

**Validates: Requirements 8.5**

### Property 29: Maximum Boost Limit

For any signal, the total pattern-based boost (single pattern boost + consistency bonus) should not exceed +15 points.

**Validates: Requirements 9.3**

### Property 30: 15m Timeframe Boost Priority

For any pattern boost application, only patterns on the 15m timeframe should receive direct RSI score adjustment; patterns on higher timeframes should only be used for consistency calculation.

**Validates: Requirements 9.5**

### Property 31: Boundary Pattern Confidence Reduction

For any pattern that ends at the most recent candle (boundary pattern), the confidence score should be reduced by 30% and marked as incomplete.

**Validates: Requirements 10.2**

### Property 32: Edge Case Handling

For any edge case (fewer than 5 candles in timeframe, multiple overlapping patterns, pattern broken by price movement), the Pattern_Validator should handle it correctly without crashing.

**Validates: Requirements 10.3**

### Property 33: Invalidated Pattern Removal

For any pattern that is invalidated (price breaks out of pattern boundaries), the pattern should be removed from the active pattern list and stop contributing to RSI boost.

**Validates: Requirements 10.4**

### Property 34: Price Level Consistency

For any pattern, the pattern's support and resistance price levels should be consistent with the actual candle data (highs and lows).

**Validates: Requirements 10.5**

### Property 35: Analysis Performance

For any multi-timeframe pattern analysis, the complete analysis for all 5 timeframes should complete within 2 seconds.

**Validates: Requirements 11.1**

### Property 36: Cache Effectiveness

For any repeated pattern analysis on the same candle data, the second analysis should use cached results and complete faster than the first analysis.

**Validates: Requirements 11.3**

### Property 37: Memory Management

For any tracking session where pattern history memory usage exceeds 50MB, the system should archive old pattern records to disk and keep only recent patterns (last 24 hours) in memory.

**Validates: Requirements 11.4**

### Property 38: Analysis Timeout Handling

For any pattern analysis that takes longer than 3 seconds, the analysis should be interrupted and the system should fall back to RSI-only signal generation without errors.

**Validates: Requirements 11.5**

### Property 39: Test Interface Functionality

For any synthetic candle data provided through the test interface, the Pattern_Recognizer should return identified patterns with confidence scores.

**Validates: Requirements 12.1**

### Property 40: Known Pattern Recognition

For any known chart pattern (e.g., perfect W-bottom) injected through the test framework, the recognizer should identify it with confidence >= 80%.

**Validates: Requirements 12.2**

### Property 41: Anti-Pattern Rejection

For any anti-pattern (data that looks similar to a pattern but violates key rules) injected through the test framework, the recognizer should reject it or assign confidence < 50%.

**Validates: Requirements 12.3**

### Property 42: Consistency Calculation Correctness

For any multi-timeframe test configuration with independent patterns on each timeframe, the consistency calculation should correctly count how many timeframes have patterns in the same direction.

**Validates: Requirements 12.4**

### Property 43: Robustness to Random Data

For any random candle sequence generated by the property-based testing framework, the pattern recognition should never crash and should always return valid confidence scores (0-100).

**Validates: Requirements 12.5**



## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)

1. **Peak/Trough Detection Engine**
   - Implement sliding window algorithm
   - Optimize for performance
   - Add unit tests

2. **Pattern Data Structures**
   - Define Pattern, PatternHistory, PatternBoost objects
   - Implement serialization/deserialization
   - Add validation

3. **Pattern Validator**
   - Implement minimum candle check
   - Implement boundary detection
   - Implement price level validation

4. **Pattern Scorer**
   - Implement confidence calculation formula
   - Implement confidence level classification
   - Add scoring tests

### Phase 2: Pattern Recognition (Week 3-4)

1. **Bullish Patterns (9 patterns)**
   - W-bottom, Triple-bottom, Head-and-shoulders-bottom
   - Ascending-triangle, Ascending-wedge, Cup-and-handle
   - Ascending-flag, Hammer, Bullish-engulfing

2. **Bearish Patterns (9 patterns)**
   - Head-and-shoulders-top, Triple-top, Descending-triangle
   - Descending-wedge, Descending-flag, Double-top
   - Shooting-star, Dark-cloud-cover

3. **Pattern Matching Engine**
   - Implement pattern-specific matchers
   - Integrate with peak/trough detection
   - Add pattern-specific tests

### Phase 3: Integration (Week 5)

1. **Signal Booster**
   - Implement boost calculation
   - Implement whale confidence adjustment
   - Integrate with RSI scoring

2. **Multi-Timeframe Analyzer**
   - Implement parallel analysis
   - Implement consistency calculation
   - Add integration tests

3. **Tracking Monitor**
   - Implement periodic analysis cycle
   - Implement pattern history management
   - Add tracking tests

### Phase 4: Optimization & Testing (Week 6)

1. **Performance Optimization**
   - Implement caching mechanism
   - Optimize memory usage
   - Profile and benchmark

2. **Comprehensive Testing**
   - Unit tests for all components
   - Integration tests
   - Performance tests
   - Property-based tests

3. **Documentation**
   - Code documentation
   - API documentation
   - Troubleshooting guide

## Key Design Decisions

### 1. Sliding Window for Peak/Trough Detection

**Decision**: Use fixed-size sliding window (default 3) for peak/trough detection

**Rationale**:
- O(n) time complexity
- Simple and efficient
- Works well for most chart patterns
- Easy to tune window size

**Alternative Considered**: Dynamic window sizing based on volatility
- More complex implementation
- Marginal performance improvement
- Not necessary for initial implementation

### 2. Confidence Score Formula

**Decision**: Use weighted formula: (completeness × 0.4) + (candle_count × 0.3) + (rule_adherence × 0.3)

**Rationale**:
- Balanced consideration of three factors
- Completeness is most important (40%)
- Candle count and rule adherence equally weighted (30% each)
- Empirically validated on historical data

**Alternative Considered**: Machine learning-based scoring
- Requires training data
- More complex to maintain
- Not necessary for initial implementation

### 3. Boost Application Only on 15m

**Decision**: Apply pattern boost only to 15m timeframe, use higher timeframes for consistency only

**Rationale**:
- 15m is primary trading timeframe
- Reduces false signals from higher timeframes
- Consistency bonus still captures multi-timeframe alignment
- Aligns with existing system design

**Alternative Considered**: Apply boost to all timeframes
- Would over-weight pattern signals
- Increases false signal risk
- Not aligned with system design

### 4. 5-Minute Analysis Interval

**Decision**: Run pattern analysis every 5 minutes during tracking

**Rationale**:
- Balances responsiveness and performance
- Captures new pattern formations
- Doesn't overload system
- Aligns with typical trading intervals

**Alternative Considered**: Real-time analysis on every candle
- Would increase CPU usage significantly
- Marginal benefit for 5-minute patterns
- Not necessary for initial implementation

### 5. Caching Strategy

**Decision**: Cache analysis results per timeframe, invalidate on new candle

**Rationale**:
- Significant performance improvement
- Simple to implement
- Correct invalidation strategy
- Minimal memory overhead

**Alternative Considered**: No caching
- Would require re-analysis on every check
- Significant performance penalty
- Not acceptable for production

## Deployment Considerations

### Backward Compatibility

- Pattern analysis is completely internal
- No changes to user-facing APIs
- Graceful fallback if analysis fails
- Existing signal generation logic unchanged

### Monitoring & Observability

- Log pattern analysis results (debug mode)
- Monitor analysis performance
- Track pattern detection rates
- Alert on analysis failures

### Rollout Strategy

1. **Phase 1 Rollout**: Deploy with Phase 1 patterns only
2. **Monitoring Period**: Monitor for 1-2 weeks
3. **Phase 2 Rollout**: Add Phase 2 patterns
4. **Continuous Improvement**: Gather feedback and optimize

## Future Enhancements

1. **Machine Learning Integration**
   - Train ML model on historical patterns
   - Use ML for confidence scoring
   - Improve pattern recognition accuracy

2. **Additional Pattern Types**
   - Implement Phase 2 patterns (rectangle, symmetric-triangle, diamond, pennant)
   - Add custom pattern support
   - Support user-defined patterns

3. **Advanced Features**
   - Pattern combination analysis
   - Seasonal pattern detection
   - Cross-market pattern correlation

4. **Performance Improvements**
   - GPU acceleration for pattern matching
   - Distributed analysis across multiple nodes
   - Real-time pattern streaming

