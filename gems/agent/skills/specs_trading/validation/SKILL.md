---
name: Strategy Validation (策略驗證規範)
description: 四層統計驗證 + 蒙地卡羅，評估策略穩健性、過擬合風險與實盤可行性。
---

# Strategy Validation（策略驗證規範）

策略上線前必須通過以下驗證，確認不是過擬合、在不同市場狀態下都能獲利。

---

## ⚡ 觸發條件（何時必須執行驗證）

| 觸發情境 | 必做驗證 |
|---------|---------|
| 任何進場條件變動（RSI門檻、EMA週期、分數門檻等） | 完整四層驗證 + 蒙地卡羅 |
| 任何出場條件變動（TP比例、BE設定、移動止損） | 完整四層驗證 + 蒙地卡羅 |
| 用戶說「上線」、「部署」、「更新正式策略」 | 確認最近一次驗證結果通過才執行 |
| 新增幣種支援 | 用 `bt_validate_universal.js` 跑該幣種驗證 |
| 回測結果看起來太好（勝率 > 85%） | 重新檢查是否有前視偏差 |

**驗證未通過時禁止上線**，需先調整參數重新驗證。

---

## 📂 驗證文件索引

- 📊 **[Walk-Forward Validation](./validation_walk_forward.md)**
  把資料切成多段，用前段訓練、後段驗證，確認樣本外穩定性。

- 🔁 **[CPCV（組合交叉驗證）](./validation_dsr_cpcv.md)**
  把全年切成 6 段，每段輪流當驗證集，比 Walk-Forward 更全面。

- 📉 **[Deflated Sharpe Ratio](./validation_dsr_cpcv.md)**
  校正多次參數掃描造成的選擇偏差，確認策略有統計顯著性。

- 🌍 **[Regime Analysis](./validation_regime.md)**
  分季驗證，確認策略在牛市、熊市、震盪各種市場狀態下都能獲利。

- 🎲 **[Monte Carlo](./validation_montecarlo.md)**
  打亂交易順序 10,000 次，量化最壞情況下的回撤和連敗風險。

---

## 🚀 快速使用

```bash
# 通用驗證工具（自動掃描 k_data/ 下所有幣種）
node backtests/tests/validation/bt_validate_universal.js

# 指定幣種
node backtests/tests/validation/bt_validate_universal.js BTCUSDT ETHUSDT

# 指定時間範圍
node backtests/tests/validation/bt_validate_universal.js BTCUSDT --start=2025-01-01 --end=2026-04-01

# 只跑蒙地卡羅（快速風險評估）
node backtests/tests/validation/bt_validate_universal.js BTCUSDT --mc-only

# 跳過蒙地卡羅（只跑四層驗證）
node backtests/tests/validation/bt_validate_universal.js BTCUSDT --no-mc
```

---

## 通過標準速查

| 驗證方法 | 通過門檻 | 說明 |
|---------|---------|------|
| Walk-Forward | ≥ 70% 段落獲利 | 5段中至少4段 OOS 獲利 |
| CPCV | ≥ 4/6 段獲利 | 6折中至少4折獲利 |
| Deflated Sharpe | DSR > 0 | 校正後仍有正期望值 |
| Regime Analysis | ≥ 3/4 季獲利 | 各市場狀態適應性 |
| Monte Carlo | 回撤 < 本金 50% | 95th 最大回撤評估 |

---

## 驗證流程建議

1. 先跑 `bt_validate_universal.js` 取得完整報告
2. 若 Walk-Forward 或 CPCV 不通過 → 策略可能過擬合，重新調整參數
3. 若 DSR ≤ 0 → 參數掃描次數太多，選擇偏差嚴重
4. 蒙地卡羅的 95th 回撤 × 3 = 建議最低本金
