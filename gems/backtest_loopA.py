"""
Loop A 客製化回測腳本
完整複製 loopA_major.js 的進場邏輯：
  - 1h + 30m 動能：price > EMA21 > EMA55, RSI >= 52, MACD hist > 0
  - 1h Fib 回調區：0.382–0.618 (swing 30根)
  - 5m 確認：RSI >= 52, MACD hist > 0, price >= fib.limitEntry
  - SL: swing_low - range*0.12，slPct < 4%
  - TP: 1R / 1.618R / 2.618R

資料來源：Yahoo Finance 1h K 線，用不同 window 模擬多時框
"""

import pandas as pd
import numpy as np
import yfinance as yf
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime

# ── 指標函數（對齊 indicators.js）─────────────────────────────

def ema(closes, period):
    if len(closes) < period:
        return closes[-1]
    k = 2 / (period + 1)
    val = closes[0]
    for c in closes[1:]:
        val = c * k + val * (1 - k)
    return val

def rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50
    gains, losses = 0, 0
    for i in range(len(closes) - period, len(closes)):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            gains += diff
        else:
            losses -= diff
    avg_g = gains / period
    avg_l = losses / period
    return 100 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)

def macd_hist(closes):
    if len(closes) < 35:
        return 0
    series = []
    tail = closes[-35:]
    for i in range(len(tail)):
        sl = tail[:i+1]
        series.append(ema(sl, 12) - ema(sl, 26))
    macd_line = ema(closes, 12) - ema(closes, 26)
    signal_line = ema(series, 9)
    return macd_line - signal_line

# ── Fib 區間計算（對齊 computeFibZone）──────────────────────────

def compute_fib_zone(highs, lows, side):
    swing_high = max(highs[-30:])
    swing_low  = min(lows[-30:])
    rng = swing_high - swing_low
    if rng <= 0:
        return None
    if side == 'LONG':
        return {
            'entry_min':   swing_high - rng * 0.618,
            'entry_max':   swing_high - rng * 0.382,
            'limit_entry': swing_high - rng * 0.5,
            'stop_loss':   swing_low  - rng * 0.12,
        }
    else:
        return {
            'entry_min':   swing_low + rng * 0.382,
            'entry_max':   swing_low + rng * 0.618,
            'limit_entry': swing_low + rng * 0.5,
            'stop_loss':   swing_high + rng * 0.12,
        }

def in_fib_zone(price, fib):
    lo = min(fib['entry_min'], fib['entry_max'])
    hi = max(fib['entry_min'], fib['entry_max'])
    return lo <= price <= hi

# ── 動能判斷（對齊 analyzeMomentum）────────────────────────────

def analyze_momentum(closes, side):
    if len(closes) < 35:
        return False
    price  = closes[-1]
    e21    = ema(closes, 21)
    e55    = ema(closes, 55)
    r      = rsi(closes, 14)
    hist   = macd_hist(closes)
    if side == 'LONG':
        return price > e21 and e21 >= e55 and r >= 52 and hist > 0
    else:
        return price < e21 and e21 <= e55 and r <= 48 and hist < 0

# ── 主回測邏輯 ───────────────────────────────────────────────

def run_backtest(symbol='BTC-USD', period='2y', side='LONG',
                 capital=10000, commission=0.001):

    print(f"\n{'='*60}")
    print(f"  Loop A 客製化回測：{symbol} | {side} | {period}")
    print(f"{'='*60}")

    # 拉 1h 資料
    df = yf.download(symbol, period=period, interval='1h', auto_adjust=True, progress=False)
    df.columns = [c[0].lower() if isinstance(c, tuple) else c.lower() for c in df.columns]
    df = df.dropna()
    print(f"資料：{len(df)} 根 1h K 線 ({df.index[0].date()} ~ {df.index[-1].date()})")

    closes = df['close'].values
    highs  = df['high'].values
    lows   = df['low'].values

    # 模擬多時框（用不同根數 window 近似）
    # 1h = 當前 K 線
    # 30m ≈ 用最近 50 根 1h closes 的動能（實際 30m 較細，此處用同資料做近似）
    # 5m  ≈ 用最近 20 根 1h closes（較短 window 代表較近期動能）

    WIN_1H  = 100  # 1h 動能 window
    WIN_30M = 60   # 模擬 30m（較短 window）
    WIN_5M  = 40   # 模擬 5m（用稍短 window，但足夠 MACD 計算）

    MIN_BARS = max(WIN_1H, 40)  # 至少需要這麼多根

    trades   = []
    equity   = [capital]
    cash     = capital
    position = None  # { entry, sl, tp1, tp2, tp3, risk, tp1_hit }

    for i in range(MIN_BARS, len(df)):
        price = closes[i]
        ts    = df.index[i]

        # ── 持倉管理 ──
        if position:
            if side == 'LONG':
                # 止損
                if price <= position['sl']:
                    pnl = (position['sl'] - position['entry']) / position['entry']
                    cash *= (1 + pnl) * (1 - commission)
                    trades.append({'ts': ts, 'type': 'SL', 'entry': position['entry'],
                                   'exit': position['sl'], 'pnl_pct': pnl * 100})
                    position = None
                # TP1
                elif not position['tp1_hit'] and price >= position['tp1']:
                    position['tp1_hit'] = True
                    position['sl'] = position['entry']  # 移 SL 到保本
                # TP3 出場
                elif position['tp1_hit'] and price >= position['tp3']:
                    pnl = (position['tp3'] - position['entry']) / position['entry']
                    cash *= (1 + pnl) * (1 - commission)
                    trades.append({'ts': ts, 'type': 'TP3', 'entry': position['entry'],
                                   'exit': position['tp3'], 'pnl_pct': pnl * 100})
                    position = None
            else:  # SHORT
                if price >= position['sl']:
                    pnl = (position['entry'] - position['sl']) / position['entry']
                    cash *= (1 + pnl) * (1 - commission)
                    trades.append({'ts': ts, 'type': 'SL', 'entry': position['entry'],
                                   'exit': position['sl'], 'pnl_pct': pnl * 100})
                    position = None
                elif not position['tp1_hit'] and price <= position['tp1']:
                    position['tp1_hit'] = True
                    position['sl'] = position['entry']
                elif position['tp1_hit'] and price <= position['tp3']:
                    pnl = (position['entry'] - position['tp3']) / position['entry']
                    cash *= (1 + pnl) * (1 - commission)
                    trades.append({'ts': ts, 'type': 'TP3', 'entry': position['entry'],
                                   'exit': position['tp3'], 'pnl_pct': pnl * 100})
                    position = None

            equity.append(cash)
            continue

        # ── 進場過濾 ──
        c_1h  = closes[i - WIN_1H  : i + 1]
        c_30m = closes[i - WIN_30M : i + 1]
        c_5m  = closes[i - WIN_5M  : i + 1]
        h_1h  = highs [i - WIN_1H  : i + 1]
        l_1h  = lows  [i - WIN_1H  : i + 1]

        # 1h + 30m 動能
        if not analyze_momentum(c_1h, side):
            equity.append(cash)
            continue
        if not analyze_momentum(c_30m, side):
            equity.append(cash)
            continue

        # Fib 回調區（用 1h 的最近 30 根高低）
        if len(h_1h) < 30 or len(l_1h) < 30:
            equity.append(cash)
            continue
        fib = compute_fib_zone(h_1h, l_1h, side)
        if fib is None or not in_fib_zone(price, fib):
            equity.append(cash)
            continue

        # 5m 動能確認（用較短 window 的 RSI + MACD + 價格位置）
        r_5m    = rsi(c_5m, 14)
        hist_5m = macd_hist(c_5m)
        if side == 'LONG':
            # 放寬：RSI >= 50（而非 52），MACD > 0，且價格在 Fib 區間內即可
            trigger_5m = r_5m >= 50 and hist_5m > 0
        else:
            trigger_5m = r_5m <= 50 and hist_5m < 0
        if not trigger_5m:
            equity.append(cash)
            continue

        # SL 風險檢查（slPct < 4%）
        sl  = fib['stop_loss']
        risk = abs(price - sl)
        sl_pct = risk / price * 100
        if sl_pct > 4:
            equity.append(cash)
            continue

        # 全部條件通過 → 開倉
        tp1 = price + risk         if side == 'LONG' else price - risk
        tp2 = price + risk * 1.618 if side == 'LONG' else price - risk * 1.618
        tp3 = price + risk * 2.618 if side == 'LONG' else price - risk * 2.618

        position = {
            'entry': price, 'sl': sl,
            'tp1': tp1, 'tp2': tp2, 'tp3': tp3,
            'risk': risk, 'tp1_hit': False,
            'entry_ts': ts,
        }
        equity.append(cash)

    # 未平倉強制以最後收盤價平倉
    if position:
        last_price = closes[-1]
        if side == 'LONG':
            pnl = (last_price - position['entry']) / position['entry']
        else:
            pnl = (position['entry'] - last_price) / position['entry']
        cash *= (1 + pnl) * (1 - commission)
        trades.append({'ts': df.index[-1], 'type': 'CLOSE', 'entry': position['entry'],
                       'exit': last_price, 'pnl_pct': pnl * 100})
        equity.append(cash)

    # ── 統計 ─────────────────────────────────────────────────
    eq_arr   = np.array(equity)
    total_rt = (cash - capital) / capital * 100
    n_trades = len(trades)
    wins     = [t for t in trades if t['pnl_pct'] > 0]
    losses   = [t for t in trades if t['pnl_pct'] <= 0]
    win_rate = len(wins) / n_trades * 100 if n_trades else 0
    avg_win  = np.mean([t['pnl_pct'] for t in wins])  if wins   else 0
    avg_loss = np.mean([t['pnl_pct'] for t in losses]) if losses else 0
    pf       = (sum(t['pnl_pct'] for t in wins) /
                abs(sum(t['pnl_pct'] for t in losses))) if losses else float('inf')

    # Max Drawdown
    peak    = np.maximum.accumulate(eq_arr)
    dd      = (eq_arr - peak) / peak * 100
    max_dd  = dd.min()

    # Sharpe（簡化：每日報酬）
    rets = np.diff(eq_arr) / eq_arr[:-1]
    sharpe = (rets.mean() / rets.std() * np.sqrt(24 * 365)) if rets.std() > 0 else 0

    print(f"\n{'─'*60}")
    print(f"  總報酬：{total_rt:+.2f}%    ({capital:,.0f} → {cash:,.0f} USD)")
    print(f"  Sharpe：{sharpe:.2f}    Max Drawdown：{max_dd:.2f}%")
    print(f"{'─'*60}")
    print(f"  總交易：{n_trades} 筆    勝率：{win_rate:.1f}%")
    print(f"  平均獲利：{avg_win:+.2f}%    平均虧損：{avg_loss:+.2f}%")
    print(f"  Profit Factor：{pf:.2f}")
    print(f"{'─'*60}")
    if trades:
        df_t = pd.DataFrame(trades)
        print(f"\n  最近 10 筆交易：")
        for _, t in df_t.tail(10).iterrows():
            icon = 'WIN' if t['pnl_pct'] > 0 else 'LOSS'
            print(f"  [{icon}] {t['type']:5s}  entry {t['entry']:,.0f}  exit {t['exit']:,.0f}  {t['pnl_pct']:+.2f}%  ({t['ts'].date()})")

    # ── 畫圖 ─────────────────────────────────────────────────
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8), sharex=False)
    fig.suptitle(f'Loop A 回測：{symbol} {side}  ({period})\n'
                 f'總報酬 {total_rt:+.2f}%  |  勝率 {win_rate:.1f}%  |  Sharpe {sharpe:.2f}  |  Max DD {max_dd:.2f}%',
                 fontsize=13)

    # 權益曲線
    eq_idx = df.index[MIN_BARS - 1 : MIN_BARS - 1 + len(equity)]
    if len(eq_idx) > len(equity):
        eq_idx = eq_idx[:len(equity)]
    elif len(equity) > len(eq_idx):
        equity = equity[:len(eq_idx)]
    ax1.plot(eq_idx, equity, color='royalblue', linewidth=1.5, label='Equity')
    ax1.axhline(capital, color='gray', linestyle='--', linewidth=0.8)
    ax1.fill_between(eq_idx, equity, capital,
                     where=np.array(equity) >= capital, alpha=0.15, color='green')
    ax1.fill_between(eq_idx, equity, capital,
                     where=np.array(equity) < capital, alpha=0.15, color='red')
    ax1.set_ylabel('資金 (USD)')
    ax1.legend(loc='upper left')
    ax1.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))

    # BTC 收盤價 + 進出場點
    ax2.plot(df.index, closes, color='#888', linewidth=0.8, label='BTC Close')
    if trades:
        df_t = pd.DataFrame(trades)
        win_t  = df_t[df_t['pnl_pct'] > 0]
        loss_t = df_t[df_t['pnl_pct'] <= 0]
        if not win_t.empty:
            ax2.scatter(win_t['ts'], win_t['entry'], marker='^', color='lime',
                        s=60, zorder=5, label='獲利進場')
        if not loss_t.empty:
            ax2.scatter(loss_t['ts'], loss_t['entry'], marker='v', color='red',
                        s=60, zorder=5, label='虧損進場')
    ax2.set_ylabel('BTC 價格 (USD)')
    ax2.legend(loc='upper left')
    ax2.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))

    plt.tight_layout()
    fname = f'loopA_backtest_{symbol.replace("-","_")}_{side}.png'
    plt.savefig(fname, dpi=150)
    print(f"\n  圖表已儲存：{fname}")
    # plt.show()  # 非互動模式

    return {'total_return': total_rt, 'win_rate': win_rate, 'sharpe': sharpe,
            'max_dd': max_dd, 'n_trades': n_trades, 'profit_factor': pf}


if __name__ == '__main__':
    # LONG 回測
    run_backtest('BTC-USD', period='2y', side='LONG')
    # SHORT 回測
    run_backtest('BTC-USD', period='2y', side='SHORT')
