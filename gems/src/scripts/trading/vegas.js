/**
 * Vegas Channel 策略：進場偵測
 *
 * 邏輯：EMA144/169 形成通道，價格突破通道 + MSS13 確認 → 進場
 * TP 用 Fib13 擴展計算
 */

export function vegasEMA(closes, period) {
    const k = 2 / (period + 1);
    let val = closes[0];
    const result = [val];
    for (let i = 1; i < closes.length; i++) {
        val = closes[i] * k + val * (1 - k);
        result.push(val);
    }
    return result;
}

export function vegasSwingLow(candles, idx, lookback = 5) {
    const start = Math.max(0, idx - lookback);
    let low = Infinity;
    for (let i = start; i <= idx; i++) low = Math.min(low, parseFloat(candles[i][3]));
    return low;
}

export function vegasSwingHigh(candles, idx, lookback = 5) {
    const start = Math.max(0, idx - lookback);
    let high = -Infinity;
    for (let i = start; i <= idx; i++) high = Math.max(high, parseFloat(candles[i][2]));
    return high;
}

export function vegasCheckMSS(candles, idx, side, lookback = 13) {
    if (idx < lookback * 2) return false;
    if (side === 'LONG') {
        const sl1 = vegasSwingLow(candles, idx - lookback, lookback);
        const sl2 = vegasSwingLow(candles, idx - lookback * 2, lookback);
        return sl1 > sl2;
    } else {
        const sh1 = vegasSwingHigh(candles, idx - lookback, lookback);
        const sh2 = vegasSwingHigh(candles, idx - lookback * 2, lookback);
        return sh1 < sh2;
    }
}

export function vegasDetectSignal(candles15m) {
    if (!candles15m || candles15m.length < 200) return null;
    const closes = candles15m.map(c => parseFloat(c[4]));
    const ema144 = vegasEMA(closes, 144);
    const ema169 = vegasEMA(closes, 169);
    const i = candles15m.length - 1;
    const close = closes[i];
    const prevClose = closes[i - 1];
    const channelTop    = Math.max(ema144[i], ema169[i]);
    const channelBottom = Math.min(ema144[i], ema169[i]);

    if (prevClose < channelBottom && close > channelTop && vegasCheckMSS(candles15m, i, 'LONG')) {
        const sl = close * (1 - 0.7 / 10);
        const swLow  = vegasSwingLow(candles15m, i, 13);
        const swHigh = vegasSwingHigh(candles15m, i, 13);
        const swing  = swHigh - swLow;
        return { side: 'LONG', price: close, sl,
            tp1: swHigh + swing * 0.618, tp2: swHigh + swing * 1.0, tp3: swHigh + swing * 1.618 };
    }
    if (prevClose > channelTop && close < channelBottom && vegasCheckMSS(candles15m, i, 'SHORT')) {
        const sl = close * (1 + 0.7 / 10);
        const swLow  = vegasSwingLow(candles15m, i, 13);
        const swHigh = vegasSwingHigh(candles15m, i, 13);
        const swing  = swHigh - swLow;
        return { side: 'SHORT', price: close, sl,
            tp1: swLow - swing * 0.618, tp2: swLow - swing * 1.0, tp3: swLow - swing * 1.618 };
    }
    return null;
}

// 4h CHoCH 偵測：前 5 根 4h 最低點被收盤跌破（多單）或最高點被突破（空單）
export function vegasCheck4hCHoCH(candles4h, side, lookback = 5) {
    if (!candles4h || candles4h.length < lookback + 1) return false;
    const len = candles4h.length;
    const close = parseFloat(candles4h[len - 1][4]);
    if (side === 'LONG') {
        const recentLows = candles4h.slice(len - lookback - 1, len - 1).map(c => parseFloat(c[3]));
        return close < Math.min(...recentLows);
    } else {
        const recentHighs = candles4h.slice(len - lookback - 1, len - 1).map(c => parseFloat(c[2]));
        return close > Math.max(...recentHighs);
    }
}
