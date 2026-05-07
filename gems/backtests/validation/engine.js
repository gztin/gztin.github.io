/**
 * 四層統計驗證引擎（通用）
 * 使用方式：import { runValidation } from './engine.js'
 *
 * 策略介面：
 *   strategy.name        - 策略名稱
 *   strategy.loadData()  - 回傳 { candles15, candles4h }
 *   strategy.calibrate(candles15, candles4h) - 回傳 params
 *   strategy.run(candles15, candles4h, params, start, end) - 回傳 trades[]
 *
 * trades[] 每筆格式：
 *   { entryTs, exitTs, pnlPct, side }
 *   pnlPct = 價格移動百分比（正=獲利，負=虧損），未含槓桿
 */

// ── 統計工具 ─────────────────────────────────────────────────

function mean(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1));
}

function sharpe(pnls, riskFreePerTrade = 0) {
    if (pnls.length < 2) return 0;
    const excess = pnls.map(p => p - riskFreePerTrade);
    const s = std(excess);
    return s === 0 ? 0 : mean(excess) / s * Math.sqrt(pnls.length);
}

function maxDrawdown(pnls) {
    let peak = 0, equity = 0, mdd = 0;
    for (const p of pnls) {
        equity += p;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > mdd) mdd = dd;
    }
    return mdd;
}

function winRate(trades) {
    if (!trades.length) return 0;
    return trades.filter(t => t.pnlPct > 0).length / trades.length;
}

function expectancy(trades) {
    if (!trades.length) return 0;
    return mean(trades.map(t => t.pnlPct));
}

// ── ADX 計算（用於 Regime 分析）────────────────────────────
// 使用 Wilder's smoothing（alpha = 1/period），符合 J. Welles Wilder 原始定義

function adx(candles, period = 14) {
    // 需要足夠根數：period 根初始化 + period 根算 DX 序列 + 1 根緩衝
    const needed = period * 2 + period + 1;
    if (candles.length < needed) return 20;
    const slice = candles.slice(-needed);

    // 第一步：計算每根 TR、+DM、-DM
    const trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < slice.length; i++) {
        const h  = parseFloat(slice[i][2]   ?? slice[i].h);
        const l  = parseFloat(slice[i][3]   ?? slice[i].l);
        const ph = parseFloat(slice[i-1][2] ?? slice[i-1].h);
        const pl = parseFloat(slice[i-1][3] ?? slice[i-1].l);
        const pc = parseFloat(slice[i-1][4] ?? slice[i-1].c);
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        const upMove = h - ph, downMove = pl - l;
        plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    // 第二步：Wilder smoothing — 先 SMA(period) 初始化，再逐根更新
    const wilderSmooth = (arr) => {
        const smoothed = [];
        let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
        smoothed.push(val);
        for (let i = period; i < arr.length; i++) {
            val = val - val / period + arr[i];
            smoothed.push(val);
        }
        return smoothed;
    };

    const atrSeries    = wilderSmooth(trs);
    const plusDISeries = wilderSmooth(plusDMs);
    const minusDISeries = wilderSmooth(minusDMs);

    // 第三步：計算每個時間點的 DX 序列
    const dxSeries = [];
    for (let i = 0; i < atrSeries.length; i++) {
        if (atrSeries[i] === 0) { dxSeries.push(0); continue; }
        const pDI = plusDISeries[i]  / atrSeries[i] * 100;
        const mDI = minusDISeries[i] / atrSeries[i] * 100;
        dxSeries.push(Math.abs(pDI - mDI) / (pDI + mDI + 1e-9) * 100);
    }

    // 第四步：對 DX 序列再做一次 Wilder smoothing → 得到 ADX
    if (dxSeries.length < period) return 20;
    let adxVal = dxSeries.slice(0, period).reduce((a, b) => a + b, 0);
    for (let i = period; i < dxSeries.length; i++) {
        adxVal = adxVal - adxVal / period + dxSeries[i];
    }
    return adxVal / period; // Wilder smoothing 回傳的是累計值，除以 period 取平均
}

function ema200(candles) {
    const closes = candles.map(c => parseFloat(c[4] ?? c.c));
    if (closes.length < 200) return closes[closes.length - 1];
    const k = 2 / 201;
    // 用 SMA(200) 作為初始值，避免 seed 偏差
    let val = closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    for (let i = 200; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
    return val;
}

// ── Layer 1：Deflated Sharpe Ratio ───────────────────────────
// Bailey & López de Prado (2014)
// DSR 校正多次回測造成的選擇偏差
// trials = 你總共試了幾個參數組合

export function deflatedSharpe(allSharpes, selectedSharpe, T) {
    const trials = allSharpes.length;
    if (trials === 0 || T < 2) return { dsr: 0, pValue: 1, significant: false };

    // 期望最大 Sharpe（Bonferroni 近似）
    const sharpeStd = std(allSharpes);
    const eulerMascheroni = 0.5772156649;
    const expectedMaxSR = sharpeStd * (
        (1 - eulerMascheroni) * normalInvCDF(1 - 1 / trials) +
        eulerMascheroni * normalInvCDF(1 - 1 / (trials * Math.E))
    );

    // DSR = P(SR* > E[max SR])，用常態分佈近似
    // sharpeStd=0 代表所有試驗 Sharpe 相同 → DSR = 0.5（不特別顯著）
    if (sharpeStd === 0) return { dsr: 0.5, pValue: 0.5, expectedMaxSR: parseFloat(expectedMaxSR.toFixed(4)), significant: false };
    const dsr = normalCDF((selectedSharpe - expectedMaxSR) / sharpeStd);
    const pValue = 1 - dsr;

    return {
        dsr: parseFloat(dsr.toFixed(4)),
        pValue: parseFloat(pValue.toFixed(4)),
        expectedMaxSR: parseFloat(expectedMaxSR.toFixed(4)),
        significant: pValue < 0.05
    };
}

// 標準常態 CDF（Abramowitz & Stegun 近似）
function normalCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422820 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return x >= 0 ? 1 - p : p;
}

function normalInvCDF(p) {
    // Beasley-Springer-Moro 近似
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
    const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
    const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
               0.0276438810333863, 0.0038405729373609, 0.0003951896511349,
               0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
    const y = p - 0.5;
    if (Math.abs(y) < 0.42) {
        const r = y * y;
        return y * (((a[3]*r+a[2])*r+a[1])*r+a[0]) / ((((b[3]*r+b[2])*r+b[1])*r+b[0])*r+1);
    }
    const r = p < 0.5 ? Math.log(-Math.log(p)) : Math.log(-Math.log(1-p));
    let x = c[0]+r*(c[1]+r*(c[2]+r*(c[3]+r*(c[4]+r*(c[5]+r*(c[6]+r*(c[7]+r*c[8])))))));
    return p < 0.5 ? -x : x;
}

// ── 蒙地卡羅模擬 ─────────────────────────────────────────────
// 把交易記錄打亂順序，模擬 N 次，統計最大回撤和最終損益分佈

export function monteCarlo(trades, simulations = 1000, principal = 3) {
    if (trades.length < 5) return null;
    const pnls = trades.map(t => t.pnlPct);

    const finalEquities = [];
    const maxDrawdowns  = [];

    for (let s = 0; s < simulations; s++) {
        // Fisher-Yates 洗牌
        const shuffled = [...pnls];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        let equity = principal, peak = principal, maxDD = 0;
        for (const p of shuffled) {
            equity += p / 100 * principal;
            if (equity > peak) peak = equity;
            const dd = (peak - equity) / peak * 100;
            if (dd > maxDD) maxDD = dd;
            if (equity <= 0) { equity = 0; break; }
        }
        finalEquities.push(equity);
        maxDrawdowns.push(maxDD);
    }

    finalEquities.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    const pct = (arr, p) => arr[Math.floor(arr.length * p / 100)];

    return {
        simulations,
        finalEquity: {
            p5:     parseFloat(pct(finalEquities, 5).toFixed(3)),
            p25:    parseFloat(pct(finalEquities, 25).toFixed(3)),
            median: parseFloat(pct(finalEquities, 50).toFixed(3)),
            p75:    parseFloat(pct(finalEquities, 75).toFixed(3)),
            p95:    parseFloat(pct(finalEquities, 95).toFixed(3)),
        },
        maxDrawdown: {
            p50:    parseFloat(pct(maxDrawdowns, 50).toFixed(1)),
            p75:    parseFloat(pct(maxDrawdowns, 75).toFixed(1)),
            p95:    parseFloat(pct(maxDrawdowns, 95).toFixed(1)),
        },
        ruinProbability: parseFloat((finalEquities.filter(e => e <= 0).length / simulations * 100).toFixed(1)),
        profitProbability: parseFloat((finalEquities.filter(e => e > principal).length / simulations * 100).toFixed(1)),
    };
}
// 把數據切成 nFolds 段，滾動校準+驗證

export function walkForward(candles15, candles4h, strategy, nFolds = 6, extraData = {}) {
    const total = candles15.length;
    const foldSize = Math.floor(total / nFolds);
    const results = [];

    for (let i = 0; i < nFolds - 1; i++) {
        // 校準期：前 i+1 段
        const calibEnd   = (i + 1) * foldSize;
        const calibSlice = candles15.slice(0, calibEnd);
        const calib4h    = candles4h.filter(c => {
            const t = parseInt(c[0] ?? c.t);
            return t <= parseInt(calibSlice[calibSlice.length-1][0] ?? calibSlice[calibSlice.length-1].t);
        });

        // 驗證期：第 i+2 段
        const testStart = calibEnd;
        const testEnd   = Math.min(testStart + foldSize, total);
        const testSlice = candles15.slice(testStart, testEnd);
        const test4h    = candles4h.filter(c => {
            const t = parseInt(c[0] ?? c.t);
            const ts = parseInt(testSlice[0][0] ?? testSlice[0].t);
            const te = parseInt(testSlice[testSlice.length-1][0] ?? testSlice[testSlice.length-1].t);
            return t >= ts && t <= te;
        });

        if (calibSlice.length < 100 || testSlice.length < 20) continue;

        const params = strategy.calibrate(calibSlice, calib4h);
        const startTs = parseInt(testSlice[0][0] ?? testSlice[0].t);
        const endTs   = parseInt(testSlice[testSlice.length-1][0] ?? testSlice[testSlice.length-1].t);
        const trades  = strategy.run(candles15.slice(0, testEnd), test4h, params, startTs, endTs, extraData);

        const pnls = trades.map(t => t.pnlPct);
        const startDate = new Date(startTs).toISOString().slice(0, 10);
        const endDate   = new Date(endTs).toISOString().slice(0, 10);

        results.push({
            fold: i + 1,
            period: `${startDate} ~ ${endDate}`,
            trades: trades.length,
            winRate: parseFloat((winRate(trades) * 100).toFixed(1)),
            expectancy: parseFloat(expectancy(trades).toFixed(4)),
            sharpe: parseFloat(sharpe(pnls).toFixed(3)),
            maxDD: parseFloat(maxDrawdown(pnls).toFixed(4)),
            params
        });
    }

    // 一致性分析
    const sharpes = results.map(r => r.sharpe);
    const winRates = results.map(r => r.winRate);
    const consistency = {
        sharpe_mean: parseFloat(mean(sharpes).toFixed(3)),
        sharpe_std:  parseFloat(std(sharpes).toFixed(3)),
        winRate_mean: parseFloat(mean(winRates).toFixed(1)),
        winRate_std:  parseFloat(std(winRates).toFixed(1)),
        positive_folds: sharpes.filter(s => s > 0).length,
        total_folds: results.length
    };

    return { folds: results, consistency };
}

// ── Layer 3：Regime Analysis ─────────────────────────────────
// 用 200EMA + ADX 標記市況，分別統計績效

export function regimeAnalysis(candles15, candles4h, trades) {
    // 為每筆交易標記市況
    const tagged = trades.map(trade => {
        const ts = trade.entryTs;
        // 找進場時間點之前的 K 線
        const idx = candles15.findIndex(c => parseInt(c[0] ?? c.t) >= ts);
        if (idx < 200) return { ...trade, regime: 'UNKNOWN' };

        const slice = candles15.slice(0, idx + 1);
        const ema200v = ema200(slice);
        const adxV    = adx(slice, 14);
        const curClose = parseFloat(slice[slice.length-1][4] ?? slice[slice.length-1].c);

        let regime;
        if (adxV < 20) {
            regime = 'RANGING';
        } else if (curClose > ema200v) {
            regime = 'BULL';
        } else {
            regime = 'BEAR';
        }
        return { ...trade, regime, ema200: ema200v, adx: adxV };
    });

    // 按市況分組統計
    const groups = { BULL: [], BEAR: [], RANGING: [], UNKNOWN: [] };
    for (const t of tagged) groups[t.regime].push(t);

    const stats = {};
    for (const [regime, ts] of Object.entries(groups)) {
        if (!ts.length) continue;
        const pnls = ts.map(t => t.pnlPct);
        stats[regime] = {
            trades: ts.length,
            winRate: parseFloat((winRate(ts) * 100).toFixed(1)),
            expectancy: parseFloat(expectancy(ts).toFixed(4)),
            sharpe: parseFloat(sharpe(pnls).toFixed(3)),
            maxDD: parseFloat(maxDrawdown(pnls).toFixed(4)),
            totalPnl: parseFloat(pnls.reduce((a, b) => a + b, 0).toFixed(4))
        };
    }

    return { tagged, stats };
}

// ── Layer 4：Combinatorial Purged Cross-Validation ───────────
// C(nGroups, testGroups) 種組合，預設 C(10,2) = 45 種

export function cpcv(candles15, candles4h, strategy, nGroups = 10, testGroups = 2, extraData = {}) {
    const total = candles15.length;
    const groupSize = Math.floor(total / nGroups);

    // 建立 nGroups 個時間段
    const groups = [];
    for (let i = 0; i < nGroups; i++) {
        const start = i * groupSize;
        const end   = i === nGroups - 1 ? total : (i + 1) * groupSize;
        groups.push({ start, end,
            startTs: parseInt(candles15[start][0] ?? candles15[start].t),
            endTs:   parseInt(candles15[end-1][0] ?? candles15[end-1].t)
        });
    }

    // 產生所有 C(nGroups, testGroups) 組合
    const combos = combinations(Array.from({length: nGroups}, (_, i) => i), testGroups);
    const results = [];

    let comboIdx = 0;
    for (const testIdx of combos) {
        comboIdx++;
        process.stdout.write(`\r   CPCV 進度: ${comboIdx}/${combos.length} 組合...`);
        const trainIdx = Array.from({length: nGroups}, (_, i) => i).filter(i => !testIdx.includes(i));

        // 校準：用訓練段的所有 K 線
        const trainCandles = trainIdx.flatMap(i => candles15.slice(groups[i].start, groups[i].end))
            .sort((a, b) => parseInt(a[0]??a.t) - parseInt(b[0]??b.t));
        const train4h = candles4h.filter(c => {
            const t = parseInt(c[0] ?? c.t);
            return trainIdx.some(i => t >= groups[i].startTs && t <= groups[i].endTs);
        });

        if (trainCandles.length < 100) continue;
        const params = strategy.calibrate(trainCandles, train4h);

        // 測試：在測試段跑策略（每段獨立，避免 lookahead）
        const foldTrades = [];
        for (const ti of testIdx) {
            const g = groups[ti];
            // 提供測試段前的所有 K 線給策略（避免 lookahead bias）
            const contextEnd = g.end;
            const contextCandles = candles15.slice(0, contextEnd);
            const context4h = candles4h.filter(c => parseInt(c[0]??c.t) <= g.endTs);
            const trades = strategy.run(contextCandles, context4h, params, g.startTs, g.endTs, extraData);
            foldTrades.push(...trades);
        }

        const pnls = foldTrades.map(t => t.pnlPct);
        const sr   = sharpe(pnls);
        results.push({
            testPeriods: testIdx.map(i => `${new Date(groups[i].startTs).toISOString().slice(0,7)}`).join('+'),
            trades: foldTrades.length,
            sharpe: parseFloat(sr.toFixed(3)),
            winRate: parseFloat((winRate(foldTrades) * 100).toFixed(1)),
            expectancy: parseFloat(expectancy(foldTrades).toFixed(4))
        });
    }

    process.stdout.write('\n');
    const sharpes = results.map(r => r.sharpe);
    const summary = {
        combinations: results.length,
        sharpe_median: parseFloat(median(sharpes).toFixed(3)),
        sharpe_mean:   parseFloat(mean(sharpes).toFixed(3)),
        sharpe_std:    parseFloat(std(sharpes).toFixed(3)),
        sharpe_min:    parseFloat(Math.min(...sharpes).toFixed(3)),
        sharpe_max:    parseFloat(Math.max(...sharpes).toFixed(3)),
        positive_pct:  parseFloat((sharpes.filter(s => s > 0).length / sharpes.length * 100).toFixed(1)),
        verdict: sharpes.filter(s => s > 0).length / sharpes.length >= 0.7 ? '✅ 穩健' : '⚠️ 過擬合風險'
    };

    return { combinations: results, summary };
}

// ── Layer 5：Bootstrap t-test ────────────────────────────────
// 問題：「策略的期望獲利是否顯著大於零，還是只是運氣？」
//
// 原理（Bootstrap t-test）：
//   對交易報酬做有放回的重抽樣 N 次，每次計算平均報酬（期望值）
//   → p-value = 重抽樣中「平均報酬 ≤ 0」的比例
//   → 若 p < 0.05：有 95% 信心期望值確實 > 0，不是運氣
//
// 為什麼不用原始洗牌（Fisher-Yates）：
//   Sharpe = mean / std，計算結果與順序完全無關，洗牌永遠得到相同 Sharpe，毫無意義。
//
// 與 Monte Carlo 的差別：
//   Monte Carlo → 模擬「未來資金曲線的風險分佈」（最壞情況有多壞）
//   Bootstrap   → 驗證「過去的期望值是否有統計支撐」（勝率不是運氣）

export function permutationTest(trades, simulations = 1000) {
    if (trades.length < 10) return null;
    const pnls       = trades.map(t => t.pnlPct);
    const actualMean = mean(pnls);
    const n          = pnls.length;

    // Bootstrap：有放回重抽樣
    const bootstrapMeans = [];
    for (let s = 0; s < simulations; s++) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += pnls[Math.floor(Math.random() * n)];
        bootstrapMeans.push(sum / n);
    }
    bootstrapMeans.sort((a, b) => a - b);

    // p-value：重抽樣中平均報酬 <= 0 的比例（單尾，期望值 > 0）
    const countNonPositive = bootstrapMeans.filter(m => m <= 0).length;
    const pValue = parseFloat((countNonPositive / simulations).toFixed(4));

    // 95% 信賴區間（百分位法）
    const pct = (arr, p) => arr[Math.floor(arr.length * p / 100)];
    const ci95Lo = parseFloat(pct(bootstrapMeans, 2.5).toFixed(4));
    const ci95Hi = parseFloat(pct(bootstrapMeans, 97.5).toFixed(4));

    // 補充：t 統計量（參考用）
    const se = std(pnls) / Math.sqrt(n);
    const tStat = se > 0 ? parseFloat((actualMean / se).toFixed(3)) : 0;

    return {
        actualMean:  parseFloat(actualMean.toFixed(4)),
        tStat,
        simulations,
        pValue,
        significant: pValue < 0.05,
        ci95: { lo: ci95Lo, hi: ci95Hi },
        verdict: pValue < 0.01 ? '✅ 極顯著 (p<0.01)'
                : pValue < 0.05 ? '✅ 顯著 (p<0.05)'
                : '❌ 不顯著 (p≥0.05)'
    };
}

// ── Layer 6：Parameter Sensitivity ──────────────────────────
// 將每個參數分別調整 ±10% / ±20%，觀察 Sharpe 變化
// 健康策略：Sharpe 應平滑降低，而非在某個點急劇崩潰
//
// 策略需實作（可選）：
//   strategy.paramRanges  = { paramName: defaultValue, ... }
//   strategy.runWith(candles15, candles4h, paramOverrides, startTs, endTs, extraData) → trades[]
//
// 若未實作則回傳 { skipped: true }，不影響主驗證流程

export function paramSensitivity(candles15, candles4h, strategy, baseSharpe, extraData = {}) {
    if (!strategy.paramRanges || !strategy.runWith) {
        return { skipped: true, reason: '策略未實作 paramRanges / runWith 介面' };
    }

    const startTs = parseInt(candles15[0][0] ?? candles15[0].t);
    const endTs   = parseInt(candles15[candles15.length-1][0] ?? candles15[candles15.length-1].t);
    const MULTIPLIERS = [0.8, 0.9, 1.1, 1.2]; // ±10% / ±20%

    const paramResults = {};

    for (const [paramName, defaultVal] of Object.entries(strategy.paramRanges)) {
        const varResults = [];

        for (const mult of MULTIPLIERS) {
            const overrides = { [paramName]: defaultVal * mult };
            const trades    = strategy.runWith(candles15, candles4h, overrides, startTs, endTs, extraData);
            const pnls      = trades.map(t => t.pnlPct);
            const s         = sharpe(pnls);
            const dropPct   = baseSharpe !== 0
                ? parseFloat(((s - baseSharpe) / Math.abs(baseSharpe) * 100).toFixed(1))
                : 0;

            varResults.push({
                multiplier:    mult,
                paramValue:    parseFloat((defaultVal * mult).toFixed(4)),
                sharpe:        parseFloat(s.toFixed(3)),
                sharpeChangePct: dropPct,
                trades:        trades.length,
                winRate:       parseFloat((winRate(trades) * 100).toFixed(1))
            });
        }

        // 敏感度分數：各變體 Sharpe 變化的標準差（越大越不穩健）
        const drops         = varResults.map(r => r.sharpeChangePct);
        const maxDrop       = Math.max(...drops.map(d => -d)); // 最大下跌幅度
        const sensitivityStd = parseFloat(std(drops).toFixed(2));

        paramResults[paramName] = {
            defaultVal,
            variations:      varResults,
            sensitivityStd,
            maxSharpeDrop:   parseFloat(maxDrop.toFixed(1)),
            // 判準：±20% 調整後 Sharpe 降幅 < 40% 視為穩健
            robust:          maxDrop < 40
        };
    }

    const allRobust = Object.values(paramResults).every(r => r.robust);
    const fragileParams = Object.entries(paramResults)
        .filter(([, v]) => !v.robust)
        .map(([k]) => k);

    return {
        skipped: false,
        params:  paramResults,
        allRobust,
        fragileParams,
        verdict: allRobust
            ? '✅ 參數穩健（±20% 調整 Sharpe 降幅 < 40%）'
            : `⚠️ 敏感參數：${fragileParams.join(', ')}`
    };
}

// ── 主入口 ───────────────────────────────────────────────────

export async function runValidation(strategy, opts = {}) {
    const { nWFFolds = 6, nCPCVGroups = 10, permSimulations = 1000 } = opts;
    const lines = []; // 收集所有輸出
    const log = s => { console.log(s); lines.push(s); };

    log(`\n${'═'.repeat(60)}`);
    log(`📊 四層統計驗證：${strategy.name}`);
    log(`測試時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`);
    log('═'.repeat(60));

    // 載入資料
    log('\n⏳ 載入資料...');
    const loadResult = await strategy.loadData();
    const { candles15, candles4h } = loadResult;
    const extraData = Object.fromEntries(Object.entries(loadResult).filter(([k]) => k !== 'candles15' && k !== 'candles4h'));
    log(`   15m: ${candles15.length} 根  4h: ${candles4h.length} 根`);
    const rangeStart = new Date(parseInt(candles15[0][0] ?? candles15[0].t)).toISOString().slice(0, 10);
    const rangeEnd   = new Date(parseInt(candles15[candles15.length-1][0] ?? candles15[candles15.length-1].t)).toISOString().slice(0, 10);

    log(`   範圍: ${rangeStart} ~ ${rangeEnd}`);

    // 全段校準 + 基準回測
    log('\n⚙️  全段校準...');
    const fullParams = strategy.calibrate(candles15, candles4h);
    const startTs = parseInt(candles15[0][0] ?? candles15[0].t);
    const endTs   = parseInt(candles15[candles15.length-1][0] ?? candles15[candles15.length-1].t);
    const allTrades = strategy.run(candles15, candles4h, fullParams, startTs, endTs, extraData);
    const allPnls   = allTrades.map(t => t.pnlPct);
    const baseSharpe = sharpe(allPnls);
    log(`   總交易: ${allTrades.length}  勝率: ${(winRate(allTrades)*100).toFixed(1)}%  Sharpe: ${baseSharpe.toFixed(3)}`);

    const report = { strategy: strategy.name, testedAt: new Date().toISOString(),
                     baseTrades: allTrades.length,
                     baseWinRate: parseFloat((winRate(allTrades)*100).toFixed(1)),
                     baseSharpe: parseFloat(baseSharpe.toFixed(3)) };

    // Layer 1+2：先跑 WFV，其各段 Sharpe 同時作為 DSR 的 trial 樣本（避免重複計算）
    const wfvResult = walkForward(candles15, candles4h, strategy, nWFFolds, extraData);
    report.wfv = wfvResult;

    // Layer 1: DSR
    log('\n── Layer 1: Deflated Sharpe Ratio ──');
    const trialSharpes = wfvResult.folds.map(f => f.sharpe);
    const dsrResult = deflatedSharpe(trialSharpes, baseSharpe, allTrades.length);
    report.dsr = dsrResult;
    log(`   原始 Sharpe: ${baseSharpe.toFixed(3)}`);
    log(`   期望最大 SR: ${dsrResult.expectedMaxSR}`);
    log(`   DSR p-value: ${dsrResult.pValue}  ${dsrResult.significant ? '✅ 顯著' : '❌ 不顯著（可能是運氣）'}`);

    // Layer 2: WFV
    log('\n── Layer 2: Walk-Forward Validation ──');
    for (const f of wfvResult.folds) {
        log(`   Fold ${f.fold} [${f.period}] 交易:${f.trades} 勝率:${f.winRate}% Sharpe:${f.sharpe} ${f.sharpe > 0 ? '✅' : '❌'}`);
    }
    log(`   一致性 → Sharpe 均值:${wfvResult.consistency.sharpe_mean} 標準差:${wfvResult.consistency.sharpe_std}  正向段:${wfvResult.consistency.positive_folds}/${wfvResult.consistency.total_folds}`);

    // Layer 3: Regime
    log('\n── Layer 3: Regime Analysis ──');
    const regimeResult = regimeAnalysis(candles15, candles4h, allTrades);
    report.regime = regimeResult.stats;
    for (const [regime, s] of Object.entries(regimeResult.stats)) {
        log(`   ${regime.padEnd(8)} 交易:${s.trades} 勝率:${s.winRate}% 期望值:${s.expectancy} Sharpe:${s.sharpe} ${s.expectancy > 0 ? '✅' : '❌'}`);
    }

    // Layer 4: CPCV
    log('\n── Layer 4: CPCV ──');
    const cpcvResult = cpcv(candles15, candles4h, strategy, nCPCVGroups, 2, extraData);
    report.cpcv = cpcvResult.summary;
    const cs = cpcvResult.summary;
    log(`   組合數: ${cs.combinations}  正向比例: ${cs.positive_pct}%`);
    log(`   Sharpe 中位數:${cs.sharpe_median} 均值:${cs.sharpe_mean} 標準差:${cs.sharpe_std} 範圍:[${cs.sharpe_min}, ${cs.sharpe_max}]`);
    log(`   結論: ${cs.verdict}`);

    // Layer 5: Bootstrap t-test
    log(`\n── Layer 5: Bootstrap t-test (${permSimulations} 次重抽樣) ──`);
    const permResult = permutationTest(allTrades, permSimulations);
    report.permutation = permResult;
    if (permResult) {
        log(`   期望值: ${permResult.actualMean}%  t統計量: ${permResult.tStat}`);
        log(`   95% CI: [${permResult.ci95.lo}%, ${permResult.ci95.hi}%]`);
        log(`   p-value: ${permResult.pValue}  ${permResult.verdict}`);
    } else {
        log('   ⚠️ 交易筆數不足（需 10 筆以上），略過');
    }

    // Layer 6: Parameter Sensitivity（策略需實作 paramRanges + runWith）
    log('\n── Layer 6: Parameter Sensitivity ──');
    const sensResult = paramSensitivity(candles15, candles4h, strategy, baseSharpe, extraData);
    report.sensitivity = sensResult;
    if (sensResult.skipped) {
        log(`   ⏭️  ${sensResult.reason}`);
    } else {
        for (const [name, r] of Object.entries(sensResult.params)) {
            log(`   ${name.padEnd(20)} 基準 Sharpe: ${baseSharpe.toFixed(3)}  最大降幅: ${r.maxSharpeDrop}%  ${r.robust ? '✅' : '⚠️'}`);
            for (const v of r.variations) {
                const sign = v.sharpeChangePct > 0 ? '+' : '';
                log(`      x${v.multiplier} 值:${v.paramValue}  Sharpe:${v.sharpe} (${sign}${v.sharpeChangePct}%)  勝率:${v.winRate}%`);
            }
        }
        log(`   結論: ${sensResult.verdict}`);
    }

    // 最終判決
    log(`\n${'═'.repeat(60)}`);
    log('【最終判決】');

    const hasPerm = permResult !== null;
    const pass = [
        dsrResult.significant,
        wfvResult.consistency.positive_folds >= Math.ceil(wfvResult.consistency.total_folds * 0.6),
        (regimeResult.stats['BULL']?.expectancy ?? 0) > 0 || (regimeResult.stats['BEAR']?.expectancy ?? 0) > 0,
        cpcvResult.summary.positive_pct >= 70,
        ...(hasPerm ? [permResult.significant] : [])
    ];
    const sensPass = !sensResult.skipped ? sensResult.allRobust : null;

    const totalLayers       = pass.length;
    const passCount         = pass.filter(Boolean).length;
    const passThreshold     = Math.ceil(totalLayers * 0.75);
    const marginalThreshold = Math.ceil(totalLayers * 0.5);

    log(`   DSR 顯著:       ${pass[0] ? '✅' : '❌'}`);
    log(`   WFV 穩定:       ${pass[1] ? '✅' : '❌'}`);
    log(`   Regime 有效:    ${pass[2] ? '✅' : '❌'}`);
    log(`   CPCV 穩健:      ${pass[3] ? '✅' : '❌'}`);
    if (hasPerm) log(`   排列測試:       ${pass[4] ? '✅' : '❌'}`);
    if (sensPass !== null) log(`   參數穩健:       ${sensPass ? '✅' : '⚠️'}  （參考用）`);

    const conclusion = passCount >= passThreshold ? 'PASS'
                     : passCount >= marginalThreshold ? 'MARGINAL' : 'FAIL';
    log(`\n   通過 ${passCount}/${totalLayers} 層驗證 → ${conclusion === 'PASS' ? '✅ 策略可信' : conclusion === 'MARGINAL' ? '⚠️ 需要改進' : '❌ 不建議實盤'}`);
    log('═'.repeat(60));

    report.verdict = { passCount, totalLayers, layers: pass, sensPass, conclusion };
    report._allTrades     = allTrades;
    report._consoleOutput = lines;
    return report;
}

// ── 工具函數 ─────────────────────────────────────────────────

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function combinations(arr, k) {
    if (k === 0) return [[]];
    if (arr.length === 0) return [];
    const [first, ...rest] = arr;
    const withFirst    = combinations(rest, k - 1).map(c => [first, ...c]);
    const withoutFirst = combinations(rest, k);
    return [...withFirst, ...withoutFirst];
}
