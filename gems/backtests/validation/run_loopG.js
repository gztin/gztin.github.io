/**
 * Loop G（布林貼軌爆發）四層驗證 + 蒙地卡羅 Runner
 *
 * 策略邏輯：
 *   進場：15m 貼軌 (pct >= 0.98) + 1h 貼軌 (pct > 0.9)
 *   出場：
 *     TP1: +100% ROI (以 10x 槓桿換算約 +10% 價格變動)
 *     TP2: +200% ROI
 *     TP3: +300% ROI
 *     SL: 跌破 15m 布林中軌 或 -50% ROI
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

function bollingerBands(closes, period = 20, mult = 2) {
    if (closes.length < period) return { upper: 0, mid: 0, lower: 0, width: 0, pct: 0.5 };
    const slice = closes.slice(-period);
    const mid   = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
    const upper = mid + mult * std;
    const lower = mid - mult * std;
    const cur   = closes[closes.length - 1];
    return {
        upper, mid, lower,
        width: (upper - lower) / (mid || 1),
        pct:   (upper === lower) ? 0.5 : (cur - lower) / (upper - lower),
    };
}

function upperIdx(tsArr, ts) {
    let lo = 0, hi = tsArr.length - 1, res = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (tsArr[mid] <= ts) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
}

// ── 出場模擬 ─────────────────────────────────────────────────
function simulateExit(entryPrice, leverage, candles15m) {
    // 雙重防線
    const slHard = entryPrice * (1 - 0.5 / leverage); // -50% ROI
    
    // 止盈位
    const tp1 = entryPrice * (1 + 1.0 / leverage); // +100% ROI
    const tp2 = entryPrice * (1 + 2.0 / leverage); // +200% ROI
    const tp3 = entryPrice * (1 + 3.0 / leverage); // +300% ROI

    for (let j = 0; j < candles15m.length; j++) {
        const c = candles15m[j];
        const h = parseFloat(c[2]), l = parseFloat(c[3]), ts = parseInt(c[0]);
        const closes = candles15m.slice(0, j + 1).map(x => parseFloat(x[4]));
        const bb = bollingerBands(closes, 20);
        
        // 趨勢防線：跌破布林中軌
        if (closes[closes.length-1] < bb.mid) {
            const pnl = (bb.mid - entryPrice) / entryPrice * leverage * 100;
            return { result: 'SL_TREND', pnlPct: pnl, exitTs: ts };
        }
        
        // 硬止損
        if (l <= slHard) return { result: 'SL_HARD', pnlPct: -50.0, exitTs: ts };
        
        // 止盈
        if (h >= tp3) return { result: 'TP3', pnlPct: 300.0, exitTs: ts };
        if (h >= tp2) return { result: 'TP2', pnlPct: 200.0, exitTs: ts };
        if (h >= tp1) return { result: 'TP1', pnlPct: 100.0, exitTs: ts };
    }
    
    return { result: 'OPEN', pnlPct: 0, exitTs: null };
}

// ── 策略工廠 ─────────────────────────────────────────────────
function makeStrategy(symbol) {
    let btcCandles4h = null;
    try { btcCandles4h = loadKData('BTCUSDT', '4h'); } catch (_) {}

    return {
        name: `loopG_bollinger_${symbol}`,

        loadData() {
            const candles15 = loadKData(symbol, '15m');
            const candles1h = loadKData(symbol, '1h');
            const candles4h = btcCandles4h || loadKData(symbol, '4h');
            return { candles15, candles1h, candles4h };
        },

        calibrate() { return {}; },

        run(candles15, candles4h, _params, startTs, endTs, extraData) {
            const { candles1h } = extraData;
            const trades = [];
            let lastExit = 0;
            const FEE_RATE = 0.0006; 
            const LEVERAGE = 10;
            
            const ts1h = (candles1h || []).map(c => parseInt(c[0]));

            for (let i = 100; i < candles15.length - 1; i++) {
                const ts = parseInt(candles15[i][0]);
                if (ts < startTs || ts > endTs) continue;
                if (ts <= lastExit) continue;

                // 1. 15m 貼軌判斷
                const slice15 = candles15.slice(i - 19, i + 1).map(c => parseFloat(c[4]));
                const bb15 = bollingerBands(slice15);
                if (bb15.pct < 0.98) continue;

                // 2. 1h 貼軌判斷
                const idx1h = upperIdx(ts1h, ts);
                if (idx1h < 20) continue;
                const slice1h = candles1h.slice(idx1h - 19, idx1h + 1).map(c => parseFloat(c[4]));
                const bb1h = bollingerBands(slice1h);
                if (bb1h.pct < 0.9) continue;

                const curPrice = parseFloat(candles15[i][4]);

                // 3. 出場模擬
                const exit = simulateExit(curPrice, LEVERAGE, candles15.slice(i + 1, i + 201));
                if (exit.result === 'OPEN') continue;

                const netPnl = exit.pnlPct - FEE_RATE * 2 * LEVERAGE * 100;
                trades.push({
                    entryTs: ts, exitTs: exit.exitTs,
                    pnlPct: netPnl, side: 'LONG', result: exit.result
                });
                lastExit = exit.exitTs;
                // 跳過已處理的 K 線
                while (i < candles15.length && parseInt(candles15[i][0]) < exit.exitTs) i++;
            }
            return trades;
        },

        paramRanges: {
            leverage: 10,
            bbPeriod: 20
        },

        runWith(candles15, candles4h, overrides, startTs, endTs, extraData) {
            return this.run(candles15, candles4h, overrides, startTs, endTs, extraData);
        }
    };
}

// ── 主程式 ───────────────────────────────────────────────────
console.log('═'.repeat(70));
console.log(`Loop G（布林貼軌）四層驗證 + 蒙地卡羅`);
console.log(`幣種：${symbols.join(', ')}`);
console.log('═'.repeat(70));

const summaryRows = [];

for (const symbol of symbols) {
    console.log(`\n▶ ${symbol}`);

    try {
        const strategy = makeStrategy(symbol);
        const data = strategy.loadData();
        
        const report = await runValidation(strategy, {
            nWFFolds: 4,
            nCPCVGroups: 2,
            permSimulations: 500,
        });

        let mc = null;
        if (!noMC) {
            console.log('\n🎲 Monte Carlo 10,000 次...');
            mc = monteCarlo(report._allTrades ?? [], 10000, 2);
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
            mc_ruin:   mc?.ruinProbability  ?? '-',
            mc_profit: mc?.profitProbability ?? '-',
            mc_dd_p95: mc?.maxDrawdown?.p95  ?? '-',
            mc_eq_med: mc?.finalEquity?.median ?? '-',
        });
    } catch (e) {
        console.error(`  ❌ ${symbol} 驗證失敗：${e.message}`);
        summaryRows.push({ symbol, verdict: 'ERROR', error: e.message });
    }
}

// ── 總結 ──────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(80));
console.log(`【Loop G 布林貼軌驗證總結】`);
console.log(
    `${'幣種'.padEnd(10)} ${'訊號'.padStart(5)} ${'勝率'.padStart(7)} ${'Sharpe'.padStart(8)} ` +
    `${'通過'.padStart(6)} ${'結論'.padEnd(8)} ${'爆倉%'.padStart(6)} ${'DD_P95'.padStart(7)}`
);
console.log('─'.repeat(80));

for (const r of summaryRows) {
    if (r.verdict === 'ERROR') { console.log(`${r.symbol.padEnd(10)} ❌ ${r.error}`); continue; }
    const icon = r.verdict === 'PASS' ? '✅' : r.verdict === 'MARGINAL' ? '⚠️' : '❌';
    console.log(
        `${r.symbol.padEnd(10)} ${String(r.trades).padStart(5)} ${(r.winRate + '%').padStart(7)} ` +
        `${r.sharpe.toFixed(3).padStart(8)} ${(r.passCount + '/' + r.total).padStart(5)}${icon} ` +
        `${r.verdict.padEnd(8)} ${String(r.mc_ruin + '%').padStart(6)} ${String(r.mc_dd_p95 + '%').padStart(7)}`
    );
}

console.log('\n執行完成。');
