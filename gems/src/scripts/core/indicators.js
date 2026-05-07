/**
 * 技術指標工具函數
 * 供 scanner.js、loops/ 等模組共用
 */

export function ema(closes, period) {
    if (closes.length < period) return closes[closes.length - 1];
    const k = 2 / (period + 1);
    let val = closes[0];
    for (let i = 1; i < closes.length; i++) val = closes[i] * k + val * (1 - k);
    return val;
}

export function rsi(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgG = gains / period, avgL = losses / period;
    return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
}

export function rsiTriple(closes) {
    const r6  = rsi(closes, 6);
    const r12 = rsi(closes, 12);
    const r24 = rsi(closes, 24);
    const prev = closes.slice(0, -1);
    const pr12 = rsi(prev, 12);
    const pr24 = rsi(prev, 24);
    return {
        r6, r12, r24,
        goldenCross: pr12 < pr24 && r12 >= r24,
        deathCross:  pr12 > pr24 && r12 <= r24,
        bullAlign:   r6 > r12 && r12 > r24 && r24 > 50,
        bearAlign:   r6 < r12 && r12 < r24 && r24 < 50,
    };
}

export function macd(closes) {
    if (closes.length < 35) return { macdLine: 0, signal: 0, hist: 0, bullish: false, bearish: false, crossUp: false, crossDown: false };
    const macdSeries = closes.slice(-35).map((_, i, arr) => {
        const sl = arr.slice(0, i + 1);
        return ema(sl, 12) - ema(sl, 26);
    });
    const macdLine   = ema(closes, 12) - ema(closes, 26);
    const signalLine = ema(macdSeries, 9);
    const hist       = macdLine - signalLine;
    return {
        macdLine, signal: signalLine, hist,
        bullish:   hist > 0,
        bearish:   hist < 0,
        crossUp:   macdSeries[macdSeries.length-2] < signalLine && macdLine >= signalLine,
        crossDown: macdSeries[macdSeries.length-2] > signalLine && macdLine <= signalLine,
    };
}

export function bollingerBands(closes, period = 20, mult = 2) {
    if (closes.length < period) return { upper: 0, mid: 0, lower: 0, width: 0, pct: 0.5 };
    const slice = closes.slice(-period);
    const mid   = slice.reduce((a, b) => a + b, 0) / period;
    const std   = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period);
    const upper = mid + mult * std;
    const lower = mid - mult * std;
    const cur   = closes[closes.length - 1];
    return {
        upper, mid, lower,
        width: (upper - lower) / mid,
        pct:   (cur - lower) / (upper - lower),
    };
}

export function atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = candles.slice(-period - 1).map((c, i, arr) => {
        if (i === 0) return parseFloat(c[2]) - parseFloat(c[3]);
        const h = parseFloat(c[2]), l = parseFloat(c[3]), pc = parseFloat(arr[i - 1][4]);
        return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    return trs.slice(1).reduce((a, b) => a + b, 0) / period;
}

export function avgVolume(candles, period = 20) {
    return candles.slice(-period - 1, -1)
        .reduce((a, c) => a + parseFloat(c[5] || c[7] || 0), 0) / period;
}

export function adx(candles, period = 14) {
    if (candles.length < period * 2) return 25;
    const slice = candles.slice(-period * 2);
    const trs = [], plusDMs = [], minusDMs = [];
    for (let i = 1; i < slice.length; i++) {
        const h = parseFloat(slice[i][2]), l = parseFloat(slice[i][3]), pc = parseFloat(slice[i-1][4]);
        const ph = parseFloat(slice[i-1][2]), pl = parseFloat(slice[i-1][3]);
        trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
        const up = h - ph, down = pl - l;
        plusDMs.push(up > down && up > 0 ? up : 0);
        minusDMs.push(down > up && down > 0 ? down : 0);
    }
    const atrV = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    if (atrV === 0) return 25;
    const plusDI  = plusDMs.slice(-period).reduce((a, b) => a + b, 0) / period / atrV * 100;
    const minusDI = minusDMs.slice(-period).reduce((a, b) => a + b, 0) / period / atrV * 100;
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 1e-9) * 100;
    return dx;
}
