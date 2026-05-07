# Deflated Sharpe Ratio & CPCV

---

## Deflated Sharpe Ratio（DSR）

### 目的

校正**多次參數掃描**造成的選擇偏差。

跑了幾十種參數組合後選出最好的，這個「最好」有一部分是運氣。DSR 把這個偏差扣掉，確認策略有真正的統計顯著性。

### 核心概念

```
原始 SR = 平均損益 / 損益標準差 × √N

DSR = SR - 期望最大 SR（基於試驗次數）

若 DSR > 0：策略在扣除選擇偏差後仍有正期望值
若 DSR ≤ 0：策略的好表現可能只是運氣
```

試驗次數越多，懲罰越重。跑了 20 種參數組合，DSR 的懲罰比只跑 1 種大很多。

### 執行方式

```bash
node backtests/tests/validation/bt_validate_universal.js BTCUSDT
node backtests/tests/validation/bt_deflated_sharpe.js
```

### 輸出範例

```
【Deflated Sharpe】SR=5.82  DSR=4.55  ✅ 非過擬合
```

### 通過標準

- DSR > 0：策略有效（信心程度視 DSR 大小而定）
- DSR > 1：策略穩健
- DSR ≤ 0：可能過擬合，謹慎使用

### 注意事項

- 本實作假設試驗次數約 20 次（參數掃描的估計值）
- 樣本數 < 30 筆時，SR 計算不穩定
- DSR 是相對指標，不代表絕對獲利能力

---

## CPCV（組合清洗交叉驗證）

### 目的

比 Walk-Forward 更全面地評估策略在**各種時間段組合**下的穩定性。

### 核心概念

```
把全年切成 6 段：
  ├─ 1月~2月 ─┤ 3月~4月 ─┤ 5月~6月 ─┤ 7月~8月 ─┤ 9月~10月 ─┤ 11月~12月 ─┤

每段輪流當驗證集，其餘 5 段當訓練集
共 6 次驗證，統計獲利次數
```

與 Walk-Forward 的差異：Walk-Forward 是「前訓後驗」，CPCV 是「每段都驗一次」，覆蓋更全面。

### 執行方式

```bash
node backtests/tests/validation/bt_validate_universal.js BTCUSDT
node backtests/tests/validation/bt_cpcv.js
```

### 輸出範例

```
【CPCV 6-fold】6/6 段獲利  ✅
  12月:+6.8U(60.0%)  03月:+20.5U(80.0%)  06月:+27.6U(81.0%)
  08月:+20.5U(80.0%)  10月:+20.6U(78.6%)  01月:+0.1U(54.5%)
```

### 通過標準

- ≥ 4/6 段獲利
- 沒有單段大幅虧損（> -20U）

### 注意事項

- 每段至少需要 3 筆交易才有參考價值
- 某段訊號數為 0 時，該段跳過不計入通過/失敗
- 資料少於 3 個月時，6 折切割會讓每段太短，結果不可靠
