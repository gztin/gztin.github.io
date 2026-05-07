/**
 * 技術分析層
 * fetchBingxKlines, fetchBinanceData, fetch24hTicker, fetchOIContext,
 * getMultiTfAnalysis, calculateRSIScore, checkTrendConsistency, formatReport
 */

import fs from 'fs';
import path from 'path';
import { BOT_CONFIG } from '../config/bot.config.js';
import { ema, rsi, atr, avgVolume } from '../core/indicators.js';
import { curl } from '../core/telegram_api.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

function logDebug(message) {
    const timestamp = new Date().toISOString();
    console.log(`[DEBUG] [${timestamp}] ${message}`);
}

export function formatPrice(p) { if (p == null) return '--'; return p < 1 ? p.toPrecision(4) : p.toFixed(2); }

// 特殊幣種：直接走 BingX，不走 Binance
const BINGX_ONLY_SYMBOLS = {
    'NCCO1OILWTI2USD': 'NCCO1OILWTI2USD-USDT',
    'NCCOGOLD2USD':    'NCCOGOLD2USD-USDT',
    'NCCOXAG2USD':     'NCCOXAG2USD-USDT',
};

export async function fetchBingxKlines(bxSymbol, interval, limit = 100) {
    const url = `https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=${encodeURIComponent(bxSymbol)}&interval=${interval}&limit=${limit}`;
    const data = await curl(url);
    if (data?.code === 0 && data.data?.length >= 20) {
        return data.data.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
    }
    return null;
}

export async function fetchBinanceData(symbol, interval = '15m') {
    const bxSymbol = BINGX_ONLY_SYMBOLS[symbol];
    if (bxSymbol) {
        return await fetchBingxKlines(bxSymbol, interval);
    }

    const pair = `${symbol}USDT`.toUpperCase();
    const urls = [`https://fapi.binance.com/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=100`, `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=100`];
    for (const url of urls) {
        const data = await curl(url);
        if (data && Array.isArray(data) && data.length > 0) {
            fs.writeFileSync(path.join(DATA_DIR, `${symbol}USDT_${interval}.json`), JSON.stringify(data));
            return data;
        }
    }
    const fallbackSymbol = `${symbol}-USDT`;
    return await fetchBingxKlines(fallbackSymbol, interval);
}

const BINGX_TICKER_MAP = {
    'XAU':    'NCCOGOLD2USD-USDT',
    'GOLD':   'NCCOGOLD2USD-USDT',
    'OIL':    'NCCO1OILWTI2USD-USDT',
    'WTI':    'NCCO1OILWTI2USD-USDT',
    'OIL100': 'NCCOOILWTI2USD-USDT',
    'WTI100': 'NCCOOILWTI2USD-USDT',
    'XAG':    'NCCOXAG2USD-USDT',
    'SILVER': 'NCCOXAG2USD-USDT',
};

export async function fetch24hTicker(symbol) {
    const bxSym = BINGX_TICKER_MAP[symbol.toUpperCase()];
    if (bxSym) {
        try {
            const res = await curl(`https://open-api.bingx.com/openApi/swap/v2/quote/ticker?symbol=${bxSym}`);
            if (res?.code === 0 && res.data?.lastPrice) {
                return {
                    price: parseFloat(res.data.lastPrice),
                    change24h: parseFloat(res.data.priceChangePercent)
                };
            }
        } catch (e) {}
        return null;
    }
    const pair = `${symbol}USDT`.toUpperCase();
    const urls = [
        `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${pair}`,
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`
    ];
    for (const url of urls) {
        const data = await curl(url);
        if (data && data.lastPrice) {
            return {
                price: parseFloat(data.lastPrice),
                change24h: parseFloat(data.priceChangePercent)
            };
        }
    }
    return null;
}

export async function fetchOIContext(symbol, period = '1h') {
    const pair = `${symbol.replace('USDT', '').replace('-', '').toUpperCase()}USDT`;
    const base = 'https://fapi.binance.com';
    const topArr = await curl(`${base}/futures/data/topLongShortPositionRatio?symbol=${pair}&period=${period}&limit=1`);
    const globalArr = await curl(`${base}/futures/data/globalLongShortAccountRatio?symbol=${pair}&period=${period}&limit=1`);
    const takerArr = await curl(`${base}/futures/data/takerlongshortRatio?symbol=${pair}&period=${period}&limit=1`);
    if (!topArr?.length && !globalArr?.length && !takerArr?.length) return null;
    const topRatio = parseFloat(topArr?.[0]?.longShortRatio) || 1.0;
    const globalRatio = parseFloat(globalArr?.[0]?.longShortRatio) || 1.0;
    const takerRatio = parseFloat(takerArr?.[0]?.buySellRatio) || 1.0;
    const smartSide = topRatio > 1.05 ? 'LONG' : topRatio < 0.95 ? 'SHORT' : 'NEUTRAL';
    const retailSide = globalRatio > 1.05 ? 'LONG' : globalRatio < 0.95 ? 'SHORT' : 'NEUTRAL';
    const divergence = smartSide !== 'NEUTRAL' && retailSide !== 'NEUTRAL' && smartSide !== retailSide;
    const strength = Math.abs(topRatio - 1.0) * 100;
    const takerConfirm = (smartSide === 'LONG' && takerRatio > 1.0) || (smartSide === 'SHORT' && takerRatio < 1.0);
    const conviction = Math.min(100, Math.round(30 + strength * 2 + (divergence ? 15 : 0) + (takerConfirm ? 10 : 0)));
    let slMul = 1.0, tpMul = 1.0;
    if (smartSide !== 'NEUTRAL') {
        if (divergence) { tpMul = 1.0 + Math.min(strength * 0.005, 0.25); slMul = 1.0 + Math.min(strength * 0.002, 0.15); }
        else { tpMul = 1.0 + Math.min(strength * 0.0015, 0.10); }
        if (takerConfirm) tpMul += 0.05;
    }
    return { topRatio, globalRatio, takerRatio, smartSide, retailSide, divergence, conviction, slMul, tpMul };
}

export function calculateRSIScore(rsi6, rsi12, rsi24, prevR12, prevR24) {
    const r24Weight = 0.5, r12Weight = 0.3, r6Weight = 0.2;
    const baseScore = rsi24 * r24Weight + rsi12 * r12Weight + rsi6 * r6Weight;
    let trendBonus = 0;
    if (prevR12 !== undefined && prevR24 !== undefined) {
        if (rsi12 > rsi24 && prevR12 <= prevR24) {
            trendBonus = 10;
        } else if (rsi12 < rsi24 && prevR12 >= prevR24) {
            trendBonus = -10;
        }
    }
    return Math.max(0, Math.min(100, Math.round(baseScore + trendBonus)));
}

export function checkTrendConsistency(results, targetSide, keyTimeframes = ['15m', '1h', '4h']) {
    let consistentCount = 0;
    for (const tf of keyTimeframes) {
        if (results[tf] && results[tf].side === targetSide) {
            consistentCount++;
        }
    }
    return consistentCount;
}

// --- Technical Indicators & Analysis (Condensed) ---
const TA = {
    calculateEMA(v, p) { if (v.length < p) return Array(v.length).fill(0); const k = 2 / (p + 1); const r = [v[0]]; for (let i = 1; i < v.length; i++) r.push(v[i] * k + r[i - 1] * (1 - k)); return r; },
    calculateRSI(v, p) { if (v.length < p + 1) return Array(v.length).fill(50); const c = v.map((x, i) => i === 0 ? 0 : x - v[i - 1]); const g = c.map(x => x > 0 ? x : 0); const l = c.map(x => x < 0 ? Math.abs(x) : 0); let ag = g.slice(1, p + 1).reduce((a, b) => a + b, 0) / p; let al = l.slice(1, p + 1).reduce((a, b) => a + b, 0) / p; const r = Array(p + 1).fill(50); for (let i = p + 1; i < v.length; i++) { ag = (ag * (p - 1) + g[i]) / p; al = (al * (p - 1) + l[i]) / p; const rs = al === 0 ? 100 : ag / al; r.push(100 - 100 / (1 + rs)); } return r; },
    calculateATR(h, l, c, p) { if (h.length < p + 1) return Array(h.length).fill(0); const trs = h.map((x, i) => i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1]))); let atr = trs.slice(0, p).reduce((a, b) => a + b, 0) / p; const r = Array(p).fill(atr); for (let i = p; i < trs.length; i++) { atr = (atr * (p - 1) + trs[i]) / p; r.push(atr); } return r; },
    calculateMACD(v, f = 12, s = 26, si = 9) { const emAf = this.calculateEMA(v, f); const emAs = this.calculateEMA(v, s); const diff = emAf.map((x, i) => x - emAs[i]); const sig = this.calculateEMA(diff.slice(s), si); return { macd: diff.pop(), signal: sig.pop(), hist: diff.pop() - sig.pop() }; },
    calculateBB(v, p = 20, d = 2) { if (v.length < p) return { mid: 0, upper: 0, lower: 0 }; const sma = v.slice(-p).reduce((a, b) => a + b, 0) / p; const variance = v.slice(-p).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / p; const stdDev = Math.sqrt(variance); return { mid: sma, upper: sma + d * stdDev, lower: sma - d * stdDev }; },
    detectPattern(candles) {
        if (candles.length < 2) return null;
        const c = candles[candles.length - 1]; const p = candles[candles.length - 2];
        const [o, h, l, cl] = [parseFloat(c[1]), parseFloat(c[2]), parseFloat(c[3]), parseFloat(c[4])];
        const [po, ph, pl, pcl] = [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]), parseFloat(p[4])];
        const body = Math.abs(cl - o); const upperWick = h - Math.max(o, cl); const lowerWick = Math.min(o, cl) - l;
        if (lowerWick > body * 2 && upperWick < body * 0.5) return '錘子線 (Hammer)';
        if (upperWick > body * 2 && lowerWick < body * 0.5) return '流星線 (Shooting Star)';
        if (pcl < po && cl > o && cl > po && o < pcl) return '看漲吞沒 (Bullish Engulfing)';
        if (pcl > po && cl < o && cl < po && o > pcl) return '看跌吞沒 (Bearish Engulfing)';
        return null;
    },
    detect123Pattern(candles) {
        if (candles.length < 30) return null;
        const closes = candles.map(c => parseFloat(c[4]));
        const highs = candles.map(c => parseFloat(c[2]));
        const lows = candles.map(c => parseFloat(c[3]));
        const curPrice = closes[closes.length - 1];
        let p1Idx = -1, p1Val = -Infinity;
        for (let i = highs.length - 30; i < highs.length - 5; i++) { if (highs[i] > p1Val) { p1Val = highs[i]; p1Idx = i; } }
        if (p1Idx !== -1) {
            let p2Idx = -1, p2Val = Infinity;
            for (let i = p1Idx + 1; i < lows.length - 2; i++) { if (lows[i] < p2Val) { p2Val = lows[i]; p2Idx = i; } }
            if (p2Idx !== -1) {
                let p3Idx = -1, p3Val = -Infinity;
                for (let i = p2Idx + 1; i < highs.length - 1; i++) { if (highs[i] > p3Val) { p3Val = highs[i]; p3Idx = i; } }
                if (p3Idx !== -1 && p3Val < p1Val && curPrice < p2Val) return { type: 'BEARISH_123', p1: p1Val, p2: p2Val, p3: p3Val };
            }
        }
        p1Idx = -1; p1Val = Infinity;
        for (let i = lows.length - 30; i < lows.length - 5; i++) { if (lows[i] < p1Val) { p1Val = lows[i]; p1Idx = i; } }
        if (p1Idx !== -1) {
            let p2Idx = -1, p2Val = -Infinity;
            for (let i = p1Idx + 1; i < highs.length - 2; i++) { if (highs[i] > p2Val) { p2Val = highs[i]; p2Idx = i; } }
            if (p2Idx !== -1) {
                let p3Idx = -1, p3Val = Infinity;
                for (let i = p2Idx + 1; i < lows.length - 1; i++) { if (lows[i] < p3Val) { p3Val = lows[i]; p3Idx = i; } }
                if (p3Idx !== -1 && p3Val > p1Val && curPrice > p2Val) return { type: 'BULLISH_123', p1: p1Val, p2: p2Val, p3: p3Val };
            }
        }
        return null;
    },
    detectSMC(candles) {
        if (candles.length < 5) return { fvg: null, ob: null };
        const len = candles.length;
        const c = (i) => ({ h: parseFloat(candles[len - 1 - i][2]), l: parseFloat(candles[len - 1 - i][3]), o: parseFloat(candles[len - 1 - i][1]), cl: parseFloat(candles[len - 1 - i][4]) });
        let fvg = null;
        if (c(2).h < c(0).l) fvg = { type: 'BULLISH_FVG', top: c(0).l, bottom: c(2).h };
        if (c(2).l > c(0).h) fvg = { type: 'BEARISH_FVG', top: c(2).l, bottom: c(0).h };
        let ob = null;
        const lookback = 20;
        for (let i = 1; i < lookback; i++) {
            const cur = c(i); const prev = c(i + 1); if (!prev) break;
            const body = Math.abs(cur.cl - cur.o);
            const avgBody = candles.slice(-20).reduce((a, b) => a + Math.abs(parseFloat(b[4]) - parseFloat(b[1])), 0) / 20;
            if (body > avgBody * 1.5) {
                if (cur.cl > cur.o && prev.cl < prev.o) ob = { type: 'BULLISH_OB', price: prev.h };
                if (cur.cl < cur.o && prev.cl > prev.o) ob = { type: 'BEARISH_OB', price: prev.l };
                if (ob) break;
            }
        }
        return { fvg, ob };
    },
    detectSNR(candles) {
        if (candles.length < 50) return { resists: [], supports: [] };
        const highs = candles.map(c => parseFloat(c[2])); const lows = candles.map(c => parseFloat(c[3]));
        const p = 5; const resists = [], supports = [];
        for (let i = p; i < highs.length - p; i++) {
            if (highs[i] === Math.max(...highs.slice(i - p, i + p + 1))) resists.push(highs[i]);
            if (lows[i] === Math.min(...lows.slice(i - p, i + p + 1))) supports.push(lows[i]);
        }
        const filterLevels = (lvls) => {
            const sorted = lvls.sort((a, b) => a - b); const unique = []; if (sorted.length > 0) unique.push(sorted[0]);
            for (let i = 1; i < sorted.length; i++) { if ((sorted[i] - unique[unique.length - 1]) / unique[unique.length - 1] > 0.005) unique.push(sorted[i]); }
            return unique;
        };
        return { resists: filterLevels(resists).reverse().slice(0, 3), supports: filterLevels(supports).reverse().slice(0, 3) };
    },
    detectDivergence(candles, rsiValues, lookback = 30) {
        if (candles.length < lookback || rsiValues.length < lookback) return null;
        const pHighs = [], rHighs = [];
        const pLows = [], rLows = [];
        for (let i = candles.length - lookback; i < candles.length - 2; i++) {
            const h = parseFloat(candles[i][2]), l = parseFloat(candles[i][3]), r = rsiValues[i];
            const nh = parseFloat(candles[i+1][2]), nl = parseFloat(candles[i+1][3]);
            const ph = parseFloat(candles[i-1][2]), pl = parseFloat(candles[i-1][3]);
            if (h > ph && h > nh) { pHighs.push({ v: h, i }); rHighs.push({ v: r, i }); }
            if (l < pl && l < nl) { pLows.push({ v: l, i }); rLows.push({ v: r, i }); }
        }
        if (pHighs.length >= 2) {
            const last = pHighs[pHighs.length - 1], prev = pHighs[pHighs.length - 2];
            const rlast = rHighs[pHighs.length - 1], rprev = rHighs[pHighs.length - 2];
            if (last.v > prev.v && rlast.v < rprev.v && rlast.v > 50) return '看跌背離 (Bearish Divergence)';
        }
        if (pLows.length >= 2) {
            const last = pLows[pLows.length - 1], prev = pLows[pLows.length - 2];
            if (rLows.length < 2) return null;
            const rlast = rLows[rLows.length - 1], rprev = rLows[rLows.length - 2];
            if (last.v < prev.v && rlast.v > rprev.v && rlast.v < 50) return '看漲背離 (Bullish Divergence)';
        }
        return null;
    },
    detectVolumeSpike(candles, lookback = 20) {
        if (candles.length < lookback + 1) return false;
        const curVol = parseFloat(candles[candles.length - 1][5] || candles[candles.length - 1][7]);
        const prevVols = candles.slice(-lookback - 1, -1).map(c => parseFloat(c[5] || c[7]));
        const avgVol = prevVols.reduce((a, b) => a + b, 0) / lookback;
        return curVol > avgVol * 2.0;
    },
    calculateWickRatio(candle) {
        const [o, h, l, cl] = [parseFloat(candle[1]), parseFloat(candle[2]), parseFloat(candle[3]), parseFloat(candle[4])];
        const body = Math.abs(cl - o); const upperWick = h - Math.max(o, cl); const lowerWick = Math.min(o, cl) - l;
        return { body, upperRatio: body === 0 ? upperWick : upperWick / body, lowerRatio: body === 0 ? lowerWick : lowerWick / body };
    },
    async calculateAhr999(currentPrice) {
        const genesisDate = new Date('2009-01-03');
        const now = new Date();
        const days = Math.floor((now - genesisDate) / (24 * 60 * 60 * 1000));
        const growthValuation = Math.pow(10, 5.84 * Math.log10(days) - 17.01);
        const d1Data = await fetchBinanceData('BTC', '1d');
        if (!d1Data || d1Data.length < 200) return null;
        const closes = d1Data.map(c => parseFloat(c[4]));
        const sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
        const ahr999 = (currentPrice / sma200) * (currentPrice / growthValuation);
        return ahr999;
    },
    calculateProbability(analysis) {
        let score = 0;
        const { main } = analysis;
        if (!main) return 50;
        if (main.side !== 'NEUTRAL') score += 20;
        let zoneScore = 0;
        const price = main.price;
        const fibRange = main.side === 'LONG' ? main.fibZoneInv : main.fibZone;
        if (fibRange && price >= Math.min(...fibRange) && price <= Math.max(...fibRange)) zoneScore += 30;
        if (main.bb) {
            if (main.side === 'LONG' && price < main.bb.mid) zoneScore += 10;
            if (main.side === 'SHORT' && price > main.bb.mid) zoneScore += 10;
        }
        score += Math.min(40, zoneScore);
        let signalScore = 0;
        if (main.divergence) signalScore += 15;
        if (main.pattern) signalScore += 15;
        score += signalScore;
        if (main.volSpike) score += 10;
        return Math.min(100, score);
    },
    detectMarketStructure(candles) {
        if (candles.length < 10) return { bos: null, choch: null, swingHighs: [], swingLows: [] };
        const highs = candles.map(c => parseFloat(c[2]));
        const lows  = candles.map(c => parseFloat(c[3]));
        const closes = candles.map(c => parseFloat(c[4]));
        const len = candles.length;
        const swingHighs = [], swingLows = [];
        for (let i = 3; i < len - 3; i++) {
            if (highs[i] === Math.max(...highs.slice(i - 3, i + 4))) swingHighs.push({ idx: i, price: highs[i] });
            if (lows[i]  === Math.min(...lows.slice(i - 3, i + 4)))  swingLows.push({ idx: i, price: lows[i] });
        }
        const lastClose = closes[len - 1];
        let bos = null, choch = null;
        if (swingHighs.length >= 2) {
            const prevHigh = swingHighs[swingHighs.length - 2].price;
            const lastHigh = swingHighs[swingHighs.length - 1].price;
            if (lastClose > prevHigh) bos = { type: 'BULLISH_BOS', level: prevHigh };
            if (lastHigh < swingHighs[swingHighs.length - 2].price && lastClose > lastHigh) {
                choch = { type: 'BULLISH_CHOCH', level: lastHigh };
            }
        }
        if (swingLows.length >= 2) {
            const prevLow = swingLows[swingLows.length - 2].price;
            const lastLow = swingLows[swingLows.length - 1].price;
            if (lastClose < prevLow) bos = { type: 'BEARISH_BOS', level: prevLow };
            if (lastLow > swingLows[swingLows.length - 2].price && lastClose < lastLow) {
                choch = { type: 'BEARISH_CHOCH', level: lastLow };
            }
        }
        return { bos, choch, swingHighs, swingLows };
    },
    detectIDM(candles, swingHighs, swingLows, side) {
        if (candles.length < 5) return false;
        const highs = candles.map(c => parseFloat(c[2]));
        const lows  = candles.map(c => parseFloat(c[3]));
        const closes = candles.map(c => parseFloat(c[4]));
        const atrLen = Math.min(14, candles.length - 1);
        let atrSum = 0;
        for (let i = candles.length - atrLen; i < candles.length; i++) {
            atrSum += highs[i] - lows[i];
        }
        const atrTolerance = (atrSum / atrLen) * 0.15;
        if (side === 'LONG' && swingLows.length >= 2) {
            const idmPoint  = swingLows[swingLows.length - 2];
            const lastPoint = swingLows[swingLows.length - 1];
            for (let i = idmPoint.idx + 1; i <= lastPoint.idx; i++) {
                if (lows[i] < idmPoint.price) return true;
            }
            if (lastPoint.price < idmPoint.price) return true;
            for (let i = idmPoint.idx + 1; i < candles.length; i++) {
                if (lows[i] < idmPoint.price + atrTolerance) return true;
            }
        }
        if (side === 'SHORT' && swingHighs.length >= 2) {
            const idmPoint  = swingHighs[swingHighs.length - 2];
            const lastPoint = swingHighs[swingHighs.length - 1];
            for (let i = idmPoint.idx + 1; i <= lastPoint.idx; i++) {
                if (highs[i] > idmPoint.price) return true;
            }
            if (lastPoint.price > idmPoint.price) return true;
            for (let i = idmPoint.idx + 1; i < candles.length; i++) {
                if (highs[i] > idmPoint.price - atrTolerance) return true;
            }
        }
        return false;
    },
    detectValidOB(candles, side) {
        if (candles.length < 10) return null;
        const len = candles.length;
        const c = i => ({
            h: parseFloat(candles[i][2]), l: parseFloat(candles[i][3]),
            o: parseFloat(candles[i][1]), cl: parseFloat(candles[i][4])
        });
        for (let i = len - 3; i >= Math.max(1, len - 30); i--) {
            const cur = c(i), prev = c(i - 1), next = c(i + 1);
            if (side === 'LONG') {
                if (cur.cl < cur.o) {
                    const hasFVG = prev.h < next.l;
                    const hasLiqSweep = cur.l < prev.l;
                    if (hasFVG && hasLiqSweep) {
                        return { type: 'BULLISH_OB', top: cur.h, bottom: cur.l, idx: i };
                    }
                }
            }
            if (side === 'SHORT') {
                if (cur.cl > cur.o) {
                    const hasFVG = prev.l > next.h;
                    const hasLiqSweep = cur.h > prev.h;
                    if (hasFVG && hasLiqSweep) {
                        return { type: 'BEARISH_OB', top: cur.h, bottom: cur.l, idx: i };
                    }
                }
            }
        }
        return null;
    },
    detectLTFEntry(candles, side) {
        if (candles.length < 5) return null;
        const len = candles.length;
        const c = i => ({
            h: parseFloat(candles[i][2]), l: parseFloat(candles[i][3]),
            o: parseFloat(candles[i][1]), cl: parseFloat(candles[i][4])
        });
        const last = c(len - 1), prev = c(len - 2), prev2 = c(len - 3);
        if (side === 'LONG') {
            if (last.cl > prev.h && prev.cl < prev2.h) return 'CHoCH';
            if (last.l < prev.l && last.cl > prev.cl) return 'SingleCandle';
        }
        if (side === 'SHORT') {
            if (last.cl < prev.l && prev.cl > prev2.l) return 'CHoCH';
            if (last.h > prev.h && last.cl < prev.cl) return 'SingleCandle';
        }
        return null;
    },
    calcSMCSL(ob, side, atr) {
        if (!ob) return null;
        const buffer = atr * 0.1;
        return side === 'LONG' ? ob.bottom - buffer : ob.top + buffer;
    },
    calcSMCTP(price, sl, side) {
        const risk = Math.abs(price - sl);
        if (side === 'LONG') {
            return { tp1: price + risk * 1.0, tp2: price + risk * 1.618, tp3: price + risk * 2.618 };
        } else {
            return { tp1: price - risk * 1.0, tp2: price - risk * 1.618, tp3: price - risk * 2.618 };
        }
    },
    calculateADX(highs, lows, closes, period = 14) {
        const len = highs.length;
        if (len < period + 1) return Array(len).fill(0);
        const tr = [], plusDM = [], minusDM = [];
        for (let i = 1; i < len; i++) {
            tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
            const up = highs[i] - highs[i-1], dn = lows[i-1] - lows[i];
            plusDM.push(up > dn && up > 0 ? up : 0);
            minusDM.push(dn > up && dn > 0 ? dn : 0);
        }
        const smooth = (arr) => { let s = arr.slice(0, period).reduce((a, b) => a + b, 0); const r = [s]; for (let i = period; i < arr.length; i++) { s = s - s / period + arr[i]; r.push(s); } return r; };
        const sTR = smooth(tr), sPDM = smooth(plusDM), sMDM = smooth(minusDM);
        const dxArr = sTR.map((t, i) => { const pdi = t === 0 ? 0 : sPDM[i] / t * 100; const mdi = t === 0 ? 0 : sMDM[i] / t * 100; return Math.abs(pdi - mdi) / (pdi + mdi || 1) * 100; });
        let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
        const adx = Array(period).fill(adxVal);
        for (let i = period; i < dxArr.length; i++) { adxVal = (adxVal * (period - 1) + dxArr[i]) / period; adx.push(adxVal); }
        return [adx[0], ...adx];
    },
    calcRSIConfirm(closes, side, threshold = 0.7) {
        const rsi6  = this.calculateRSI(closes, 6);
        const rsi12 = this.calculateRSI(closes, 12);
        const rsi24 = this.calculateRSI(closes, 24);
        const r6 = rsi6[rsi6.length - 1], r12 = rsi12[rsi12.length - 1], r24 = rsi24[rsi24.length - 1];
        let pass;
        if (threshold <= 0.5) {
            pass = side === 'LONG' ? r6 > 50 : r6 < 50;
        } else if (threshold <= 0.7) {
            pass = side === 'LONG' ? r6 > 50 && r12 > 50 && r6 > r12 : r6 < 50 && r12 < 50 && r6 < r12;
        } else {
            pass = side === 'LONG' ? r6 > 50 && r12 > 50 && r24 > 50 && r6 > r12 && r12 > r24 : r6 < 50 && r12 < 50 && r24 < 50 && r6 < r12 && r12 < r24;
        }
        return { pass, r6: r6.toFixed(1), r12: r12.toFixed(1), r24: r24.toFixed(1) };
    },
    calculateSMCProbability(analysis) {
        let score = 0;
        const { main } = analysis;
        if (!main) return 50;
        const w = { htfStructure: 30, chochIDM: 30, obFib: 25, ltfEntry: 15 };
        if (main.smcStructure?.bos || main.smcStructure?.choch) score += w.htfStructure;
        if (main.smcStructure?.choch) score += Math.round(w.chochIDM * 0.5);
        if (main.smcIDM) score += Math.round(w.chochIDM * 0.5);
        if (main.smcOB) score += Math.round(w.obFib * 0.6);
        const price = main.price;
        const fibRange = main.side === 'LONG' ? main.fibZoneInv : main.fibZone;
        if (fibRange && price >= Math.min(...fibRange) && price <= Math.max(...fibRange)) score += Math.round(w.obFib * 0.4);
        if (main.smcEntry) score += Math.round(w.ltfEntry * 0.5);
        if (main.divergence || main.pattern) score += Math.round(w.ltfEntry * 0.5);
        return Math.min(100, score);
    }
};

export async function getMultiTfAnalysis(symbol, forceRefresh = false, onProgress = null, targetTfs = ['5m', '15m', '30m', '1h', '4h', '1d']) {
    const tfs = targetTfs;
    const results = {};
    let mainCandles = null;
    const mainTf = targetTfs.includes('15m') ? '15m' : (targetTfs.includes('1h') ? '1h' : '4h');

    for (let i = 0; i < tfs.length; i++) {
        const tf = tfs[i];
        if (onProgress) await onProgress(i, tfs.length, tf);
        const filePath = path.join(DATA_DIR, `${symbol}USDT_${tf}.json`);
        let candles = null;
        if (forceRefresh || !fs.existsSync(filePath)) candles = await fetchBinanceData(symbol, tf);
        else { try { candles = JSON.parse(fs.readFileSync(filePath, 'utf8')); if (Date.now() - fs.statSync(filePath).mtimeMs > 8 * 60 * 1000) candles = await fetchBinanceData(symbol, tf); } catch (e) { candles = await fetchBinanceData(symbol, tf); } }
        if (candles && candles.length >= 50) {
            if (tf === mainTf) mainCandles = candles;
            const closes = candles.map(c => parseFloat(c[4]));
            const highs = candles.map(c => parseFloat(c[2]));
            const lows = candles.map(c => parseFloat(c[3]));
            const curP = closes[closes.length - 1];

            const ema50 = TA.calculateEMA(closes, 50).pop();
            const ema200 = TA.calculateEMA(closes, 200).pop() || ema50;
            const rsi6 = TA.calculateRSI(closes, 6);
            const rsi12 = TA.calculateRSI(closes, 12);
            const rsi24 = TA.calculateRSI(closes, 24);
            const macd = TA.calculateMACD(closes);
            const bb = TA.calculateBB(closes, 20, 2);

            const r6 = rsi6.pop(), r12 = rsi12.pop(), r24 = rsi24.pop();
            const prevR12 = rsi12.pop(), prevR24 = rsi24.pop();

            const rsiScore = calculateRSIScore(r6, r12, r24, prevR12, prevR24);

            const rsiLong = r24 > 50 && r12 > prevR24 && r6 > 50;
            const rsiShort = r24 < 50 && r12 < prevR24 && r6 < 50;
            const goldenCross = prevR12 <= prevR24 && r12 > r24;
            const deathCross = prevR12 >= prevR24 && r12 < r24;

            const lookback = candles.slice(-50);
            const high = Math.max(...lookback.map(c => parseFloat(c[2])));
            const low = Math.min(...lookback.map(c => parseFloat(c[3])));
            const diff = high - low;
            const fib382 = high - diff * 0.382;
            const fib50 = high - diff * 0.5;
            const fib618 = high - diff * 0.618;
            const fib236 = high - diff * 0.236;
            const fib382Inv = low + diff * 0.382;
            const fib50Inv = low + diff * 0.5;
            const fib618Inv = low + diff * 0.618;
            const fib236Inv = low + diff * 0.236;

            const pattern = TA.detectPattern(candles);
            const pattern123 = TA.detect123Pattern(candles);
            const smc = TA.detectSMC(candles);
            const snr = TA.detectSNR(candles);
            const divergence = TA.detectDivergence(candles, rsi6);
            const volSpike = TA.detectVolumeSpike(candles);
            const wicks = TA.calculateWickRatio(candles[candles.length - 1]);
            const atrVal = TA.calculateATR(highs, lows, closes, 14).pop();
            const body = wicks.body;

            const volExceeded = body > atrVal * BOT_CONFIG.strategy.atrVolMultiplier;

            const smcStructure = TA.detectMarketStructure(candles);

            let smcSide = 'NEUTRAL';
            if (smcStructure.bos?.type === 'BULLISH_BOS' || smcStructure.choch?.type === 'BULLISH_CHOCH') smcSide = 'LONG';
            if (smcStructure.bos?.type === 'BEARISH_BOS' || smcStructure.choch?.type === 'BEARISH_CHOCH') smcSide = 'SHORT';

            const smcIDM = smcSide !== 'NEUTRAL'
                ? TA.detectIDM(candles, smcStructure.swingHighs, smcStructure.swingLows, smcSide)
                : false;

            const smcOB = smcSide !== 'NEUTRAL'
                ? TA.detectValidOB(candles, smcSide)
                : null;

            const smcEntry = smcSide !== 'NEUTRAL'
                ? TA.detectLTFEntry(candles, smcSide)
                : null;

            let side = 'NEUTRAL';
            if (!volExceeded) {
                if (smcSide !== 'NEUTRAL' && smcIDM && (smcOB || smcEntry)) {
                    side = smcSide;
                } else if (smcSide !== 'NEUTRAL' && smcStructure.choch && smcIDM) {
                    side = smcSide;
                } else if (smcSide !== 'NEUTRAL' && smcStructure.bos && smcOB) {
                    side = smcSide;
                } else if (smcSide !== 'NEUTRAL' && smcStructure.bos && smcEntry) {
                    side = smcSide;
                }
            }

            const rsiBullishDiv = divergence === '看漲背離 (Bullish Divergence)';
            const rsiBearishDiv = divergence === '看跌背離 (Bearish Divergence)';

            results[tf] = {
                price: curP, ema50, ema200, rsi6: r6, rsi12: r12, rsi24: r24,
                prevR12, prevR24, rsiScore, atr: atrVal, volExceeded, divergence, volSpike,
                candles: candles.slice(-100),
                macd, goldenCross, deathCross, bb, pattern, pattern123, smc, snr,
                smcStructure, smcIDM, smcOB, smcEntry,
                isStrongTrend: r24 > 60 || r24 < 40,
                fibZone: (curP < ema200) ? [fib618, fib236] : [fib618, fib382],
                fibZoneInv: (curP > ema200) ? [fib236Inv, fib618Inv] : [fib382Inv, fib618Inv],
                side, tf
            };
        }
    }
    if (!results[mainTf]) return null;
    const main = results[mainTf];

    const htfTf = '1h';
    let htfSide = 'NEUTRAL';
    if (results[htfTf]) {
        htfSide = results[htfTf].side;
    }
    const ltfSide = main.side;

    let side = 'NEUTRAL';
    let htfConfidence = 'NONE';
    if (ltfSide !== 'NEUTRAL') {
        if (htfSide === ltfSide)           { side = ltfSide; htfConfidence = 'FULL'; }
        else if (htfSide === 'NEUTRAL')    { side = ltfSide; htfConfidence = 'HALF'; }
    }
    logDebug(`[FILTER] ${symbol} 過濾層1 ltf=${ltfSide} htf=${htfSide} → side=${side} conf=${htfConfidence}`);

    const htf4hSide = results['4h']?.side || 'NEUTRAL';
    if (side !== 'NEUTRAL' && htf4hSide !== side) {
        logDebug(`[FILTER] ${symbol} 過濾層1.5 blocked: 4h=${htf4hSide} vs side=${side}`);
        side = 'NEUTRAL';
        htfConfidence = 'NONE';
    }

    if (side !== 'NEUTRAL') {
        const _highs  = main.candles.map(c => parseFloat(c[2]));
        const _lows   = main.candles.map(c => parseFloat(c[3]));
        const _closes = main.candles.map(c => parseFloat(c[4]));
        const adxArr = TA.calculateADX(_highs, _lows, _closes, 14);
        main.adx = adxArr[adxArr.length - 1];
        logDebug(`[FILTER] ${symbol} 過濾層2 ADX=${main.adx?.toFixed(1)} (僅影響槓桿，不擋訊號)`);
        if (main.adx < 18) htfConfidence = 'HALF';
    }

    if (side !== 'NEUTRAL') {
        const _closes = main.candles.map(c => parseFloat(c[4]));
        const r6v  = TA.calculateRSI(_closes, 6).pop();
        const r12v = TA.calculateRSI(_closes, 12).pop();
        const r24v = TA.calculateRSI(_closes, 24).pop();
        const rsiGreen = side === 'LONG'
            ? (r6v > 50 && r12v > 50 && r24v > 50 && r6v > r12v && r12v > r24v)
            : (r6v < 50 && r12v < 50 && r24v < 50 && r6v < r12v && r12v < r24v);
        main.rsiConfirm = { pass: rsiGreen, r6: r6v, r12: r12v, r24: r24v };
        logDebug(`[FILTER] ${symbol} 過濾層3 RSI green=${rsiGreen} (${r6v.toFixed(0)}/${r12v.toFixed(0)}/${r24v.toFixed(0)})`);
        if (!rsiGreen) side = 'NEUTRAL';
    }

    const strategyType = side !== 'NEUTRAL' ? '短期反彈/回調策略 (Short-term)' : '建議觀望';

    if (side !== 'NEUTRAL') {
        const atrVal2 = main.atr || (main.price * 0.01);
        const smcSL = TA.calcSMCSL(main.smcOB, side, atrVal2);
        main.sl = smcSL !== null ? smcSL : (side === 'LONG' ? main.price - atrVal2 * 1.5 : main.price + atrVal2 * 1.5);

        const slDist = Math.abs(main.price - main.sl);
        if (slDist > atrVal2 * BOT_CONFIG.strategy.atrSLMultiplier) {
            side = 'NEUTRAL';
        } else {
            const smcTP = TA.calcSMCTP(main.price, main.sl, side);
            main.tp1 = smcTP.tp1;
            main.tp2 = smcTP.tp2;
            main.tp3 = smcTP.tp3;
        }
    }

    const oiData = await fetchOIContext(symbol);

    const analysis = {
        symbol,
        main,
        strategyType,
        side,
        htfSide,
        htfConfidence,
        allTfs: results
    };
    analysis.probability = TA.calculateSMCProbability(analysis);
    return analysis;
}

export function formatReport(analysis, type = 'ENTRY', extra = {}) {
    const { symbol, main, strategyType, side, allTfs } = analysis;
    const { price, rsi6, rsi12, rsi24, ema50, ema200, divergence, volSpike, volExceeded, atr } = main;
    const emoji = type === 'EXIT' ? '🏁' : (side === 'LONG' ? '💎' : '��');

    if (type === 'EXIT') return `${emoji} **波段策略結束 (${extra.reason})**\n*${symbol}/USDT*\n進場: \`${formatPrice(extra.entryPrice)}\` | 出場: \`${formatPrice(price)}\`\n損益: \`${extra.pnl}% (~${extra.pnlUsdt}U)\``;

    const tfLabel = main.tf || extra.timeframe || (allTfs['15m'] ? '15m' : '1h');
    let report = `💎 **波段大師 (Swing Master) - ${symbol} (${tfLabel})**\n`;
    report += `現價: \`${formatPrice(price)}\` ✨\n\n`;

    report += `📊 **技術指標分析**:\n`;
    
    const prob = analysis.probability || 50;
    const probEmoji = prob > 85 ? '💎' : prob > 70 ? '🚀' : '⚖️';
    report += `• **綜合勝率預測**: ${probEmoji} \`${prob}%\`\n`;

    if (volExceeded) {
        report += `\n⚠️ **警報：波動率速度限制 (ATR Guard)**\n(目前 K 線實體過大，建議觀望避開洗盤)\n\n`;
    }

    if (side !== 'NEUTRAL') {
        const entryPrice = price;
        const risk = Math.abs(entryPrice - main.sl);
        const leverage = extra.leverage || 10;

        const smcBasis = [];
        if (main.smcStructure?.choch) smcBasis.push(`CHoCH (${main.smcStructure.choch.type.includes('BULL') ? '多頭' : '空頭'}性格改變)`);
        else if (main.smcStructure?.bos) smcBasis.push(`BOS (${main.smcStructure.bos.type.includes('BULL') ? '多頭' : '空頭'}結構突破)`);
        if (main.smcIDM) smcBasis.push('IDM 已取出');
        if (main.smcOB) smcBasis.push(`OB 確認 (${main.smcOB.type.includes('BULL') ? '多頭' : '空頭'}訂單塊)`);
        if (main.smcEntry) smcBasis.push(`LTF ${main.smcEntry === 'CHoCH' ? 'CHoCH 進場' : '單根蠟燭回補'}`);

        report += `\n🚀 **波段進場建議**: **${side === 'LONG' ? '做多 LONG' : '做空 SHORT'}**\n`;
        if (smcBasis.length > 0) report += `📌 SMC 依據: ${smcBasis.join(' → ')}\n`;
        report += `• 目標 1: \`${formatPrice(main.tp1)}\` (IDM/流動性)\n`;
        report += `• 目標 2: \`${formatPrice(main.tp2)}\` (HTF POI)\n`;
        report += `• 目標 3: \`${formatPrice(main.tp3)}\` (極端擴展)\n`;
        report += `• 止損位: \`${formatPrice(main.sl)}\` (OB 結構 🚨)\n\n`;
        
        report += `💡 **SMC 策略心法**:\n`;
        report += `1. 達 TP1 後，止損上移至**進場價（保本）**。\n`;
        report += `2. 若 IDM 未被取出，不追單，等待回調確認。\n`;
    } else {
        report += `\n💤 **當前狀態：建議觀望**\n(等待高勝率背離或量能反轉信號)\n`;
    }

    report += `\n━━━━━━━━━━━━━\n`;
    report += `_多時區概況_:\n`;
    for (const tf of ['15m', '1h', '4h', '1d']) {
        const res = allTfs[tf];
        if (!res) continue;
        const tEmoji = res.side === 'LONG' ? '🟢' : res.side === 'SHORT' ? '🔴' : '🟡';
        report += `*${tf}*: ${tEmoji}${res.side === 'NEUTRAL' ? '盤整' : res.side === 'LONG' ? '看多' : '看空'}\n`;
    }

    if (extra.oiData) {
        const { conviction, smartSide, retailSide, topRatio, globalRatio, takerRatio } = extra.oiData;
        const sSide = smartSide === 'LONG' ? '🟢做多' : smartSide === 'SHORT' ? '🔴做空' : '⚪中性';
        const rSide = retailSide === 'LONG' ? '🟢做多' : retailSide === 'SHORT' ? '🔴做空' : '⚪中性';
        const sync = (smartSide === 'LONG' && takerRatio > 1.0) || (smartSide === 'SHORT' && takerRatio < 1.0) ? '➡️同向' : '🔄分歧';
        
        report += `\n📊 **市場情緒 (OI)**: \`${conviction}/100\`\n`;
        report += `大戶: ${sSide} (\`${topRatio.toFixed(2)}\`) | 散戶: ${rSide} (\`${globalRatio.toFixed(2)}\`)\n`;
        report += `買賣比: \`${takerRatio.toFixed(2)}\` | ${sync}\n`;
    }

    return report;
}
