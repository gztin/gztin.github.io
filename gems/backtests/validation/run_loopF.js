/**
 * Loop F（穩定爬升）四層驗證 + 蒙地卡羅 Runner
 *
 * 策略邏輯：
 *   進場：15m K 線滿足 R² > 0.75 + 斜率向上 + 低點遞增 ≥ 2
 *   出場：SL -5%，TP1 +5%，TP2 +10%，TP3 +15%
 *   Regime 過濾：BTC 在 EMA200 以下時不開新倉（全局熊市保護）
 *
 * 使用方式：
 *   node backtests/validation/run_loopF.js
 *   node backtests/validation/run_loopF.js --symbol BTCUSDT
 *   node backtests/validation/run_loopF.js --no-regime   （關閉 Regime 過濾，對比用）
 */

import { runValidation, monteCarlo } from './engine.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI 參數 ─────────────────────────────────────────────────
const args        = process.argv.slice(2);
const symbolArg   = args.find(a => a.startsWith('--symbol='))?.split('=')[1]
                 || (args.indexOf('--symbol') !== -1 ? args[args.indexOf('--symbol') + 1] : null);
const noMC        = args.includes('--no-mc');
const noRegime    = args.includes('--no-regime');
const ALL_SYMBOLS = ['BTCUSDT', 'ETHUSDT'];
const symbols     = symbolArg ? [symbolArg.toUpperCase()] : ALL_SYMBOLS;

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

function atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = candles.slice(-period - 1).map((c, i, arr) => {
        if (i === 0) return parseFloat(c[2]) - parseFloat(c[3]);
        const h = parseFloat(c[2]), l = parseFloat(c[3]), pc = parseFloat(arr[i - 1][4]);
        return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

function upperIdx(tsArr, ts) {
    let lo = 0, hi = tsArr.length - 1, res = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tsArr[mid] <= ts) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
}

// ── 穩定爬升偵測（對應 loopF_rank.js 的 detectSteadyClimb）────
function detectSteadyClimb(candles) {
    if (!candles || candles.length < 20) return { steady: false };
    const closes = candles.slice(-20).map(c => parseFloat(c[4]));
    const lows   = candles.slice(-20).map(c => parseFloat(c[3]));
    const n = closes.length;

    const xMean = (n - 1) / 2;
    const yMean = closes.reduce((s, v) => s + v, 0) / n;
    let ssXY = 0, ssXX = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        ssXY += (i - xMean) * (closes[i] - yMean);
        ssXX += (i - xMean) ** 2;
        ssTot += (closes[i] - yMean) ** 2;
    }
    const slope = ssXX > 0 ? ssXY / ssXX : 0;
    const intercept = yMean - slope * xMean;
    let ssRes = 0;
    for (let i = 0; i < n; i++) ssRes += (closes[i] - (intercept + slope * i)) ** 2;
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const swingSize = 4;
    const swingLows = [];
    for (let i = 0; i + swingSize <= n; i += swingSize) {
        swingLows.push(Math.min(...lows.slice(i, i + swingSize)));
    }
    let higherLowCount = 0;
    for (let i = 1; i < swingLows.length; i++) {
        if (swingLows[i] > swingLows[i - 1]) higherLowCount++;
    }

    const slopePct = closes[0] > 0 ? (slope / closes[0]) * 100 : 0;
    const steady = slope > 0 && r2 > 0.75 && higherLowCount >= 2;
    return { steady, r2, slopePct, higherLows: higherLowCount };
}

// ── 全局 Regime 過濾（BTC EMA200）────────────────────────────
// 回傳 true = 允許開倉，false = 熊市暫停
function checkGlobalRegime(btcCandles4h, ts) {
    if (!btcCandles4h || noRegime) return true;
    const ts4h = btcCandles4h.map(c => parseInt(c[0]));
    const e4 = upperIdx(ts4h, ts);
    if (e4 < 200) return true; // 資料不足，放行

    const closes = btcCandles4h.slice(0, e4 + 1).map(c => parseFloat(c[4]));
    const cur = closes[closes.length - 1];
    const ema200v = ema(closes, 200);
    return cur > ema200v; // BTC 在 EMA200 以上才允許開倉
}

// ── 出場模擬 ─────────────────────────────────────────────────
function simulateExit(entryPrice, futureCandles) {
    const sl  = entryPrice * (1 - 0.05);
    const tp1 = entryPrice * (1 + 0.05);
    const tp2 = entryPrice * (1 + 0.10);
    const tp3 = entryPrice * (1 + 0.15);

    for (const c of futureCandles) {
        const h = parseFloat(c[2]), l = parseFloat(c[3]), ts = parseInt(c[0]);
        if (l <= sl)  return { result: 'SL',  pnlPct: -5.0, exitTs: ts };
        if (h >= tp3) return { result: 'TP3', pnlPct: 15.0, exitTs: ts };
        if (h >= tp2) return { result: 'TP2', pnlPct: 10.0, exitTs: ts };
        if (h >= tp1) return { result: 'TP1', pnlPct:  5.0, exitTs: ts };
    }
    return { result: 'OPEN', pnlPct: 0, exitTs: null };
}

// ── 策略工廠 ─────────────────────────────────────────────────
function makeStrategy(symbol) {
    // BTC 4h 資料供 Regime 過濾用（非 BTC 幣種也用 BTC 判斷全局市況）
    let btcCandles4h = null;
    try { btcCandles4h = loadKData('BTCUSDT', '4h'); } catch (_) {}

    return {
        name: `loopF_steadyClimb_${symbol}${noRegime ? '_noRegime' : '_withRegime'}`,

        loadData() {
            const candles15 = loadKData(symbol, '15m');
            // candles4h 傳入 BTC 4h（供 engine 的 Regime Analysis 使用）
            const candles4h = btcCandles4h || loadKData(symbol, '4h');
            return { candles15, candles4h };
        },

        calibrate() { return {}; },

        run(candles15, _candles4h, _params, startTs, endTs) {
            const trades   = [];
            const lastExit = { LONG: 0 };
            const FEE_RATE = 0.0019;
            const PRE      = 20; // 需要 20 根計算穩定爬升

            for (let i = PRE; i < candles15.length - 1; i++) {
                const ts = parseInt(candles15[i][0]);
                if (ts < startTs || ts > endTs) continue;
                if (ts <= lastExit['LONG']) continue;

                // Regime 過濾：BTC 在 EMA200 以下時不開倉
                if (!checkGlobalRegime(btcCandles4h, ts)) continue;

                // 穩定爬升偵測
                const sl15 = candles15.slice(Math.max(0, i - 19), i + 1);
                const climb = detectSteadyClimb(sl15);
                if (!climb.steady) continue;

                const curPrice = parseFloat(candles15[i][4]);

                // 出場模擬（最多持倉 96 根 15m = 24h）
                const exit = simulateExit(curPrice, candles15.slice(i + 1, i + 97));
                if (exit.result === 'OPEN') continue;

                const netPnl = exit.pnlPct - FEE_RATE * 2 * 100;
                lastExit['LONG'] = exit.exitTs;
                trades.push({
                    entryTs: ts, exitTs: exit.exitTs,
                    pnlPct: netPnl, side: 'LONG', result: exit.result,
                    r2: climb.r2, slopePct: climb.slopePct,
                });
            }
            return trades;
        },

        // 參數敏感度
        paramRanges: {
            r2Threshold:    0.75,  // 穩定度門檻
            higherLowsMin:  2,     // 最少低點遞增次數
            changePct:      3,     // 最低漲幅門檻
            slPct:          5,     // 止損距離 %
        },

        runWith(candles15, candles4h, overrides, startTs, endTs) {
            // 暫時覆蓋參數（簡化版，直接用 run）
            return this.run(candles15, candles4h, overrides, startTs, endTs);
        },
    };
}

// ── 主程式 ───────────────────────────────────────────────────
console.log('═'.repeat(70));
console.log(`Loop F（穩定爬升）四層驗證 + 蒙地卡羅`);
console.log(`幣種：${symbols.join(', ')}  Regime 過濾：${noRegime ? '關閉' : '開啟（BTC EMA200）'}`);
console.log('═'.repeat(70));

const summaryRows = [];

for (const symbol of symbols) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`▶ ${symbol}`);

    try {
        const strategy = makeStrategy(symbol);
        const report   = await runValidation(strategy, {
            nWFFolds:        5,
            nCPCVGroups:     4,
            permSimulations: 1000,
        });

        let mc = null;
        if (!noMC) {
            console.log('\n🎲 Monte Carlo 10,000 次...');
            mc = monteCarlo(report._allTrades ?? [], 10000, 2);
            if (mc) {
                console.log(`   爆倉機率: ${mc.ruinProbability}%   獲利機率: ${mc.profitProbability}%`);
                console.log(`   最大回撤 P95: ${mc.maxDrawdown.p95}%   損益中位數: ${mc.finalEquity.median}U / 2U 本金`);
                console.log(`   建議最低本金: ${(mc.maxDrawdown.p95 * 3).toFixed(1)}U`);
            }
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
        console.error(e.stack);
        summaryRows.push({ symbol, verdict: 'ERROR', error: e.message });
    }
}

// ── 總結表 ────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log(`【Loop F 四層驗證 + Monte Carlo 總結】Regime 過濾：${noRegime ? '關閉' : '開啟'}`);
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
const tag     = `${summaryRows.map(r => r.symbol).join('_')}_${noRegime ? 'noRegime' : 'withRegime'}`;
const csvPath = resolve(__dirname, `results/loopF_${tag}.csv`);
const csvLines = ['\ufeff'];

csvLines.push(`=== Loop F 穩定爬升 四層驗證（Regime 過濾：${noRegime ? '關閉' : '開啟'}）===`);
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

csvLines.push('', '=== Walk-Forward 各段明細 ===');
csvLines.push('幣種,第幾段,驗證期間,訊號數,勝率%,期望值,夏普比率,最大回撤');
for (const r of summaryRows) {
    if (r.verdict === 'ERROR') continue;
    for (const f of r.wfv_folds) {
        csvLines.push([r.symbol, `第${f.fold}段`, f.period, f.trades, f.winRate, f.expectancy, f.sharpe, f.maxDD].join(','));
    }
}

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
console.log('\n執行完成。');
