/**
 * K線圖形識別模組
 * 規範：agent/skills/specs_trading/pattern_detection_spec.md
 *
 * 使用方式：
 *   import { detectPattern } from './pattern_detector.js';
 *   const result = detectPattern(candles, 'SHORT'); // 或 'LONG'
 *
 * 回傳：
 *   { pattern, direction, confidence, neckline, sl, barsUsed } 或 null
 */

// ── 工具函數 ─────────────────────────────────────────────────

function atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = candles.slice(-period - 1).map((c, i, arr) => {
        if (i === 0) return parseFloat(c[2]) - parseFloat(c[3]);
        const h = parseFloat(c[2]), l = parseFloat(c[3]), pc = parseFloat(arr[i-1][4]);
        return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

// 找局部高點（前後 n 根都比它低）
function findLocalPeaks(highs, n = 3) {
    const peaks = [];
    for (let i = n; i < highs.length - n; i++) {
        const window = highs.slice(i - n, i + n + 1);
        if (highs[i] === Math.max(...window)) peaks.push({ idx: i, val: highs[i] });
    }
    return peaks;
}

// 找局部低點
function findLocalTroughs(lows, n = 3) {
    const troughs = [];
    for (let i = n; i < lows.length - n; i++) {
        const window = lows.slice(i - n, i + n + 1);
        if (lows[i] === Math.min(...window)) troughs.push({ idx: i, val: lows[i] });
    }
    return troughs;
}

// 線性回歸斜率
function linearSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xMean) * (values[i] - yMean);
        den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

// 二次曲線擬合，回傳 { a, r2 }
function quadraticFit(values) {
    const n = values.length;
    if (n < 5) return { a: 0, r2: 0 };
    // 簡化：用前中後三點估算開口方向
    const y0 = values[0], y1 = values[Math.floor(n/2)], y2 = values[n-1];
    const a = (y0 + y2 - 2 * y1) / 2;
    // R² 近似
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const ssTot = values.reduce((s, v) => s + (v - mean) ** 2, 0);
    const fitted = values.map((_, i) => {
        const x = (i / (n-1)) * 2 - 1; // -1 to 1
        return a * x * x + (y2 - y0) / 2 * x + y1;
    });
    const ssRes = values.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
    return { a, r2 };
}

const TOLERANCE = 0.01; // 1% 容差
const MIN_BARS   = 35;
const MAX_BARS   = 75;

// ── 做空圖形 ─────────────────────────────────────────────────

function detectDoubleTop(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const peaks  = findLocalPeaks(highs, 3);
    if (peaks.length < 2) return null;

    // 取最後兩個高點
    const p2 = peaks[peaks.length - 1];
    const p1 = peaks[peaks.length - 2];
    if (p2.idx - p1.idx < 5) return null;
    if (Math.abs(p1.val - p2.val) / p1.val > TOLERANCE) return null;

    // 頸線 = 兩峰之間的最低點
    const valleyLows = lows.slice(p1.idx, p2.idx + 1);
    const neckline   = Math.min(...valleyLows);
    if (p1.val - neckline < atr14 * 1.5) return null;

    // 當前收盤跌破頸線
    const cur = closes[closes.length - 1];
    if (cur >= neckline) return null;

    return {
        pattern: 'DOUBLE_TOP', direction: 'SHORT',
        confidence: Math.abs(p1.val - p2.val) / p1.val < 0.005 ? 'HIGH' : 'MED',
        neckline, sl: p2.val + atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectHeadShoulders(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const closes = candles.map(c => parseFloat(c[4]));
    const peaks  = findLocalPeaks(highs, 3);
    if (peaks.length < 3) return null;

    const ls = peaks[peaks.length - 3];
    const hd = peaks[peaks.length - 2];
    const rs = peaks[peaks.length - 1];

    if (hd.val <= ls.val || hd.val <= rs.val) return null;
    if (Math.abs(ls.val - rs.val) / ls.val > TOLERANCE) return null;

    // 頸線 = 兩谷底平均
    const lows = candles.map(c => parseFloat(c[3]));
    const v1 = Math.min(...lows.slice(ls.idx, hd.idx + 1));
    const v2 = Math.min(...lows.slice(hd.idx, rs.idx + 1));
    const neckline = (v1 + v2) / 2;

    const cur = closes[closes.length - 1];
    if (cur >= neckline) return null;

    return {
        pattern: 'HEAD_SHOULDERS_TOP', direction: 'SHORT',
        confidence: 'HIGH',
        neckline, sl: rs.val + atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectRisingWedge(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const slopeH = linearSlope(highs);
    const slopeL = linearSlope(lows);

    if (slopeH <= 0 || slopeL <= 0) return null;
    if (slopeL <= slopeH) return null; // 需要下方線斜率更大
    if (slopeL - slopeH < 0.0001) return null;

    // 當前收盤跌破下方趨勢線
    const trendLow = lows[0] + slopeL * (lows.length - 1);
    const cur = closes[closes.length - 1];
    if (cur >= trendLow) return null;

    return {
        pattern: 'RISING_WEDGE', direction: 'SHORT',
        confidence: 'MED',
        neckline: trendLow, sl: Math.max(...highs.slice(-5)) + atr14 * 0.5,
        barsUsed: candles.length,
    };
}

function detectBearFlag(candles, atr14) {
    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const len    = candles.length;

    // 找旗桿：前段急跌
    const poleEnd = Math.floor(len * 0.6);
    const poleStart = Math.max(0, poleEnd - 20);
    const poleHigh = Math.max(...highs.slice(poleStart, poleEnd));
    const poleLow  = Math.min(...lows.slice(poleStart, poleEnd));
    const poleDrop = poleHigh - poleLow;
    if (poleDrop < atr14 * 3) return null;

    // 旗面：後段小幅反彈
    const flagHigh = Math.max(...highs.slice(poleEnd));
    const flagLow  = Math.min(...lows.slice(poleEnd));
    if (flagHigh - flagLow > poleDrop * 0.5) return null;
    if (flagHigh > poleLow + poleDrop * 0.5) return null; // 反彈不超過旗桿 50%

    const cur = closes[len - 1];
    if (cur >= flagLow) return null;

    return {
        pattern: 'BEAR_FLAG', direction: 'SHORT',
        confidence: 'MED',
        neckline: flagLow, sl: flagHigh + atr14 * 0.3, barsUsed: candles.length,
    };
}

function detectRoundingTop(candles, atr14) {
    const closes = candles.map(c => parseFloat(c[4]));
    const { a, r2 } = quadraticFit(closes);
    if (a >= 0 || r2 < 0.7) return null;

    // 頂點在中段
    const peakIdx = Math.floor(closes.length / 2);
    const peakVal = closes[peakIdx];
    const cur = closes[closes.length - 1];
    if (cur >= peakVal - atr14) return null;

    return {
        pattern: 'ROUNDING_TOP', direction: 'SHORT',
        confidence: r2 > 0.85 ? 'HIGH' : 'MED',
        neckline: cur, sl: peakVal + atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectIslandTop(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const len    = candles.length;

    for (let i = 2; i < len - 2; i++) {
        // 向上跳空
        const gapUp = lows[i] > highs[i - 1];
        if (!gapUp) continue;
        // 向下跳空（在 i 之後）
        for (let j = i + 1; j < len - 1; j++) {
            const gapDown = highs[j] < lows[j - 1];
            if (!gapDown) continue;
            const cur = closes[len - 1];
            if (cur < lows[j]) {
                const islandHigh = Math.max(...highs.slice(i, j + 1));
                return {
                    pattern: 'ISLAND_TOP', direction: 'SHORT',
                    confidence: 'HIGH',
                    neckline: lows[j], sl: islandHigh + atr14 * 0.3,
                    barsUsed: candles.length,
                };
            }
        }
    }
    return null;
}

function detectDiamondTop(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const half   = Math.floor(candles.length / 2);

    const slopeH1 = linearSlope(highs.slice(0, half));
    const slopeL1 = linearSlope(lows.slice(0, half));
    const slopeH2 = linearSlope(highs.slice(half));
    const slopeL2 = linearSlope(lows.slice(half));

    // 前半擴張：高點上升 + 低點下降
    if (slopeH1 <= 0 || slopeL1 >= 0) return null;
    // 後半收斂：高點下降 + 低點上升
    if (slopeH2 >= 0 || slopeL2 <= 0) return null;

    const trendLow2 = lows[half] + slopeL2 * (lows.length - half - 1);
    const cur = closes[closes.length - 1];
    if (cur >= trendLow2) return null;

    return {
        pattern: 'DIAMOND_TOP', direction: 'SHORT',
        confidence: 'MED',
        neckline: trendLow2, sl: Math.max(...highs) + atr14 * 0.5,
        barsUsed: candles.length,
    };
}

function detectInvertedV(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const peakIdx = highs.indexOf(Math.max(...highs));
    const len = candles.length;

    if (peakIdx < 5 || peakIdx > len - 6) return null;

    const leftDrop  = highs[peakIdx] - lows[Math.max(0, peakIdx - 15)];
    const rightDrop = highs[peakIdx] - closes[len - 1];
    if (leftDrop < atr14 * 3 || rightDrop < atr14 * 3) return null;

    const retrace50 = highs[peakIdx] - (highs[peakIdx] - Math.min(...lows.slice(0, peakIdx))) * 0.5;
    if (closes[len - 1] >= retrace50) return null;

    return {
        pattern: 'INVERTED_V', direction: 'SHORT',
        confidence: 'MED',
        neckline: retrace50, sl: highs[peakIdx] + atr14 * 0.3,
        barsUsed: candles.length,
    };
}

// ── 做多圖形 ─────────────────────────────────────────────────

function detectDoubleBottom(candles, atr14) {
    const lows   = candles.map(c => parseFloat(c[3]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const closes = candles.map(c => parseFloat(c[4]));
    const troughs = findLocalTroughs(lows, 3);
    if (troughs.length < 2) return null;

    const t2 = troughs[troughs.length - 1];
    const t1 = troughs[troughs.length - 2];
    if (t2.idx - t1.idx < 5) return null;
    if (Math.abs(t1.val - t2.val) / t1.val > TOLERANCE) return null;

    const peakHighs = highs.slice(t1.idx, t2.idx + 1);
    const neckline  = Math.max(...peakHighs);
    if (neckline - t1.val < atr14 * 1.5) return null;

    const cur = closes[closes.length - 1];
    if (cur <= neckline) return null;

    return {
        pattern: 'DOUBLE_BOTTOM', direction: 'LONG',
        confidence: Math.abs(t1.val - t2.val) / t1.val < 0.005 ? 'HIGH' : 'MED',
        neckline, sl: t2.val - atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectInverseHeadShoulders(candles, atr14) {
    const lows   = candles.map(c => parseFloat(c[3]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const closes = candles.map(c => parseFloat(c[4]));
    const troughs = findLocalTroughs(lows, 3);
    if (troughs.length < 3) return null;

    const ls = troughs[troughs.length - 3];
    const hd = troughs[troughs.length - 2];
    const rs = troughs[troughs.length - 1];

    if (hd.val >= ls.val || hd.val >= rs.val) return null;
    if (Math.abs(ls.val - rs.val) / ls.val > TOLERANCE) return null;

    const p1 = Math.max(...highs.slice(ls.idx, hd.idx + 1));
    const p2 = Math.max(...highs.slice(hd.idx, rs.idx + 1));
    const neckline = (p1 + p2) / 2;

    const cur = closes[closes.length - 1];
    if (cur <= neckline) return null;

    return {
        pattern: 'HEAD_SHOULDERS_BOTTOM', direction: 'LONG',
        confidence: 'HIGH',
        neckline, sl: rs.val - atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectFallingWedge(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const slopeH = linearSlope(highs);
    const slopeL = linearSlope(lows);

    if (slopeH >= 0 || slopeL >= 0) return null;
    if (Math.abs(slopeL) <= Math.abs(slopeH)) return null;

    const trendHigh = highs[0] + slopeH * (highs.length - 1);
    const cur = closes[closes.length - 1];
    if (cur <= trendHigh) return null;

    return {
        pattern: 'FALLING_WEDGE', direction: 'LONG',
        confidence: 'MED',
        neckline: trendHigh, sl: Math.min(...lows.slice(-5)) - atr14 * 0.5,
        barsUsed: candles.length,
    };
}

function detectBullFlag(candles, atr14) {
    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const len    = candles.length;

    const poleEnd   = Math.floor(len * 0.6);
    const poleStart = Math.max(0, poleEnd - 20);
    const poleLow   = Math.min(...lows.slice(poleStart, poleEnd));
    const poleHigh  = Math.max(...highs.slice(poleStart, poleEnd));
    const poleRise  = poleHigh - poleLow;
    if (poleRise < atr14 * 3) return null;

    const flagHigh = Math.max(...highs.slice(poleEnd));
    const flagLow  = Math.min(...lows.slice(poleEnd));
    if (flagHigh - flagLow > poleRise * 0.5) return null;
    if (flagLow < poleHigh - poleRise * 0.5) return null;

    const cur = closes[len - 1];
    if (cur <= flagHigh) return null;

    return {
        pattern: 'BULL_FLAG', direction: 'LONG',
        confidence: 'MED',
        neckline: flagHigh, sl: flagLow - atr14 * 0.3, barsUsed: candles.length,
    };
}

function detectRoundingBottom(candles, atr14) {
    const closes = candles.map(c => parseFloat(c[4]));
    const { a, r2 } = quadraticFit(closes);
    if (a <= 0 || r2 < 0.7) return null;

    const troughIdx = Math.floor(closes.length / 2);
    const troughVal = closes[troughIdx];
    const cur = closes[closes.length - 1];
    if (cur <= troughVal + atr14) return null;

    return {
        pattern: 'ROUNDING_BOTTOM', direction: 'LONG',
        confidence: r2 > 0.85 ? 'HIGH' : 'MED',
        neckline: cur, sl: troughVal - atr14 * 0.5, barsUsed: candles.length,
    };
}

function detectIslandBottom(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const len    = candles.length;

    for (let i = 2; i < len - 2; i++) {
        const gapDown = highs[i] < lows[i - 1];
        if (!gapDown) continue;
        for (let j = i + 1; j < len - 1; j++) {
            const gapUp = lows[j] > highs[j - 1];
            if (!gapUp) continue;
            const cur = closes[len - 1];
            if (cur > highs[j]) {
                const islandLow = Math.min(...lows.slice(i, j + 1));
                return {
                    pattern: 'ISLAND_BOTTOM', direction: 'LONG',
                    confidence: 'HIGH',
                    neckline: highs[j], sl: islandLow - atr14 * 0.3,
                    barsUsed: candles.length,
                };
            }
        }
    }
    return null;
}

function detectDiamondBottom(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const half   = Math.floor(candles.length / 2);

    const slopeH1 = linearSlope(highs.slice(0, half));
    const slopeL1 = linearSlope(lows.slice(0, half));
    const slopeH2 = linearSlope(highs.slice(half));
    const slopeL2 = linearSlope(lows.slice(half));

    if (slopeH1 >= 0 || slopeL1 <= 0) return null;
    if (slopeH2 <= 0 || slopeL2 >= 0) return null;

    const trendHigh2 = highs[half] + slopeH2 * (highs.length - half - 1);
    const cur = closes[closes.length - 1];
    if (cur <= trendHigh2) return null;

    return {
        pattern: 'DIAMOND_BOTTOM', direction: 'LONG',
        confidence: 'MED',
        neckline: trendHigh2, sl: Math.min(...lows) - atr14 * 0.5,
        barsUsed: candles.length,
    };
}

function detectVShape(candles, atr14) {
    const lows   = candles.map(c => parseFloat(c[3]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const closes = candles.map(c => parseFloat(c[4]));
    const troughIdx = lows.indexOf(Math.min(...lows));
    const len = candles.length;

    if (troughIdx < 5 || troughIdx > len - 6) return null;

    const leftDrop  = highs[Math.max(0, troughIdx - 15)] - lows[troughIdx];
    const rightRise = closes[len - 1] - lows[troughIdx];
    if (leftDrop < atr14 * 3 || rightRise < atr14 * 3) return null;

    const retrace50 = lows[troughIdx] + (Math.max(...highs.slice(0, troughIdx)) - lows[troughIdx]) * 0.5;
    if (closes[len - 1] <= retrace50) return null;

    return {
        pattern: 'V_SHAPE', direction: 'LONG',
        confidence: 'MED',
        neckline: retrace50, sl: lows[troughIdx] - atr14 * 0.3,
        barsUsed: candles.length,
    };
}

// ── 中性圖形 ─────────────────────────────────────────────────

function detectTriangle(candles, atr14) {
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const closes = candles.map(c => parseFloat(c[4]));
    const slopeH = linearSlope(highs);
    const slopeL = linearSlope(lows);
    const cur    = closes[closes.length - 1];

    const trendHigh = highs[0] + slopeH * (highs.length - 1);
    const trendLow  = lows[0]  + slopeL * (lows.length - 1);

    // 對稱三角形
    if (slopeH < 0 && slopeL > 0) {
        if (cur > trendHigh) return { pattern: 'SYMMETRICAL_TRIANGLE', direction: 'LONG', confidence: 'MED', neckline: trendHigh, sl: trendLow - atr14 * 0.3, barsUsed: candles.length };
        if (cur < trendLow)  return { pattern: 'SYMMETRICAL_TRIANGLE', direction: 'SHORT', confidence: 'MED', neckline: trendLow, sl: trendHigh + atr14 * 0.3, barsUsed: candles.length };
    }

    // 上升三角形（高點持平 + 低點上升）
    if (Math.abs(slopeH) < 0.0001 && slopeL > 0) {
        if (cur > trendHigh) return { pattern: 'ASCENDING_TRIANGLE', direction: 'LONG', confidence: 'MED', neckline: trendHigh, sl: trendLow - atr14 * 0.3, barsUsed: candles.length };
    }

    // 下降三角形（高點下降 + 低點持平）
    if (slopeH < 0 && Math.abs(slopeL) < 0.0001) {
        if (cur < trendLow) return { pattern: 'DESCENDING_TRIANGLE', direction: 'SHORT', confidence: 'MED', neckline: trendLow, sl: trendHigh + atr14 * 0.3, barsUsed: candles.length };
    }

    return null;
}

// ── 優先級排序 ────────────────────────────────────────────────

const PRIORITY = [
    'HEAD_SHOULDERS_TOP', 'HEAD_SHOULDERS_BOTTOM',
    'DOUBLE_TOP', 'DOUBLE_BOTTOM',
    'RISING_WEDGE', 'FALLING_WEDGE',
    'BEAR_FLAG', 'BULL_FLAG',
    'SYMMETRICAL_TRIANGLE', 'ASCENDING_TRIANGLE', 'DESCENDING_TRIANGLE',
    'ROUNDING_TOP', 'ROUNDING_BOTTOM',
    'ISLAND_TOP', 'ISLAND_BOTTOM',
    'DIAMOND_TOP', 'DIAMOND_BOTTOM',
    'INVERTED_V', 'V_SHAPE',
];

// ── 主入口 ───────────────────────────────────────────────────

/**
 * 識別 K 線圖形
 * @param {Array} candles - K 線陣列 [ts, o, h, l, c, v]
 * @param {string} direction - 'LONG' | 'SHORT' | 'ANY'
 * @returns {{ pattern, direction, confidence, neckline, sl, barsUsed } | null}
 */
export function detectPattern(candles, direction = 'ANY') {
    if (!candles || candles.length < MIN_BARS) return null;

    // 取 35~75 根
    const slice = candles.slice(-Math.min(MAX_BARS, candles.length));
    const atr14 = atr(slice, 14);
    if (atr14 === 0) return null;

    const detectors = direction === 'SHORT' ? [
        () => detectHeadShoulders(slice, atr14),
        () => detectDoubleTop(slice, atr14),
        () => detectRisingWedge(slice, atr14),
        () => detectBearFlag(slice, atr14),
        () => detectTriangle(slice, atr14),
        () => detectRoundingTop(slice, atr14),
        () => detectIslandTop(slice, atr14),
        () => detectDiamondTop(slice, atr14),
        () => detectInvertedV(slice, atr14),
    ] : direction === 'LONG' ? [
        () => detectInverseHeadShoulders(slice, atr14),
        () => detectDoubleBottom(slice, atr14),
        () => detectFallingWedge(slice, atr14),
        () => detectBullFlag(slice, atr14),
        () => detectTriangle(slice, atr14),
        () => detectRoundingBottom(slice, atr14),
        () => detectIslandBottom(slice, atr14),
        () => detectDiamondBottom(slice, atr14),
        () => detectVShape(slice, atr14),
    ] : [
        () => detectHeadShoulders(slice, atr14),
        () => detectInverseHeadShoulders(slice, atr14),
        () => detectDoubleTop(slice, atr14),
        () => detectDoubleBottom(slice, atr14),
        () => detectRisingWedge(slice, atr14),
        () => detectFallingWedge(slice, atr14),
        () => detectBearFlag(slice, atr14),
        () => detectBullFlag(slice, atr14),
        () => detectTriangle(slice, atr14),
        () => detectRoundingTop(slice, atr14),
        () => detectRoundingBottom(slice, atr14),
        () => detectIslandTop(slice, atr14),
        () => detectIslandBottom(slice, atr14),
        () => detectDiamondTop(slice, atr14),
        () => detectDiamondBottom(slice, atr14),
        () => detectInvertedV(slice, atr14),
        () => detectVShape(slice, atr14),
    ];

    const results = detectors.map(fn => fn()).filter(Boolean);
    if (!results.length) return null;

    // 依優先級排序，取最高優先的
    results.sort((a, b) => PRIORITY.indexOf(a.pattern) - PRIORITY.indexOf(b.pattern));
    return results[0];
}

// ── FVG 偵測 ─────────────────────────────────────────────────────

/**
 * 偵測公允價值缺口（Fair Value Gap / Imbalance）
 *
 * 多頭 FVG：candles[i-2].high < candles[i].low  → 中間留下看漲缺口（支撐）
 * 空頭 FVG：candles[i-2].low  > candles[i].high → 中間留下看跌缺口（壓力）
 *
 * @param {Array}  candles      - K線陣列 [time, open, high, low, close, ...]
 * @param {number} currentPrice - 當前價格
 * @param {string} side         - 'LONG' | 'SHORT'
 * @param {number} lookback     - 往回掃描幾根（預設 30）
 * @returns {{ inZone, zone, gaps, nearestGap, zoneStr }}
 */
export function detectFVG(candles, currentPrice, side, lookback = 30) {
    const empty = { inZone: false, zone: null, gaps: [], nearestGap: null, zoneStr: '' };
    if (!candles || candles.length < 3) return empty;

    const n     = candles.length;
    const start = Math.max(2, n - lookback);
    const gaps  = [];

    for (let i = start; i < n; i++) {
        const highPrev = parseFloat(candles[i - 2][2]);
        const lowPrev  = parseFloat(candles[i - 2][3]);
        const highCur  = parseFloat(candles[i][2]);
        const lowCur   = parseFloat(candles[i][3]);

        if (side === 'LONG') {
            // 看漲 FVG：bar[i-2].high < bar[i].low
            if (highPrev < lowCur) {
                const gapPct = (lowCur - highPrev) / highPrev * 100;
                if (gapPct >= 0.2) {
                    gaps.push({ type: 'BULL', low: highPrev, high: lowCur,
                        mid: (highPrev + lowCur) / 2, candle: i, pct: gapPct });
                }
            }
        } else {
            // 看跌 FVG：bar[i-2].low > bar[i].high
            if (lowPrev > highCur) {
                const gapPct = (lowPrev - highCur) / lowPrev * 100;
                if (gapPct >= 0.2) {
                    gaps.push({ type: 'BEAR', low: highCur, high: lowPrev,
                        mid: (highCur + lowPrev) / 2, candle: i, pct: gapPct });
                }
            }
        }
    }

    if (!gaps.length) return empty;

    // 最近形成的缺口排前面
    gaps.sort((a, b) => b.candle - a.candle);

    // 當前價格落在缺口區間內 → inZone = true
    for (const gap of gaps) {
        if (currentPrice >= gap.low && currentPrice <= gap.high) {
            return {
                inZone: true, zone: gap, gaps, nearestGap: gap,
                zoneStr: `${gap.low.toFixed(4)}–${gap.high.toFixed(4)} (${gap.pct.toFixed(1)}%)`,
            };
        }
    }

    // 未在缺口內，找距離最近的缺口供參考
    const nearest = gaps.reduce((best, g) => {
        const dist     = Math.min(Math.abs(currentPrice - g.low), Math.abs(currentPrice - g.high));
        const bestDist = Math.min(Math.abs(currentPrice - best.low), Math.abs(currentPrice - best.high));
        return dist < bestDist ? g : best;
    }, gaps[0]);

    return { inZone: false, zone: null, gaps, nearestGap: nearest, zoneStr: '' };
}

// ── 平行通道偵測 ──────────────────────────────────────────────────

/**
 * 找擺動高/低點（左右各 lb 根都需確認）
 * @param {number[]} vals   - 高點陣列或低點陣列
 * @param {boolean}  isHigh - true=找高點, false=找低點
 * @param {number}   lb     - 左右確認根數
 * @returns {{ idx, val }[]}
 */
function findSwingPoints(vals, isHigh, lb = 2) {
    const pts = [];
    for (let i = lb; i < vals.length - lb; i++) {
        let ok = true;
        for (let j = i - lb; j <= i + lb; j++) {
            if (j === i) continue;
            if (isHigh  && vals[j] >= vals[i]) { ok = false; break; }
            if (!isHigh && vals[j] <= vals[i]) { ok = false; break; }
        }
        if (ok) pts.push({ idx: i, val: vals[i] });
    }
    return pts;
}

/**
 * 最小二乘線性回歸
 * @param {{ idx, val }[]} pts
 * @returns {{ slope, intercept }}
 */
function linReg(pts) {
    const n = pts.length;
    if (n < 2) return { slope: 0, intercept: pts[0]?.val ?? 0 };
    const sx  = pts.reduce((s, p) => s + p.idx, 0);
    const sy  = pts.reduce((s, p) => s + p.val, 0);
    const sxy = pts.reduce((s, p) => s + p.idx * p.val, 0);
    const sx2 = pts.reduce((s, p) => s + p.idx * p.idx, 0);
    const det = n * sx2 - sx * sx;
    if (det === 0) return { slope: 0, intercept: sy / n };
    const slope = (n * sxy - sx * sy) / det;
    return { slope, intercept: (sy - slope * sx) / n };
}

/**
 * 偵測平行通道（上升 / 下降 / 水平）並計算當前價格位置
 *
 * 步驟：
 *   1. 找近 lookback 根的擺動高/低點
 *   2. 分別對高點、低點做線性回歸 → 上軌 / 下軌
 *   3. 驗證是否平行（斜率差距合理）
 *   4. 計算 position（0 = 下軌，1 = 上軌）
 *
 * @param {Array}  candles      - K線陣列
 * @param {number} currentPrice - 當前價格
 * @param {string} side         - 'LONG' | 'SHORT'
 * @param {number} lookback     - 使用最近幾根K線（預設 60）
 * @returns {{ detected, aligned, atBoundary, chasingRisk, position, type, ... }}
 */
export function detectChannel(candles, currentPrice, side, lookback = 60) {
    const empty = {
        detected: false, aligned: false, atBoundary: false,
        chasingRisk: false, position: 0.5, type: '水平',
        upperLine: 0, lowerLine: 0, channelWidth: 0, slopePct: 0,
    };
    if (!candles || candles.length < 20) return empty;

    const slice    = candles.slice(-lookback);
    const n        = slice.length;
    const highs    = slice.map(c => parseFloat(c[2]));
    const lows     = slice.map(c => parseFloat(c[3]));
    const closes   = slice.map(c => parseFloat(c[4]));
    const avgClose = closes.reduce((a, b) => a + b, 0) / n;

    // 找擺動高/低點（左右各 2 根確認）
    const swingHighs = findSwingPoints(highs, true,  2);
    const swingLows  = findSwingPoints(lows,  false, 2);
    if (swingHighs.length < 2 || swingLows.length < 2) return empty;

    // 對擺動點做線性回歸
    const upperReg = linReg(swingHighs);
    const lowerReg = linReg(swingLows);

    // 最後一根K線位置的通道上下軌值
    const lastIdx  = n - 1;
    const upperNow = upperReg.slope * lastIdx + upperReg.intercept;
    const lowerNow = lowerReg.slope * lastIdx + lowerReg.intercept;
    if (upperNow <= lowerNow) return empty;

    const channelWidth = upperNow - lowerNow;

    // 平行性驗證
    const slopeDiff   = Math.abs(upperReg.slope - lowerReg.slope);
    const avgSlopeAbs = (Math.abs(upperReg.slope) + Math.abs(lowerReg.slope)) / 2;
    const isParallel  = avgSlopeAbs < avgClose * 0.00005
        ? slopeDiff < avgClose * 0.00005
        : slopeDiff / avgSlopeAbs < 0.6;
    if (!isParallel) return empty;

    // 通道方向（整段通道斜率轉百分比）
    const avgSlope = (upperReg.slope + lowerReg.slope) / 2;
    const slopePct = (avgSlope * n) / avgClose * 100;
    const type     = slopePct >  1.0 ? '上升'
                   : slopePct < -1.0 ? '下降'
                   :                   '水平';

    // 方向與訊號是否一致
    const aligned =
        (side === 'LONG'  && type !== '下降') ||
        (side === 'SHORT' && type !== '上升');

    // 價格在通道中的相對位置（0 = 下軌, 1 = 上軌）
    const position = Math.max(0, Math.min(1, (currentPrice - lowerNow) / channelWidth));

    // 在有利邊界進場（做多靠下軌，做空靠上軌）
    const atBoundary =
        (side === 'LONG'  && position < 0.25) ||
        (side === 'SHORT' && position > 0.75);

    // 追高/追低警告
    const chasingRisk =
        (side === 'LONG'  && position > 0.75) ||
        (side === 'SHORT' && position < 0.25);

    return {
        detected: true,
        aligned,
        atBoundary,
        chasingRisk,
        position,
        type,
        upperLine: upperNow,
        lowerLine: lowerNow,
        channelWidth,
        slopePct,
    };
}

// ── 多時框型態分析 ────────────────────────────────────────────

/**
 * 同時回傳 15m / 30m / 1h 三個時框的型態分析結果
 */
export function detectPatternMultiTF(candles15, candles30, candles1h, direction) {
    return {
        tf15m: detectPattern(candles15, direction),
        tf30m: detectPattern(candles30, direction),
        tf1h:  detectPattern(candles1h,  direction),
    };
}
