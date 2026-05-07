/**
 * Loop A 六層驗證 Runner
 * 幣種：BTCUSDT、ETHUSDT（XAUUSDT 資料不足，略過）
 *
 * 使用方式：
 *   node backtests/validation/run_loopA.js
 *   node backtests/validation/run_loopA.js --symbol BTCUSDT
 */

import { runValidation, monteCarlo } from './engine.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI 參數 ─────────────────────────────────────────────────
const args      = process.argv.slice(2);
const symbolArg = args.find(a => a.startsWith('--symbol='))?.split('=')[1]
               || (args.indexOf('--symbol') !== -1 ? args[args.indexOf('--symbol') + 1] : null);
const paramsArg = args.find(a => a.startsWith('--params='))?.split('=')[1]
               || (args.indexOf('--params') !== -1 ? args[args.indexOf('--params') + 1] : null);
const ALL_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const symbols     = symbolArg ? [symbolArg.toUpperCase()] : ALL_SYMBOLS;

function loadParamOverrides() {
    if (!paramsArg) return {};
    try {
        const raw = JSON.parse(readFileSync(resolve(process.cwd(), paramsArg), 'utf8'));
        const changes = raw.paramChanges || raw;
        const overrides = {};
        for (const [param, change] of Object.entries(changes || {})) {
            overrides[param] = change && typeof change === 'object' && 'to' in change ? change.to : change;
        }
        return overrides;
    } catch (e) {
        console.warn(`⚠️ 參數覆寫讀取失敗：${e.message}`);
        return {};
    }
}

let PARAM_OVERRIDES = loadParamOverrides();

// ── 資料載入 ─────────────────────────────────────────────────
function loadKData(symbol, interval) {
    const p = resolve(__dirname, `../../k_data/${symbol}/${symbol}_${interval}.json`);
    if (!existsSync(p)) throw new Error(`找不到資料：${p}`);
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    return raw.candles.map(c => [c.t, c.o, c.h, c.l, c.c, c.v]);
}

// ── 指標函數 ─────────────────────────────────────────────────
function ema(closes, period) {
    if (closes.length < period) return closes[closes.length - 1];
    const k = 2 / (period + 1);
    let val = closes[0];
    for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
    return val;
}

function rsi(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let g = 0, l = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) g += d; else l -= d;
    }
    const ag = g / period, al = l / period;
    return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

function rsiTriple(closes) {
    const r6 = rsi(closes, 6), r12 = rsi(closes, 12), r24 = rsi(closes, 24);
    const prev = closes.slice(0, -1);
    return {
        r6, r12, r24,
        goldenCross: rsi(prev, 12) < rsi(prev, 24) && r12 >= r24,
        deathCross:  rsi(prev, 12) > rsi(prev, 24) && r12 <= r24,
        bullAlign:   r6 > r12 && r12 > r24 && r24 > 50,
        bearAlign:   r6 < r12 && r12 < r24 && r24 < 50,
    };
}

function macd(closes) {
    if (closes.length < 35) return { hist: 0, crossUp: false, crossDown: false };
    const series = closes.slice(-35).map((_, i, arr) =>
        ema(arr.slice(0, i + 1), 12) - ema(arr.slice(0, i + 1), 26));
    const line   = ema(closes, 12) - ema(closes, 26);
    const signal = ema(series, 9);
    return {
        hist:      line - signal,
        crossUp:   series[series.length - 2] < signal && line >= signal,
        crossDown: series[series.length - 2] > signal && line <= signal,
    };
}

function bollingerBands(closes, period = 20, mult = 2) {
    if (closes.length < period) return { pct: 0.5, width: 0 };
    const slice = closes.slice(-period);
    const mid   = slice.reduce((a, b) => a + b, 0) / period;
    const stdv  = Math.sqrt(slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
    const upper = mid + mult * stdv, lower = mid - mult * stdv;
    const cur   = closes[closes.length - 1];
    return { upper, mid, lower, width: (upper - lower) / mid, pct: (cur - lower) / (upper - lower) };
}

function atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = candles.slice(-period - 1).map((c, i, arr) => {
        if (i === 0) return parseFloat(c[2]) - parseFloat(c[3]);
        const h = parseFloat(c[2]), l = parseFloat(c[3]), pc = parseFloat(arr[i - 1][4]);
        return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

function avgVolume(candles, period = 20) {
    return candles.slice(-period - 1, -1).reduce((a, c) => a + parseFloat(c[5] || 0), 0) / period;
}

// 二分搜尋：找最後一個 timestamp <= ts 的 index
function upperIdx(tsArr, ts) {
    let lo = 0, hi = tsArr.length - 1, res = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tsArr[mid] <= ts) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
}

// ── 四層過濾邏輯（對應現行 Loop A v3）─────────────────────────

function check4hFilter(candles4h, side) {
    if (!candles4h || candles4h.length < 95) return false;
    const closes = candles4h.map(c => parseFloat(c[4]));
    const n      = closes.length;
    const cur    = closes[n - 1];
    const ema89v = ema(closes, 89);
    const rsi14v = rsi(closes, 14);
    const rsi4hLongMin = Number(PARAM_OVERRIDES.rsi4hLongMin ?? 55);
    const rsi4hShortMax = Number(PARAM_OVERRIDES.rsi4hShortMax ?? 45);

    if (side === 'LONG') {
        // 主路徑：RSI > 55 + 在 EMA89 上方
        if (rsi14v > rsi4hLongMin && cur > ema89v) return true;
        // 備用路徑：RSI 底部反轉
        const rsiPrev2 = rsi(closes.slice(0, n - 2), 14);
        const rsiPrev1 = rsi(closes.slice(0, n - 1), 14);
        const wasOversold = rsiPrev2 < 40 && rsiPrev1 < 40;
        const rsiRising   = rsi14v > rsiPrev1 && rsiPrev1 > rsiPrev2;
        return wasOversold && rsiRising && cur > ema89v;
    }
    return rsi14v < rsi4hShortMax && cur < ema89v;
}

function check1hMomentum(candles1h, side) {
    if (!candles1h || candles1h.length < 90) return false;
    const closes = candles1h.map(c => parseFloat(c[4]));
    const vols   = candles1h.map(c => parseFloat(c[5] || 0));
    const avg20  = avgVolume(candles1h, 20);
    const curVol = vols[vols.length - 1];
    const ema34v = ema(closes, 34);
    const ema89v = ema(closes, 89);
    const curRsi = rsi(closes, 14);
    const rsi1hLongMin = Number(PARAM_OVERRIDES.rsi1hLongMin ?? 52);
    const rsi1hShortMax = Number(PARAM_OVERRIDES.rsi1hShortMax ?? 48);
    const volumeMultiplier = Number(PARAM_OVERRIDES.volumeMultiplier ?? 1.4);
    const past5  = [5, 4, 3, 2, 1].map(off => rsi(closes.slice(0, closes.length - off), 14));
    if (side === 'LONG')
        return ema34v > ema89v && curRsi > rsi1hLongMin && past5.some(r => r < 50) && curVol > avg20 * volumeMultiplier;
    return ema34v < ema89v && curRsi < rsi1hShortMax && past5.some(r => r > 50) && curVol > avg20 * volumeMultiplier;
}

function detectBreakout(candles) {
    if (!candles || candles.length < 30) return { pass: false };
    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || 0));
    const cur = closes[closes.length - 1], curVol = vols[vols.length - 1];
    const avgVol20 = avgVolume(candles, 20), atr14 = atr(candles, 14);
    const rsi14 = rsi(closes, 14);
    const ema20 = ema(closes, 20), ema50 = ema(closes, 50);
    const recentHigh = Math.max(...highs.slice(-20, -1));
    const recentLow  = Math.min(...lows.slice(-20, -1));
    const curOpen = opens[opens.length - 1];
    const prevOpen = opens[opens.length - 2], prevClose = closes[closes.length - 2];
    let score = 0;
    const hasBOS     = cur > recentHigh;
    const isBull     = cur > curOpen;
    const hasEmaAlign = cur > ema20 && ema20 > ema50;
    if (hasBOS) score += 3;
    if (isBull && curVol > avgVol20 * 1.5) score += 2;
    if (rsi14 > 55 && rsi14 > rsi(closes.slice(0, -1), 14)) score += 2;
    if (hasEmaAlign) score += 1;
    const body      = Math.abs(cur - curOpen);
    const lowerWick = Math.min(cur, curOpen) - lows[lows.length - 1];
    const upperWick = highs[highs.length - 1] - Math.max(cur, curOpen);
    if (lowerWick > body * 2 && upperWick < body * 0.5 && isBull) score += 1;
    if (prevClose < prevOpen && isBull && cur > prevOpen && curOpen < prevClose) score += 2;
    if (vols.slice(-4, -1).every(v => v < avgVol20) && curVol > avgVol20 * 2) score += 2;
    if (!hasBOS && !hasEmaAlign) return { pass: false };
    const stage1Threshold = Number(PARAM_OVERRIDES.stage1Threshold ?? 5);
    if (score < stage1Threshold) return { pass: false };
    const sl = recentLow - atr14 * 0.5;
    const slMaxPct = Number(PARAM_OVERRIDES.slMaxPct ?? 4);
    if ((cur - sl) / cur * 100 > slMaxPct) return { pass: false };
    const risk = cur - sl;
    return { pass: true, type: 'LONG', price: cur, sl, tp1: cur + risk, tp2: cur + risk * 1.618, tp3: cur + risk * 2.618 };
}

function detectBreakdown(candles) {
    if (!candles || candles.length < 30) return { pass: false };
    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || 0));
    const cur = closes[closes.length - 1], curVol = vols[vols.length - 1];
    const avgVol20 = avgVolume(candles, 20), atr14 = atr(candles, 14);
    const rsi14 = rsi(closes, 14);
    const ema20v = ema(closes, 20), ema50v = ema(closes, 50);
    const recentHigh = Math.max(...highs.slice(-20, -1));
    const recentLow  = Math.min(...lows.slice(-20, -1));
    const curOpen = opens[opens.length - 1];
    const prevOpen = opens[opens.length - 2], prevClose = closes[closes.length - 2];
    let score = 0;
    const hasBOS     = cur < recentLow;
    const isBear     = cur < curOpen;
    const hasEmaAlign = cur < ema20v && ema20v < ema50v;
    if (hasBOS) score += 3;
    if (isBear && curVol > avgVol20 * 1.5) score += 2;
    if (rsi14 < 45 && rsi14 < rsi(closes.slice(0, -1), 14)) score += 2;
    if (hasEmaAlign) score += 1;
    const body      = Math.abs(cur - curOpen);
    const upperWick = highs[highs.length - 1] - Math.max(cur, curOpen);
    const lowerWick = Math.min(cur, curOpen) - lows[lows.length - 1];
    if (upperWick > body * 2 && lowerWick < body * 0.5 && isBear) score += 1;
    if (prevClose > prevOpen && isBear && curOpen >= prevClose && cur <= prevOpen) score += 2;
    if (vols.slice(-4, -1).every(v => v < avgVol20) && curVol > avgVol20 * 2 && isBear) score += 2;
    if (!hasBOS && !hasEmaAlign) return { pass: false };
    const stage1Threshold = Number(PARAM_OVERRIDES.stage1Threshold ?? 5);
    if (score < stage1Threshold) return { pass: false };
    if (rsi14 < 35) return { pass: false };
    const sl = recentHigh + atr14 * 0.5;
    const slMaxPct = Number(PARAM_OVERRIDES.slMaxPct ?? 4);
    if ((sl - cur) / cur * 100 > slMaxPct) return { pass: false };
    const risk = sl - cur;
    return { pass: true, type: 'SHORT', price: cur, sl, tp1: cur - risk, tp2: cur - risk * 1.618, tp3: cur - risk * 2.618 };
}

function secondStageFilter(candles1h, candles15m, side) {
    if (!candles1h || !candles15m) return false;
    const closes1h  = candles1h.map(c => parseFloat(c[4]));
    const closes15m = candles15m.map(c => parseFloat(c[4]));
    const rsiT  = rsiTriple(closes1h);
    const macdV = macd(closes15m);
    const bb    = bollingerBands(closes15m);
    let score = 0;
    if (side === 'LONG') {
        if (rsiT.r24 > 50)    score += 2;
        if (rsiT.goldenCross) score += 3;
        if (rsiT.bullAlign)   score += 2;
        if (macdV.hist > 0)   score += 2;
        if (macdV.crossUp)    score += 3;
        if (bb.pct > 0.5)     score += 1;
        if (bb.pct < 0.2 && bb.width < 0.05) score += 2;
    } else {
        if (rsiT.r24 < 50)    score += 2;
        if (rsiT.deathCross)  score += 3;
        if (rsiT.bearAlign)   score += 2;
        if (macdV.hist < 0)   score += 2;
        if (macdV.crossDown)  score += 3;
        if (bb.pct < 0.5)     score += 1;
        if (bb.pct > 0.8 && bb.width < 0.05) score += 2;
    }
    return score >= 5;
}

function simulateExit(signal, futureCandles) {
    const { type, price, sl, tp1, tp2, tp3 } = signal;
    const isShort = type === 'SHORT';

    // 模擬實際出場邏輯：TP1 後 SL 移至保本，繼續等 TP3
    // 各 TP 佔倉位比例：TP1=50%, TP3=50%（對應實盤分批平倉）
    let currentSl = sl;
    let tp1Hit    = false;

    for (const c of futureCandles) {
        const h = parseFloat(c[2]), l = parseFloat(c[3]), ts = parseInt(c[0]);

        if (isShort) {
            // 止損優先
            if (h >= currentSl) {
                if (tp1Hit) {
                    // TP1 後保本出場：剩餘 50% 以保本價（entry）出場，整體算 TP1 的一半
                    const pnl = (price - tp1) / price * 100 * 0.5;
                    return { result: 'TP1_BE', pnlPct: pnl, exitTs: ts };
                }
                return { result: 'SL', pnlPct: -Math.abs((price - currentSl) / price * 100), exitTs: ts };
            }
            // TP3 出場（剩餘 50%）
            if (tp1Hit && l <= tp3) {
                const pnl = (price - tp1) / price * 100 * 0.5 + (price - tp3) / price * 100 * 0.5;
                return { result: 'TP3', pnlPct: pnl, exitTs: ts };
            }
            // TP1 首次觸及：出場 50%，SL 移至保本
            if (!tp1Hit && l <= tp1) {
                tp1Hit    = true;
                currentSl = price; // 移 SL 到保本
            }
        } else {
            // 止損優先
            if (l <= currentSl) {
                if (tp1Hit) {
                    const pnl = (tp1 - price) / price * 100 * 0.5;
                    return { result: 'TP1_BE', pnlPct: pnl, exitTs: ts };
                }
                return { result: 'SL', pnlPct: -Math.abs((currentSl - price) / price * 100), exitTs: ts };
            }
            // TP3 出場（剩餘 50%）
            if (tp1Hit && h >= tp3) {
                const pnl = (tp1 - price) / price * 100 * 0.5 + (tp3 - price) / price * 100 * 0.5;
                return { result: 'TP3', pnlPct: pnl, exitTs: ts };
            }
            // TP1 首次觸及：出場 50%，SL 移至保本
            if (!tp1Hit && h >= tp1) {
                tp1Hit    = true;
                currentSl = price; // 移 SL 到保本
            }
        }
    }
    // 超出 futureCandles 範圍仍未出場
    if (tp1Hit) {
        // 已打 TP1，剩餘 50% 以最後收盤價結算
        const lastClose = parseFloat(futureCandles[futureCandles.length - 1][4]);
        const pnl = isShort
            ? (price - tp1) / price * 100 * 0.5 + (price - lastClose) / price * 100 * 0.5
            : (tp1 - price) / price * 100 * 0.5 + (lastClose - price) / price * 100 * 0.5;
        return { result: 'TP1_OPEN', pnlPct: pnl, exitTs: null };
    }
    return { result: 'OPEN', pnlPct: 0, exitTs: null };
}

// ── 策略工廠 ─────────────────────────────────────────────────
export function makeStrategy(symbol) {
    return {
        name: `loopA_v3_${symbol}`,

        loadData() {
            const candles15 = loadKData(symbol, '15m');
            const candles1h = loadKData(symbol, '1h');
            return { candles15, candles4h: candles1h };  // engine 的 candles4h 欄位傳入 1h
        },

        calibrate() { return {}; },

        run(candles15, candles1h, _params, startTs, endTs) {
            const trades     = [];
            const lastExit   = { LONG: 0, SHORT: 0 };
            const FEE_RATE   = 0.0019;
            const PRE        = 100;

            let candles4h;
            try { candles4h = loadKData(symbol, '4h'); } catch (e) { candles4h = null; }

            const ts1h = candles1h.map(c => parseInt(c[0]));
            const ts4h = candles4h ? candles4h.map(c => parseInt(c[0])) : null;

            for (let i = PRE; i < candles15.length - 1; i++) {
                const ts = parseInt(candles15[i][0]);
                if (ts < startTs || ts > endTs) continue;

                for (const side of ['LONG', 'SHORT']) {
                    if (ts <= lastExit[side]) continue;

                    // Layer 0：4h 結構確認
                    if (candles4h && ts4h) {
                        const e4 = upperIdx(ts4h, ts);
                        if (e4 < 0) continue;
                        if (!check4hFilter(candles4h.slice(Math.max(0, e4 - 99), e4 + 1), side)) continue;
                    }

                    // Layer 1：1h 動能
                    const e1 = upperIdx(ts1h, ts);
                    if (e1 < 0) continue;
                    if (!check1hMomentum(candles1h.slice(Math.max(0, e1 - 89), e1 + 1), side)) continue;

                    // Layer 2：15m 形態
                    const sl15 = candles15.slice(Math.max(0, i - 99), i + 1);
                    const sig  = side === 'LONG' ? detectBreakout(sl15) : detectBreakdown(sl15);
                    if (!sig.pass) continue;

                    // Layer 3：指標共振
                    if (!secondStageFilter(
                        candles1h.slice(Math.max(0, e1 - 59), e1 + 1),
                        sl15, side)) continue;

                    const exit = simulateExit(sig, candles15.slice(i + 1, i + 97));
                    if (exit.result === 'OPEN') continue;

                    const netPnl = exit.pnlPct - FEE_RATE * 2 * 100;
                    lastExit[side] = exit.exitTs;
                    trades.push({ entryTs: ts, exitTs: exit.exitTs, pnlPct: netPnl, side, result: exit.result });
                }
            }
            return trades;
        }
    };
}

// ── 主程式 ───────────────────────────────────────────────────
export async function runLoopAValidation(opts = {}) {
const runSymbols = (opts.symbols || symbols).map(s => s.toUpperCase());
const previousOverrides = PARAM_OVERRIDES;
PARAM_OVERRIDES = opts.paramOverrides || PARAM_OVERRIDES;

console.log('═'.repeat(70));
console.log('Loop A v3  六層驗證 + Monte Carlo');
console.log(`幣種：${runSymbols.join(', ')}`);
if (Object.keys(PARAM_OVERRIDES).length > 0) {
    console.log(`參數覆寫：${JSON.stringify(PARAM_OVERRIDES)}`);
}
console.log('═'.repeat(70));

const summaryRows = [];

for (const symbol of runSymbols) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`▶ ${symbol}`);

    try {
        const strategy = makeStrategy(symbol);
        const report   = await runValidation(strategy, {
            nWFFolds:       5,
            nCPCVGroups:    4,
            permSimulations: 1000,
        });

        // Monte Carlo（10,000 次）
        console.log('\n🎲 Monte Carlo 10,000 次...');
        const mc = monteCarlo(report._allTrades ?? [], 10000, 3);
        if (mc) {
            console.log(`   爆倉機率: ${mc.ruinProbability}%   獲利機率: ${mc.profitProbability}%`);
            console.log(`   最大回撤 P95: ${mc.maxDrawdown.p95}%   損益中位數: ${mc.finalEquity.median}U / 3U 本金`);
        }

        const v = report.verdict;
        summaryRows.push({
            symbol,
            trades:    report.baseTrades,
            winRate:   report.baseWinRate,
            sharpe:    report.baseSharpe,
            passCount: v.passCount,
            total:     v.totalLayers,
            verdict:   v.conclusion,
            dsr:       v.layers?.[0] ?? false,
            wfv:       v.layers?.[1] ?? false,
            regime:    v.layers?.[2] ?? false,
            cpcv:      v.layers?.[3] ?? false,
            perm:      v.layers?.[4] ?? '-',
            mc_ruin:   mc?.ruinProbability  ?? '-',
            mc_profit: mc?.profitProbability ?? '-',
            mc_dd_p95: mc?.maxDrawdown?.p95  ?? '-',
            mc_eq_med: mc?.finalEquity?.median ?? '-',
            wfv_folds: report.wfv?.folds ?? [],
            regime_stats: report.regime ?? {},
            cpcv_positive: report.cpcv?.positive_pct ?? '-',
            cpcv_sharpe:   report.cpcv?.sharpe_median ?? '-',
            perm_pvalue:   report.permutation?.pValue ?? '-',
        });
    } catch (e) {
        console.error(`  ❌ ${symbol} 驗證失敗：${e.message}`);
        summaryRows.push({ symbol, verdict: 'ERROR', error: e.message });
    }
}

// ── 總結表 ────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log('【六層驗證 + Monte Carlo 總結】');
console.log(
    `${'幣種'.padEnd(10)} ${'訊號'.padStart(5)} ${'勝率'.padStart(7)} ${'Sharpe'.padStart(8)} ` +
    `${'通過'.padStart(6)} ${'DSR'.padStart(4)} ${'WFV'.padStart(4)} ${'Regime'.padStart(7)} ` +
    `${'CPCV'.padStart(6)} ${'排列'.padStart(5)} ${'爆倉%'.padStart(6)} ${'DD_P95'.padStart(7)} ${'EQ中位'.padStart(7)}`
);
console.log('─'.repeat(80));

for (const r of summaryRows) {
    if (r.verdict === 'ERROR') { console.log(`${r.symbol.padEnd(10)} ❌ ${r.error}`); continue; }
    const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'MARGINAL' ? '⚠️' : '❌';
    console.log(
        `${r.symbol.padEnd(10)} ${String(r.trades).padStart(5)} ${(r.winRate + '%').padStart(7)} ` +
        `${r.sharpe.toFixed(3).padStart(8)} ${(r.passCount + '/' + r.total).padStart(5)}${icon} ` +
        `${(r.dsr ? '✅' : '❌').padStart(4)} ${(r.wfv ? '✅' : '❌').padStart(4)} ` +
        `${(r.regime ? '✅' : '❌').padStart(7)} ${(r.cpcv ? '✅' : '❌').padStart(6)} ` +
        `${(r.perm === true ? '✅' : r.perm === false ? '❌' : '-').padStart(5)} ` +
        `${String(r.mc_ruin + '%').padStart(6)} ${String(r.mc_dd_p95 + '%').padStart(7)} ${String(r.mc_eq_med + 'U').padStart(7)}`
    );
}

// ── CSV 輸出 ──────────────────────────────────────────────────
if (opts.writeCsv !== false) {
const symbolTag = summaryRows.map(r => r.symbol).join('_');
const csvPath   = resolve(__dirname, `results/loopA_${symbolTag}.csv`);
const csvLines  = ['\ufeff'];

// 1. 摘要
csvLines.push('=== 六層驗證摘要 ===');
csvLines.push('幣種,訊號數,勝率%,夏普比率,通過層數,驗證結論,DSR,WFV,市況,CPCV,排列測試,排列p值,爆倉機率%,獲利機率%,回撤P95%,損益中位數,CPCV正向%,CPCV夏普中位');
for (const r of summaryRows) {
    if (r.verdict === 'ERROR') { csvLines.push(`${r.symbol},ERROR`); continue; }
    const zh = r.verdict === 'PASS' ? '通過' : r.verdict === 'MARGINAL' ? '邊緣' : '不通過';
    csvLines.push([
        r.symbol, r.trades, r.winRate, r.sharpe, `${r.passCount}/${r.total}`, zh,
        r.dsr ? 1 : 0, r.wfv ? 1 : 0, r.regime ? 1 : 0, r.cpcv ? 1 : 0,
        r.perm === true ? 1 : r.perm === false ? 0 : '-', r.perm_pvalue,
        r.mc_ruin, r.mc_profit, r.mc_dd_p95, r.mc_eq_med,
        r.cpcv_positive, r.cpcv_sharpe
    ].join(','));
}

// 2. WFV 明細
csvLines.push('', '=== Walk-Forward 各段明細 ===');
csvLines.push('幣種,第幾段,驗證期間,訊號數,勝率%,期望值,夏普比率,最大回撤');
for (const r of summaryRows) {
    if (r.verdict === 'ERROR') continue;
    for (const f of r.wfv_folds) {
        csvLines.push([r.symbol, `第${f.fold}段`, f.period, f.trades, f.winRate, f.expectancy, f.sharpe, f.maxDD].join(','));
    }
}

// 3. Regime 明細
csvLines.push('', '=== 市況分析明細 ===');
csvLines.push('幣種,市況,訊號數,勝率%,期望值,夏普比率,累計損益');
for (const r of summaryRows) {
    if (r.verdict === 'ERROR') continue;
    const zh = { BULL: '牛市', BEAR: '熊市', RANGING: '震盪', UNKNOWN: '不明' };
    for (const [regime, s] of Object.entries(r.regime_stats)) {
        csvLines.push([r.symbol, zh[regime] ?? regime, s.trades, s.winRate, s.expectancy, s.sharpe, s.totalPnl].join(','));
    }
}

writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
console.log(`\n📄 CSV 已儲存：${csvPath}`);
}

PARAM_OVERRIDES = previousOverrides;
return summaryRows;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await runLoopAValidation();
}
