# 信號評分與勝率規則

## 文件目的
本文件說明：
- 信號分類與評分方式
- 推送門檻
- 勝率統計的時間窗與達標條件
- 摘要統計的分組維度

## 信號型態
目前使用以下型態：
- 布林突破
- V轉反彈
- 量能爆發
- 穩健斜率

每次掃描同一標的時，系統會同時評估多種型態候選，最後取分數最高者作為該次信號型態。

## 評分模型（0-100）
所有分數皆正規化後限制在 `0..100`。

共用指標分量：
- `momentum15`：15m 布林位置動能（正規化）
- `momentum1h`：1h 布林位置動能（正規化）
- `volumeStrength`：15m 成交量相對前 20 根均量的變化強度（正規化）
- `structureStrength`：由平均 R2、斜率、higher-lows 混合而成的結構分數
- `reversalStrength`：由急跌幅度、反彈幅度、收復比例計算的反轉強度

各型態加權（總分上限 100）：
- 布林突破：
  - `0.35 * momentum15 + 0.20 * momentum1h + 0.25 * volumeStrength + 0.20 * structureStrength`
- V轉反彈：
  - `0.50 * reversalStrength + 0.25 * volumeStrength + 0.15 * structureStrength + 0.10 * momentum15`
- 量能爆發：
  - `0.55 * volumeStrength + 0.25 * structureStrength + 0.20 * momentum15`
- 穩健斜率：
  - `0.60 * structureStrength + 0.20 * momentum15 + 0.20 * volumeStrength`

## 推送門檻
- `MIN_SIGNAL_SCORE = 60`
- 分數低於門檻不推送。

## 勝率評估
信號紀錄寫入：
- `data/signal_journal.json`

評估時間窗與達標漲幅：
- `1h`：漲幅 `>= +5%` 算達標
- `2h`：漲幅 `>= +15%` 算達標
- `4h`：漲幅 `>= +25%` 算達標

評估基準：
- 進場價：信號當下價格
- 比較價：對應時間窗 K 線收盤價

## 摘要統計維度
摘要分兩層：
- 星等勝率：`星等(1/2/3) x 時間窗(1h/2h/4h)`
- 型態勝率：`型態 x 時間窗(1h/2h/4h)`

每列指標包含：
- `wins`
- `total`
- `winRate`
- `threshold`

## 儀表板資料來源
為了遠端查詢，系統會將 journal 鏡像到：
- `public/api/signal_journal.json`

儀表板頁面：
- `public/signal_dashboard.html`
