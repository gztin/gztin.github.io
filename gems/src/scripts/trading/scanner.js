/**
 * 掃描模組：BingX 排行榜 → 起漲形態過濾 → 訊號輸出
 *
 * 流程：
 *   1. 抓 BingX 合約 24h ticker（全幣種）
 *   2. 初篩：漲幅 3-25%，量能 1.5x+，排除大盤幣/特殊合約
 *   3. 逐層時框過濾：4h 趨勢 → 1h 動能 → 15m 起漲形態
 *   4. 回傳通過的訊號列表
 */

import { createHmac } from 'crypto';

const BINGX_PUBLIC = 'https://open-api.bingx.com';
const BINANCE_BASE = 'https://data-api.binance.vision';
const BINGX_API_KEY    = process.env.BINGX_API_KEY    || '';
const BINGX_API_SECRET = process.env.BINGX_API_SECRET || '';

// 排除大盤幣（不算「潛力幣」）
const BIG_CAPS = new Set(['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'TRX', 'AVAX', 'LINK']);
// 排除特殊合約前綴（TradFi 商品）
const SPECIAL_PREFIX = ['NC', 'PAXG', 'XAUT'];

function isValidBingxSymbol(symbol) {
    if (!symbol.endsWith('-USDT')) return false;
    const base = symbol.replace('-USDT', '');
    if (BIG_CAPS.has(base)) return false;
    if (SPECIAL_PREFIX.some(p => base.startsWith(p))) return false;
    if (/^\d/.test(base)) return false; // 數字開頭（1000PEPE 等）
    if (['UP', 'DOWN', 'BULL', 'BEAR'].some(s => base.endsWith(s))) return false;
    return true;
}

// ── HTTP 工具 ─────────────────────────────────────────────────────
async function get(url) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Bot' }, signal: controller.signal });
        clearTimeout(tid);
        if (!res.ok) return null;
        return await res.json();
    } catch { clearTimeout(tid); return null; }
}

// 合約資訊快取 (包含槓桿倍數)
let _contractCache = null;
let _contractCacheTs = 0;
const _CONTRACT_TTL = 3600 * 1000; // 1 小時更新一次

/**
 * 抓全幣種合約規格 (包含最大槓桿)
 */
export async function fetchBingxContractInfo() {
    const now = Date.now();
    if (_contractCache && (now - _contractCacheTs < _CONTRACT_TTL)) {
        return _contractCache;
    }

    try {
        const data = await get(`${BINGX_PUBLIC}/openApi/swap/v2/quote/contracts`);
        if (!data || data.code !== 0) return _contractCache || [];
        
        _contractCache = data.data;
        _contractCacheTs = now;
        console.log(`[SCANNER] 合約資訊已更新，共 ${data.data.length} 筆標的`);
        return _contractCache;
    } catch (e) {
        console.error(`[SCANNER] fetchBingxContractInfo error: ${e.message}`);
        return _contractCache || [];
    }
}

/**
 * 獲取特定幣種的最大槓桿
 */
export async function getMaxLeverage(symbol) {
    try {
        const contracts = await fetchBingxContractInfo();
        const bingxSym = symbol.includes('-') ? symbol : `${symbol}-USDT`;
        const info = contracts?.find(c => c.symbol === bingxSym);
        const lev = info ? parseInt(info.maxLeverage) : 20;
        return isNaN(lev) ? 20 : lev;
    } catch { return 20; }
}

// ── 抓 BingX 全幣種 ticker ────────────────────────────────────────
export async function fetchBingxTickers() {

    const data = await get(`${BINGX_PUBLIC}/openApi/swap/v2/quote/ticker`);
    if (!data || data.code !== 0) return [];
    return data.data
        .filter(t => isValidBingxSymbol(t.symbol))
        .map(t => ({
            symbol: t.symbol,                              // BingX 格式：BTC-USDT
            base: t.symbol.replace('-USDT', ''),           // 純幣名：BTC
            change: parseFloat(t.priceChangePercent),
            volume: parseFloat(t.quoteVolume),             // USDT 成交量
            price: parseFloat(t.lastPrice),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
        }));
}

// ── 初篩：漲幅 ≥ 1%，成交量 > 1M USDT，優先依成交量突增率排序 ────────
export function preFilter(tickers, opts = {}) {
    const {
        minChange = 1,
        maxChange = Infinity,
        minVolume = 1_000_000,
        topN = 50,
    } = opts;

    // 計算平均成交量作為基準
    const avgVol = tickers.reduce((a, b) => a + b.volume, 0) / tickers.length;
    
    return tickers
        .filter(t => Math.abs(t.change) >= minChange && Math.abs(t.change) <= maxChange && t.volume >= minVolume)
        .map(t => {
            // 成交量突增率 (相對於全場平均的倍數，作為簡單的活躍度指標)
            const volVelocity = t.volume / avgVol;
            return { ...t, volVelocity };
        })
        .sort((a, b) => b.volVelocity - a.volVelocity) // 優先排成交量最活躍的
        .slice(0, topN);
}

// K 線快取（TTL 15 秒）
const _klineCache = {};
const _KLINE_TTL = 15 * 1000;

// ── 抓 K 線：Bybit（主）→ OKX（備）→ BingX（末） ─────────────────
// 特殊合約（黃金/石油）在其他交易所不存在，只走 BingX
const BINGX_ONLY_SYMBOLS = {
    'OIL':             'NCCO1OILWTI2USD-USDT',
    'WTI':             'NCCO1OILWTI2USD-USDT',
    'OIL100':          'NCCOOILWTI2USD-USDT',
    'WTI100':          'NCCOOILWTI2USD-USDT',
    'BRENT':           'NCCO1OILBRENT2USD-USDT',
    'XAU':             'NCCOGOLD2USD-USDT',
    'GOLD':            'NCCOGOLD2USD-USDT',
    'XAG':             'NCCOXAG2USD-USDT',
    'SILVER':          'NCCOXAG2USD-USDT',
    'NCCO1OILWTI2USD': 'NCCO1OILWTI2USD-USDT',
    'NCCOOILWTI2USD':  'NCCOOILWTI2USD-USDT',
    'NCCOGOLD2USD':    'NCCOGOLD2USD-USDT',
    'NCCOXAG2USD':     'NCCOXAG2USD-USDT',
};

const BYBIT_INTERVAL = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','1d':'D' };
const OKX_INTERVAL   = { '15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1D' };

// BingX 簽名 K 線（需 API Key，可繞過 Docker 403 封鎖）
async function fetchBingxKlinesSigned(base, interval, limit) {
    if (!BINGX_API_KEY || !BINGX_API_SECRET) return null;
    const ts = Date.now();
    const symbol = `${base}-USDT`;
    const params = `symbol=${symbol}&interval=${interval}&limit=${limit}&timestamp=${ts}`;
    const signature = createHmac('sha256', BINGX_API_SECRET).update(params).digest('hex');
    const url = `${BINGX_PUBLIC}/openApi/swap/v3/quote/klines?${params}&signature=${signature}`;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6000);
    try {
        const res = await fetch(url, {
            headers: { 'X-BX-APIKEY': BINGX_API_KEY, 'User-Agent': 'Bot' },
            signal: controller.signal,
        });
        clearTimeout(tid);
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.code !== 0 || !data.data || data.data.length < 20) return null;
        return data.data.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
    } catch { clearTimeout(tid); return null; }
}

async function fetchBybitKlines(base, interval, limit) {
    const bar = BYBIT_INTERVAL[interval] || interval;
    const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${base}USDT&interval=${bar}&limit=${limit}`;
    const data = await get(url);
    if (!data || data.retCode !== 0 || !data.result?.list || data.result.list.length < 20) return null;
    // Bybit 回傳降序 [ts,open,high,low,close,vol,turnover]，reverse 成升序
    return data.result.list.slice().reverse().map(c => [c[0], c[1], c[2], c[3], c[4], c[5]]);
}

async function fetchOkxKlines(base, interval, limit) {
    const bar = OKX_INTERVAL[interval] || interval;
    const url = `https://www.okx.com/api/v5/market/candles?instId=${base}-USDT-SWAP&bar=${bar}&limit=${limit}`;
    const data = await get(url);
    if (!data || data.code !== '0' || !data.data || data.data.length < 20) return null;
    // OKX 回傳降序 [ts,open,high,low,close,vol,...]，reverse 成升序
    return data.data.slice().reverse();
}

export async function fetchKlines(base, interval, limit = 100) {
    const key = `${base}_${interval}`;
    const now = Date.now();
    if (_klineCache[key] && now - _klineCache[key].ts < _KLINE_TTL) {
        return _klineCache[key].data;
    }

    // 特殊合約（黃金/石油）→ BingX 專用
    const bxSymbol = BINGX_ONLY_SYMBOLS[base.toUpperCase()];
    if (bxSymbol) {
        const bxUrl = `${BINGX_PUBLIC}/openApi/swap/v3/quote/klines?symbol=${bxSymbol}&interval=${interval}&limit=${limit}`;
        const bxData = await get(bxUrl);
        if (bxData?.code === 0 && bxData.data?.length >= 20) {
            const result = bxData.data.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
            _klineCache[key] = { data: result, ts: now };
            return result;
        }
        return null;
    }

    // 1. BingX 簽名（原生資料，最準確）
    const bxSigned = await fetchBingxKlinesSigned(base, interval, limit);
    if (bxSigned) { _klineCache[key] = { data: bxSigned, ts: now }; return bxSigned; }

    // 2. Bybit Linear（Docker 內確認 200 OK）
    const bybitData = await fetchBybitKlines(base, interval, limit);
    if (bybitData) { _klineCache[key] = { data: bybitData, ts: now }; return bybitData; }

    // 3. OKX Swap（備援）
    const okxData = await fetchOkxKlines(base, interval, limit);
    if (okxData) { _klineCache[key] = { data: okxData, ts: now }; return okxData; }

    // 4. BingX 公開端點（部分環境可用）
    const bxUrl2 = `${BINGX_PUBLIC}/openApi/swap/v3/quote/klines?symbol=${base}-USDT&interval=${interval}&limit=${limit}`;
    const bxData2 = await get(bxUrl2);
    if (bxData2?.code === 0 && bxData2.data?.length >= 20) {
        const result = bxData2.data.map(c => [c.time, c.open, c.high, c.low, c.close, c.volume]);
        _klineCache[key] = { data: result, ts: now };
        return result;
    }

    return null;
}

import { ema, rsi, rsiTriple, macd, bollingerBands, atr, avgVolume } from '../core/indicators.js';
import { getStrategyParam } from '../core/strategy_params.js';

// ── 起漲形態偵測 ──────────────────────────────────────────────────
// 回傳 { pass, strength, reasons }
// strength: 'HIGH' | 'MED' | 'LOW'
export function detectBreakout(candles) {
    if (!candles || candles.length < 30) return { pass: false };

    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || c[7] || 0));

    const cur = closes[closes.length - 1];
    const curVol = vols[vols.length - 1];
    const avgVol20 = avgVolume(candles, 20);
    const atr14 = atr(candles, 14);
    const rsi14 = rsi(closes, 14);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);

    // 近 20 根高點（壓力位）
    const recentHigh = Math.max(...highs.slice(-20, -1));
    const recentLow  = Math.min(...lows.slice(-20, -1));

    const reasons = [];
    let score = 0;

    // 1. BOS：收盤突破近 20 根高點
    const hasBOS = cur > recentHigh;
    if (hasBOS) { score += 3; reasons.push('BOS突破'); }

    // 2. 量價齊升：當根成交量 > 均量 1.5x，且收陽
    const curOpen = opens[opens.length - 1];
    const isBullCandle = cur > curOpen;
    const hasVolSpike = curVol > avgVol20 * 1.5;
    if (isBullCandle && hasVolSpike) { score += 2; reasons.push(`量價齊升(${(curVol / avgVol20).toFixed(1)}x)`); }

    // 3. RSI 動能：RSI > 55 且向上
    const prevRsi = rsi(closes.slice(0, -1), 14);
    const hasRsiMomentum = rsi14 > 55 && rsi14 > prevRsi;
    if (hasRsiMomentum) { score += 2; reasons.push(`RSI動能(${rsi14.toFixed(0)})`); }

    // 4. 均線多頭排列：價格 > EMA20 > EMA50
    const hasEmaAlign = cur > ema20 && ema20 > ema50;
    if (hasEmaAlign) { score += 1; reasons.push('均線多頭'); }

    // 5. 底部形態：錘子線（下影線 > 實體 2x）
    const body = Math.abs(cur - curOpen);
    const lowerWick = Math.min(cur, curOpen) - lows[lows.length - 1];
    const upperWick = highs[highs.length - 1] - Math.max(cur, curOpen);
    const isHammer = lowerWick > body * 2 && upperWick < body * 0.5 && isBullCandle;
    if (isHammer) { score += 1; reasons.push('錘子線'); }

    // 6. 吞沒形態
    const prevOpen = opens[opens.length - 2];
    const prevClose = closes[closes.length - 2];
    const isBullEngulf = prevClose < prevOpen && cur > curOpen && cur > prevOpen && curOpen < prevClose;
    if (isBullEngulf) { score += 2; reasons.push('看漲吞沒'); }

    // 7. 縮量蓄力後放量（近 3 根縮量，當根放量）
    const prev3Vols = vols.slice(-4, -1);
    const isAccumThenBreak = prev3Vols.every(v => v < avgVol20) && curVol > avgVol20 * 2;
    if (isAccumThenBreak) { score += 2; reasons.push('蓄力爆發'); }

    // 優化3：要求 BOS 或 EMA 至少一個成立（過濾純 VOL+RSI 組合）
    if (!hasBOS && !hasEmaAlign) return { pass: false, score, reasons, reason: '缺乏結構錨點(需BOS或EMA排列)' };

    const stage1Threshold = getStrategyParam('loopA', 'stage1Threshold');
    if (score < stage1Threshold) return { pass: false, score, reasons };

    // 防追高：RSI 已在超買區（> 80）不進多單，鏡像 SHORT 的 RSI < 35 過濾
    if (rsi14 > 80) return { pass: false, score, reasons, reason: `RSI超買不追高(${rsi14.toFixed(0)})` };

    // 強度評級：
    // 3星 (爆發): score >= 8 + VolSpike
    // 2星 (趨勢): score >= 6
    // 1星 (潛力): score >= 4
    let strength = 'LOW';
    let starCount = 1;
    if (score >= 8 && hasVolSpike) {
        strength = 'HIGH';
        starCount = 3;
    } else if (score >= 6) {
        strength = 'MED';
        starCount = 2;
    } else if (score >= 4) {
        strength = 'LOW';
        starCount = 1;
    }

    // SL = 近 20 根最低點下方 0.5 ATR（保守）
    const sl = recentLow - atr14 * 0.5;
    const slPct = ((cur - sl) / cur * 100);
    
    // SL 距離上限過濾
    const slMaxPct = getStrategyParam('loopA', 'slMaxPct') || 4;
    if (slPct > slMaxPct) return { pass: false, score, reasons, reason: `SL距離過大(${slPct.toFixed(1)}%)` };

    const risk = cur - sl;
    return {
        pass: true, strength, starCount, score, reasons,
        price: cur, sl, tp1: cur + risk, tp2: cur + risk * 1.618, tp3: cur + risk * 2.618,
        rsi: rsi14, atr: atr14, volMul: curVol / avgVol20,
        hasBOS, hasVolSpike, hasRsiMomentum,
    };
}

// ── 趨勢進場（C型）：底部抬升 / 頂部下降 ────────────────────────
// 不需要 BOS，靠多時框趨勢確認進場
export function detectTrendEntry(candles15m, candles30m, candles1h, side) {
    if (!candles15m || candles15m.length < 30) return { pass: false };

    // 線性回歸斜率
    const linregSlope = (values) => {
        const n = values.length;
        if (n < 2) return 0;
        const sx = n*(n-1)/2, sy = values.reduce((a,b)=>a+b,0);
        const sxy = values.reduce((s,v,i)=>s+i*v,0);
        const sx2 = n*(n-1)*(2*n-1)/6;
        const d = n*sx2 - sx*sx;
        return d === 0 ? 0 : (n*sxy - sx*sy) / d;
    };

    // 找局部低點
    const detectSwingLows = (lows, lb=2) => {
        const s = [];
        for (let i=lb; i<lows.length-lb; i++) {
            if (lows.slice(i-lb,i).every(l=>l>lows[i]) && lows.slice(i+1,i+lb+1).every(l=>l>lows[i]))
                s.push({ idx:i, val:lows[i] });
        }
        return s;
    };

    const closes15m = candles15m.map(c => parseFloat(c[4]));
    const highs15m  = candles15m.map(c => parseFloat(c[2]));
    const lows15m   = candles15m.map(c => parseFloat(c[3]));
    const opens15m  = candles15m.map(c => parseFloat(c[1]));
    const vols15m   = candles15m.map(c => parseFloat(c[5] || c[7] || 0));
    const cur = closes15m[closes15m.length - 1];
    const curO = opens15m[opens15m.length - 1];
    const curVol = vols15m[vols15m.length - 1];
    const avgVol20 = avgVolume(candles15m, 20);
    const atr14 = atr(candles15m, 14);
    const recentH = Math.max(...highs15m.slice(-20,-1));
    const recentL = Math.min(...lows15m.slice(-20,-1));

    let score = 0;
    const reasons = ['趨勢進場'];

    if (side === 'LONG') {
        // 1h 低點斜率 > 0
        if (candles1h && candles1h.length >= 10) {
            const lows1h = candles1h.slice(-10).map(c => parseFloat(c[3]));
            if (linregSlope(lows1h) > 0) { score += 2; reasons.push('1h底部上升'); }
        }
        // 30m swing low 遞增
        if (candles30m && candles30m.length >= 20) {
            const lows30m = candles30m.slice(-20).map(c => parseFloat(c[3]));
            const swings = detectSwingLows(lows30m, 2);
            if (swings.length >= 2 && swings[swings.length-1].val > swings[swings.length-2].val) {
                score += 2; reasons.push('30m低點遞增');
            }
        }
        // 15m 低點斜率 > 0
        if (lows15m.length >= 5) {
            if (linregSlope(lows15m.slice(-5)) > 0) { score += 1; reasons.push('15m低點上升'); }
        }
        if (score < 4) return { pass: false };
        if (cur < curO) return { pass: false }; // 必須收紅
        if (curVol < avgVol20 * 1.2) return { pass: false };
        const sl = recentL - atr14 * 0.5;
        if ((cur - sl) / cur * 100 > 4) return { pass: false };
        const risk = cur - sl;
        return { pass: true, score, reasons, strength: 'MED',
                 price: cur, sl, tp1: cur+risk, tp2: cur+risk*1.618, tp3: cur+risk*2.618,
                 rsi: rsi(closes15m, 14), atr: atr14, volMul: curVol/avgVol20 };
    } else {
        // 1h 高點斜率 < 0
        if (candles1h && candles1h.length >= 10) {
            const highs1h = candles1h.slice(-10).map(c => parseFloat(c[2]));
            if (linregSlope(highs1h) < 0) { score += 2; reasons.push('1h頂部下降'); }
        }
        // 30m swing high 遞減
        if (candles30m && candles30m.length >= 20) {
            const highs30m = candles30m.slice(-20).map(c => parseFloat(c[2]));
            const swings = detectSwingLows(highs30m.map(h=>-h), 2);
            if (swings.length >= 2 && swings[swings.length-1].val < swings[swings.length-2].val) {
                score += 2; reasons.push('30m高點遞減');
            }
        }
        // 15m 高點斜率 < 0
        if (highs15m.length >= 5) {
            if (linregSlope(highs15m.slice(-5)) < 0) { score += 1; reasons.push('15m高點下降'); }
        }
        if (score < 4) return { pass: false };
        if (cur > curO) return { pass: false }; // 必須收黑
        if (curVol < avgVol20 * 1.2) return { pass: false };
        const sl = recentH + atr14 * 0.5;
        if ((sl - cur) / cur * 100 > 4) return { pass: false };
        const risk = sl - cur;
        return { pass: true, score, reasons, strength: 'MED',
                 price: cur, sl, tp1: cur-risk, tp2: cur-risk*1.618, tp3: cur-risk*2.618,
                 rsi: rsi(closes15m, 14), atr: atr14, volMul: curVol/avgVol20 };
    }
}

// ── 4h 趨勢過濾 ───────────────────────────────────────────────────
function check4hTrend(candles4h, side = 'LONG') {
    if (!candles4h || candles4h.length < 50) return false;
    const closes = candles4h.map(c => parseFloat(c[4]));
    const cur = closes[closes.length - 1];
    const ema50v = ema(closes, 50);
    const rsi14v = rsi(closes, 14);
    if (side === 'LONG') return cur > ema50v && rsi14v > 45;
    // SHORT：價格在 EMA50 下方，RSI < 55（不在超買）
    return cur < ema50v && rsi14v < 55;
}

// ── 1h 動能確認 ───────────────────────────────────────────────────
function check1hMomentum(candles1h, side = 'LONG') {
    if (!candles1h || candles1h.length < 20) return false;
    const closes = candles1h.map(c => parseFloat(c[4]));
    const vols   = candles1h.map(c => parseFloat(c[5] || c[7] || 0));
    const rsi14v = rsi(closes, 14);
    const avgVol20v = avgVolume(candles1h, 20);
    const curVol = vols[vols.length - 1];
    if (side === 'LONG') return rsi14v > 50 && curVol > avgVol20v * 1.2;
    // SHORT：RSI < 50 且量能放大
    return rsi14v < 50 && curVol > avgVol20v * 1.2;
}

// ── 起跌形態偵測（做空）──────────────────────────────────────────
export function detectBreakdown(candles) {
    if (!candles || candles.length < 30) return { pass: false };

    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || c[7] || 0));

    const cur    = closes[closes.length - 1];
    const curVol = vols[vols.length - 1];
    const avgVol20 = avgVolume(candles, 20);
    const atr14  = atr(candles, 14);
    const rsi14  = rsi(closes, 14);
    const ema20v = ema(closes, 20);
    const ema50v = ema(closes, 50);
    const curOpen = opens[opens.length - 1];
    const prevOpen = opens[opens.length - 2];
    const prevClose = closes[closes.length - 2];

    const recentHigh = Math.max(...highs.slice(-20, -1));
    const recentLow  = Math.min(...lows.slice(-20, -1));

    const reasons = [];
    let score = 0;

    // 1. BOS 向下：收盤跌破近 20 根低點
    const hasBOS = cur < recentLow;
    if (hasBOS) { score += 3; reasons.push('BOS向下突破'); }

    // 2. 量價齊跌：當根陰線 + 成交量 > 均量 1.5x
    const isBearCandle = cur < curOpen;
    const hasVolSpike = curVol > avgVol20 * 1.5;
    if (isBearCandle && hasVolSpike) { score += 2; reasons.push(`量價齊跌(${(curVol / avgVol20).toFixed(1)}x)`); }

    // 3. RSI 動能向下：RSI < 45
    const prevRsi = rsi(closes.slice(0, -1), 14);
    const hasRsiMomentum = rsi14 < 45 && rsi14 < prevRsi;
    if (hasRsiMomentum) { score += 2; reasons.push(`RSI下行(${rsi14.toFixed(0)})`); }

    // 4. 均線空頭排列：價格 < EMA20 < EMA50
    const hasEmaAlign = cur < ema20v && ema20v < ema50v;
    if (hasEmaAlign) { score += 1; reasons.push('均線空頭'); }

    // 5. 射擊之星：上影線 > 實體 2x，收陰
    const body = Math.abs(cur - curOpen);
    const upperWick = highs[highs.length - 1] - Math.max(cur, curOpen);
    const lowerWick = Math.min(cur, curOpen) - lows[lows.length - 1];
    const isStar = upperWick > body * 2 && lowerWick < body * 0.5 && isBearCandle;
    if (isStar) { score += 1; reasons.push('射擊之星'); }

    // 6. 看跌吞沒
    const isBearEngulf = prevClose > prevOpen && isBearCandle && curOpen >= prevClose && cur <= prevOpen;
    if (isBearEngulf) { score += 2; reasons.push('看跌吞沒'); }

    // 7. 縮量蓄力後放量下跌
    const prev3Vols = vols.slice(-4, -1);
    const isAccumThenBreak = prev3Vols.every(v => v < avgVol20) && curVol > avgVol20 * 2 && isBearCandle;
    if (isAccumThenBreak) { score += 2; reasons.push('蓄力爆跌'); }

    // 優化3：要求 BOS 或 EMA 至少一個成立（過濾純 VOL+RSI 組合）
    if (!hasBOS && !hasEmaAlign) return { pass: false, score, reasons, reason: '缺乏結構錨點(需BOS或EMA排列)' };

    const stage1Threshold = getStrategyParam('loopA', 'stage1Threshold');
    if (score < stage1Threshold) return { pass: false, score, reasons };

    // 防追跌：RSI 已在超賣區（< 35）不進空單，避免追跌吃反彈
    if (rsi14 < 35) return { pass: false, score, reasons, reason: `RSI超賣不追跌(${rsi14.toFixed(0)})` };

    const strength = score >= 7 ? 'HIGH' : score >= 5 ? 'MED' : 'LOW';

    // SL = 近 20 根最高點上方 0.5 ATR
    const sl = recentHigh + atr14 * 0.5;
    const slPct = ((sl - cur) / cur * 100);
    // 優化2：SL 距離上限從 8% 降到 4%
    const slMaxPct = getStrategyParam('loopA', 'slMaxPct');
    if (slPct > slMaxPct) return { pass: false, score, reasons, reason: `SL距離過大(${slPct.toFixed(1)}%)` };

    // TP：1R / 1.618R / 2.618R（斐波那契擴展）
    const risk = sl - cur;
    const tp1 = cur - risk * 1.0;
    const tp2 = cur - risk * 1.618;
    const tp3 = cur - risk * 2.618;

    return {
        pass: true, strength, score, reasons,
        price: cur, sl, tp1, tp2, tp3,
        rsi: rsi14, atr: atr14, volMul: curVol / avgVol20,
        hasBOS, hasVolSpike, hasRsiMomentum,
    };
}

// ── 第二階段篩選：指標共振確認 ───────────────────────────────────
// 回傳 { pass, score, reasons, indicators }
export async function secondStageFilter(base, side) {
    const [candles1h, candles15m, oiData] = await Promise.all([
        fetchKlines(base, '1h', 60),
        fetchKlines(base, '15m', 100),
        // 持倉量（供顯示用，不影響評分）
        fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/openInterest?symbol=${base}-USDT`)
            .then(r => r.json()).then(d => d.code === 0 ? d.data : null).catch(() => null),
    ]);

    if (!candles1h || !candles15m) return { pass: false, reasons: ['K線資料不足'] };

    const closes1h  = candles1h.map(c => parseFloat(c[4]));
    const closes15m = candles15m.map(c => parseFloat(c[4]));

    // RSI 三線共振（1h）
    const rsiT = rsiTriple(closes1h);
    // MACD（15m）
    const macdV = macd(closes15m);
    // 布林帶（15m）
    const bb = bollingerBands(closes15m);

    const reasons = [];
    let score = 0;

    if (side === 'LONG') {
        if (rsiT.r24 > 50)        { score += 2; reasons.push(`RSI24多頭(${rsiT.r24.toFixed(0)})`); }
        if (rsiT.goldenCross)      { score += 3; reasons.push('RSI12金叉RSI24'); }
        if (rsiT.bullAlign)        { score += 2; reasons.push('RSI三線多頭排列'); }
        if (macdV.hist > 0)        { score += 2; reasons.push('MACD柱正'); }
        if (macdV.crossUp)         { score += 3; reasons.push('MACD金叉'); }
        if (bb.pct > 0.5)          { score += 1; reasons.push('BB中軌以上'); }
        if (bb.pct < 0.2 && bb.width < 0.05) { score += 2; reasons.push('BB壓縮下軌反彈'); }
    } else {
        if (rsiT.r24 < 50)         { score += 2; reasons.push(`RSI24空頭(${rsiT.r24.toFixed(0)})`); }
        if (rsiT.deathCross)       { score += 3; reasons.push('RSI12死叉RSI24'); }
        if (rsiT.bearAlign)        { score += 2; reasons.push('RSI三線空頭排列'); }
        if (macdV.hist < 0)        { score += 2; reasons.push('MACD柱負'); }
        if (macdV.crossDown)       { score += 3; reasons.push('MACD死叉'); }
        if (bb.pct < 0.5)          { score += 1; reasons.push('BB中軌以下'); }
        if (bb.pct > 0.8 && bb.width < 0.05) { score += 2; reasons.push('BB壓縮上軌反轉'); }
    }

    const indicators = {
        rsi6: rsiT.r6, rsi12: rsiT.r12, rsi24: rsiT.r24,
        macdHist: macdV.hist, macdCross: macdV.crossUp || macdV.crossDown,
        bbPct: bb.pct, bbWidth: bb.width,
        oi: oiData ? parseFloat(oiData.openInterest) : null,
    };

    // 門檻：≥ 5 分才通過第二階段
    return { pass: score >= 5, score, reasons, indicators };
}

// ── 主掃描函數（兩階段）─────────────────────────────────────────
export async function runScan(opts = {}) {
    const { maxCandidates = 50, onProgress = null, excludeBases = [] } = opts;

    // Step 1: 抓排行榜
    const tickers = await fetchBingxTickers();
    if (!tickers.length) return { error: '無法取得 BingX 資料' };

    // Step 2: 初篩（拿掉 4h 層，只保留漲跌幅 + 成交量）
    const excludeBase = opts.excludeBases || [];
    const longCandidates = preFilter(tickers, { minChange: 1 })
        .filter(t => !excludeBase.includes(t.base));
    const shortCandidates = preFilter(tickers, { minChange: -999, maxChange: -1 })
        .filter(t => !excludeBase.includes(t.base));

    // 強制加入黃金/石油（BTC/ETH 由 Loop F/G 獨立處理）
    const FORCE_SYMBOLS = [
        { base: 'NCCOGOLD2USD',    bxSymbol: 'NCCOGOLD2USD-USDT' },
        { base: 'NCCO1OILWTI2USD', bxSymbol: 'NCCO1OILWTI2USD-USDT' },
    ];
    const allTickers = await get(`${BINGX_PUBLIC}/openApi/swap/v2/quote/ticker`);
    const forceCandidates = FORCE_SYMBOLS.flatMap(({ base, bxSymbol }) => {
        const t = allTickers?.data?.find(t => t.symbol === bxSymbol);
        if (!t) return [];
        const change = parseFloat(t.priceChangePercent);
        const volume = parseFloat(t.quoteVolume);
        const price  = parseFloat(t.lastPrice);
        return [
            { symbol: bxSymbol, base, change, volume, price, scanSide: 'LONG' },
            { symbol: bxSymbol, base, change, volume, price, scanSide: 'SHORT' },
        ];
    });

    const checked = [
        ...longCandidates.slice(0, maxCandidates).map(t => ({ ...t, scanSide: 'LONG' })),
        ...shortCandidates.slice(0, maxCandidates).map(t => ({ ...t, scanSide: 'SHORT' })),
        ...forceCandidates,
    ];

    const signals = [];

    for (let i = 0; i < checked.length; i++) {
        const t = checked[i];
        const side = t.scanSide;
        if (onProgress) onProgress(i + 1, checked.length, t.base);

        // ── 第一階段：1h 動能 + 15m 形態 ──────────────────────────
        const candles1h = await fetchKlines(t.base, '1h', 60);
        if (!candles1h || !check1hMomentum(candles1h, side)) continue;

        const candles15m = await fetchKlines(t.base, '15m', 100);
        let stage1 = null;
        if (side === 'LONG') {
            stage1 = detectBreakout(candles15m);
        } else {
            stage1 = detectBreakdown(candles15m);
        }
        if (!stage1?.pass) continue;

        // ── 追加：OI 持倉量監控 (資金流確認) ────────────────────────
        try {
            const oiRes = await get(`${BINGX_PUBLIC}/openApi/swap/v2/quote/openInterest?symbol=${t.symbol}`);
            if (oiRes?.code === 0) {
                stage1.oi = parseFloat(oiRes.data.openInterest);
            }
        } catch (_) {}

        // ── 圖形結構加分（1h K 線）────────────────────────────────
        const chartPattern = detectChartPattern(candles1h, side);
        const totalScore = stage1.score + chartPattern.score;
        
        // 重新判定強度等級與星級
        const strength = totalScore >= 10 ? 'HIGH' : totalScore >= 7 ? 'MED' : 'LOW';
        const starCount = totalScore >= 10 ? 3 : totalScore >= 7 ? 2 : 1;
        stage1.starCount = starCount;

        // ── 第二階段：RSI三線 + MACD + BB + 資金費率同步篩選 ──────
        const stage2 = await secondStageFilter(t.base, side);
        if (!stage2.pass) continue;

        signals.push({
            ...t, ...stage1,
            score: totalScore,
            strength,
            chartPattern: chartPattern.reasons,
            side,
            stage2Score: stage2.score,
            stage2Reasons: stage2.reasons,
            indicators: stage2.indicators,
            scannedAt: Date.now(),
        });
    }

    return { signals, tickers, candidates: checked };
}

// ── 圖形結構偵測（1h K 線，加分項）──────────────────────────────
// 回傳 { score, reasons }，最高 +5 分（取最高分，不累加）
function detectChartPattern(candles1h, side) {
    if (!candles1h || candles1h.length < 50) return { score: 0, reasons: [] };

    const closes = candles1h.map(c => parseFloat(c[4]));
    const highs  = candles1h.map(c => parseFloat(c[2]));
    const lows   = candles1h.map(c => parseFloat(c[3]));
    const len    = candles1h.length;
    const cur    = closes[len - 1];
    const atr14v = atr(candles1h, 14);

    const candidates = []; // { score, reason }

    // ── 1. 水平支撐/壓力線 ────────────────────────────────────────
    // 掃描近 100 根高/低點，相近價位（±0.3% ATR）觸碰 ≥ 2 次
    const tolerance = atr14v * 0.3;
    const checkPoints = side === 'SHORT' ? highs.slice(-100) : lows.slice(-100);
    const levelMap = {};
    for (const p of checkPoints) {
        const key = Math.round(p / tolerance);
        levelMap[key] = (levelMap[key] || 0) + 1;
    }
    const validLevels = Object.entries(levelMap)
        .filter(([, count]) => count >= 2)
        .map(([key]) => parseFloat(key) * tolerance);

    for (const level of validLevels) {
        const dist = Math.abs(cur - level);
        if (dist < atr14v * 0.5) {
            const label = side === 'SHORT' ? '水平壓力觸碰' : '水平支撐觸碰';
            candidates.push({ score: 2, reason: `${label}(${level.toFixed(0)})` });
            break;
        }
    }

    // ── 2. 趨勢線觸碰 ─────────────────────────────────────────────
    // 取近 50 根最近兩個局部高點（空單）或低點（多單）連線
    function findLocalExtremes(arr, isHigh, lookback = 50, minDist = 5) {
        const pts = [];
        const slice = arr.slice(-lookback);
        for (let i = 2; i < slice.length - 2; i++) {
            if (isHigh) {
                if (slice[i] > slice[i-1] && slice[i] > slice[i-2] &&
                    slice[i] > slice[i+1] && slice[i] > slice[i+2]) {
                    pts.push({ idx: i, val: slice[i] });
                }
            } else {
                if (slice[i] < slice[i-1] && slice[i] < slice[i-2] &&
                    slice[i] < slice[i+1] && slice[i] < slice[i+2]) {
                    pts.push({ idx: i, val: slice[i] });
                }
            }
        }
        // 取最近兩個，且間距 >= minDist
        const result = [];
        for (let i = pts.length - 1; i >= 0 && result.length < 2; i--) {
            if (!result.length || pts[i].idx < result[0].idx - minDist) {
                result.unshift(pts[i]);
            }
        }
        return result;
    }

    if (side === 'SHORT') {
        const peaks = findLocalExtremes(highs, true);
        if (peaks.length === 2) {
            const slope = (peaks[1].val - peaks[0].val) / (peaks[1].idx - peaks[0].idx);
            const trendlineNow = peaks[1].val + slope * (len - 1 - (len - 50 + peaks[1].idx));
            if (Math.abs(cur - trendlineNow) < atr14v && slope < 0) {
                candidates.push({ score: 2, reason: '下降趨勢線觸碰' });
            }
        }
    } else {
        const troughs = findLocalExtremes(lows, false);
        if (troughs.length === 2) {
            const slope = (troughs[1].val - troughs[0].val) / (troughs[1].idx - troughs[0].idx);
            const trendlineNow = troughs[1].val + slope * (len - 1 - (len - 50 + troughs[1].idx));
            if (Math.abs(cur - trendlineNow) < atr14v && slope > 0) {
                candidates.push({ score: 2, reason: '上升趨勢線觸碰' });
            }
        }
    }

    // ── 3. 雙頂 / 雙底 ────────────────────────────────────────────
    // 近 50 根內兩個相近高/低點（價差 < 1%），中間有明顯回撤（> 3%）
    if (side === 'SHORT') {
        const peaks = findLocalExtremes(highs, true, 50, 8);
        if (peaks.length === 2) {
            const priceDiff = Math.abs(peaks[0].val - peaks[1].val) / peaks[0].val;
            const midLow = Math.min(...lows.slice(-(50 - peaks[0].idx), -(50 - peaks[1].idx) || undefined));
            const pullback = (peaks[0].val - midLow) / peaks[0].val;
            if (priceDiff < 0.01 && pullback > 0.03) {
                candidates.push({ score: 3, reason: `雙頂(${peaks[0].val.toFixed(0)})` });
            }
        }
    } else {
        const troughs = findLocalExtremes(lows, false, 50, 8);
        if (troughs.length === 2) {
            const priceDiff = Math.abs(troughs[0].val - troughs[1].val) / troughs[0].val;
            const midHigh = Math.max(...highs.slice(-(50 - troughs[0].idx), -(50 - troughs[1].idx) || undefined));
            const pullback = (midHigh - troughs[0].val) / troughs[0].val;
            if (priceDiff < 0.01 && pullback > 0.03) {
                candidates.push({ score: 3, reason: `雙底(${troughs[0].val.toFixed(0)})` });
            }
        }
    }

    // ── 4. 頭肩頂 / 頭肩底 ───────────────────────────────────────
    // 三個局部高/低點，中間比兩側高/低 ≥ 1.5%
    if (side === 'SHORT') {
        const peaks = findLocalExtremes(highs, true, 80, 6);
        if (peaks.length >= 3) {
            const [p1, p2, p3] = peaks.slice(-3);
            const headHigher = p2.val > p1.val * 1.015 && p2.val > p3.val * 1.015;
            const shouldersSymmetric = Math.abs(p1.val - p3.val) / p1.val < 0.02;
            if (headHigher && shouldersSymmetric) {
                candidates.push({ score: 3, reason: '頭肩頂' });
            }
        }
    } else {
        const troughs = findLocalExtremes(lows, false, 80, 6);
        if (troughs.length >= 3) {
            const [t1, t2, t3] = troughs.slice(-3);
            const headLower = t2.val < t1.val * 0.985 && t2.val < t3.val * 0.985;
            const shouldersSymmetric = Math.abs(t1.val - t3.val) / t1.val < 0.02;
            if (headLower && shouldersSymmetric) {
                candidates.push({ score: 3, reason: '頭肩底' });
            }
        }
    }

    // ── 5. 三角形整理突破 ─────────────────────────────────────────
    // 上下趨勢線收斂後突破
    {
        const upperPeaks   = findLocalExtremes(highs, true, 50, 5);
        const lowerTroughs = findLocalExtremes(lows, false, 50, 5);
        if (upperPeaks.length >= 2 && lowerTroughs.length >= 2) {
            const upperSlope = (upperPeaks[1].val - upperPeaks[0].val) / (upperPeaks[1].idx - upperPeaks[0].idx);
            const lowerSlope = (lowerTroughs[1].val - lowerTroughs[0].val) / (lowerTroughs[1].idx - lowerTroughs[0].idx);
            const isConverging = upperSlope < 0 && lowerSlope > 0;
            if (isConverging) {
                if (side === 'SHORT' && cur < lowerTroughs[1].val) {
                    candidates.push({ score: 2, reason: '三角形向下突破' });
                } else if (side === 'LONG' && cur > upperPeaks[1].val) {
                    candidates.push({ score: 2, reason: '三角形向上突破' });
                }
            }
        }
    }

    // ── 6. 旗形突破 ───────────────────────────────────────────────
    // 主升/跌段後出現平行小幅回調通道，通道斜率與主趨勢反向
    {
        const recentCloses = closes.slice(-20);
        const firstHalf  = recentCloses.slice(0, 10);
        const secondHalf = recentCloses.slice(10);
        const mainMove   = (firstHalf[firstHalf.length-1] - firstHalf[0]) / firstHalf[0];
        const flagMove   = (secondHalf[secondHalf.length-1] - secondHalf[0]) / secondHalf[0];
        const isFlagPattern = Math.abs(mainMove) > 0.03 && Math.sign(mainMove) !== Math.sign(flagMove) && Math.abs(flagMove) < Math.abs(mainMove) * 0.5;
        if (isFlagPattern) {
            if (side === 'SHORT' && mainMove < 0 && cur < secondHalf[0]) {
                candidates.push({ score: 2, reason: '旗形向下突破' });
            } else if (side === 'LONG' && mainMove > 0 && cur > secondHalf[0]) {
                candidates.push({ score: 2, reason: '旗形向上突破' });
            }
        }
    }

    // 取最高分（不累加），上限 5 分
    if (!candidates.length) return { score: 0, reasons: [] };
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    return { score: Math.min(best.score, 5), reasons: [best.reason], allPatterns: candidates };
}

// ── 反轉形態偵測 ──────────────────────────────────────────────────
// 回傳 { reversed: bool, reason: string, confidence: 'HIGH'|'MED'|'LOW' }
// HIGH = 多個訊號同時出現，直接平倉
// MED  = 單一強訊號，建議止盈
// LOW  = 警告，繼續觀察
function detectReversal(candles, side) {
    if (!candles || candles.length < 20) return { reversed: false };

    const len = candles.length;
    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || c[7] || 0));

    const cur     = closes[len - 1];
    const curO    = opens[len - 1];
    const curH    = highs[len - 1];
    const curL    = lows[len - 1];
    const prev    = closes[len - 2];
    const prevO   = opens[len - 2];
    const prevH   = highs[len - 2];
    const prev2   = closes[len - 3];
    const prev2O  = opens[len - 3];

    const curVol  = vols[len - 1];
    const avgVol  = avgVolume(candles, 20);
    const atr14v  = atr(candles, 14);
    const ema20v  = ema(closes, 20);
    const ema50v  = ema(closes, 50);

    // RSI 系列（用於背離判斷）
    const rsiNow  = rsi(closes, 14);
    const rsiPrev = rsi(closes.slice(0, -3), 14);

    const signals = [];

    if (side === 'LONG') {
        // ── 多頭持倉的反轉訊號 ──────────────────────────────────

        // 1. 頂部吞沒（Bearish Engulfing）：前根陽線被當根陰線完全吃掉
        const isBearEngulf = prev > prevO &&          // 前根陽線
            cur < curO &&                              // 當根陰線
            curO >= prev &&                            // 開盤 >= 前收
            cur <= prevO;                              // 收盤 <= 前開
        if (isBearEngulf) signals.push({ s: '頂部吞沒', w: 3 });

        // 2. 射擊之星（Shooting Star）：上影線 > 實體 2x，小實體，收陰
        const body = Math.abs(cur - curO);
        const upperWick = curH - Math.max(cur, curO);
        const lowerWick = Math.min(cur, curO) - curL;
        const isStar = upperWick > body * 2 && lowerWick < body * 0.5 && cur < curO;
        if (isStar) signals.push({ s: '射擊之星', w: 2 });

        // 3. 黃昏之星（Evening Star）：陽線 → 十字星 → 陰線
        const midBody = Math.abs(prev - prevO);
        const isEveningStar = prev > prevO &&          // 前根陽
            midBody < atr14v * 0.3 &&                  // 中間小實體（十字星）
            cur < curO &&                              // 當根陰
            cur < (prev + prevO) / 2;                  // 收盤跌入前根實體中段
        if (isEveningStar) signals.push({ s: '黃昏之星', w: 3 });

        // 4. RSI 頂背離：價格創近期新高，但 RSI 沒跟上
        const recentHigh = Math.max(...highs.slice(-10, -1));
        const rsiDivBear = cur >= recentHigh && rsiNow < rsiPrev - 5 && rsiNow > 70;
        if (rsiDivBear) signals.push({ s: `RSI頂背離(${rsiNow.toFixed(0)})`, w: 2 });

        // 5. 跌破 EMA20 + 量能放大（結構破壞）
        const breakEma = cur < ema20v && prev >= ema20v && curVol > avgVol * 1.3;
        if (breakEma) signals.push({ s: 'EMA20破位放量', w: 3 });

        // 6. 高點縮量衰竭：連續 2 根量縮，且價格在高位（RSI > 65）
        const volFade = vols[len - 2] < avgVol * 0.7 && vols[len - 3] < avgVol * 0.7 && rsiNow > 75;
        if (volFade) signals.push({ s: '高位縮量衰竭', w: 1 });

        // 7. 連續 2 根陰線 + 量能放大（賣壓湧現）
        const twoRedBars = cur < curO && prev < prevO && prev2 < prev2O && curVol > avgVol * 1.5;
        if (twoRedBars) signals.push({ s: '連陰放量', w: 2 });

    } else {
        // ── 空頭持倉的反轉訊號 ──────────────────────────────────

        // 1. 底部吞沒（Bullish Engulfing）
        const isBullEngulf = prev < prevO && cur > curO && curO <= prev && cur >= prevO;
        if (isBullEngulf) signals.push({ s: '底部吞沒', w: 3 });

        // 2. 錘子線：下影線 > 實體 2x，收陽
        const body2 = Math.abs(cur - curO);
        const lowerWick2 = Math.min(cur, curO) - curL;
        const upperWick2 = curH - Math.max(cur, curO);
        const isHammer = lowerWick2 > body2 * 2 && upperWick2 < body2 * 0.5 && cur > curO;
        if (isHammer) signals.push({ s: '錘子線', w: 2 });

        // 3. 晨星（Morning Star）
        const midBody2 = Math.abs(prev - prevO);
        const isMorningStar = prev < prevO && midBody2 < atr14v * 0.3 && cur > curO && cur > (prev + prevO) / 2;
        if (isMorningStar) signals.push({ s: '晨星', w: 3 });

        // 4. RSI 底背離
        const recentLow = Math.min(...lows.slice(-10, -1));
        const rsiDivBull = cur <= recentLow && rsiNow > rsiPrev + 5 && rsiNow < 30;
        if (rsiDivBull) signals.push({ s: `RSI底背離(${rsiNow.toFixed(0)})`, w: 2 });

        // 5. 突破 EMA20 + 量能放大
        const breakEma2 = cur > ema20v && prev <= ema20v && curVol > avgVol * 1.3;
        if (breakEma2) signals.push({ s: 'EMA20突破放量', w: 3 });

        // 6. 低位縮量衰竭
        const volFade2 = vols[len - 2] < avgVol * 0.7 && vols[len - 3] < avgVol * 0.7 && rsiNow < 25;
        if (volFade2) signals.push({ s: '低位縮量衰竭', w: 1 });

        // 7. 連續 2 根陽線 + 量能放大
        const twoGreenBars = cur > curO && prev > prevO && prev2 > prev2O && curVol > avgVol * 1.5;
        if (twoGreenBars) signals.push({ s: '連陽放量', w: 2 });
    }

    if (!signals.length) return { reversed: false, rsi: rsiNow, ema20: ema20v };

    const totalWeight = signals.reduce((a, s) => a + s.w, 0);
    const confidence = totalWeight >= 6 ? 'HIGH' : totalWeight >= 3 ? 'MED' : 'LOW';
    const reason = signals.map(s => s.s).join(' + ');

    return {
        reversed: true,
        confidence,
        reason,
        signals,
        totalWeight,
        rsi: rsiNow,
        ema20: ema20v,
    };
}

// ── 持倉監控（每分鐘呼叫）────────────────────────────────────────
// 回傳 { shouldExit, exitReason, alert, alerts, price, rsi, pnlPct }
export async function monitorPosition(base, side, entryPrice) {
    const candles = await fetchKlines(base, '15m', 60);
    if (!candles) return null;

    const closes = candles.map(c => parseFloat(c[4]));
    const cur    = closes[closes.length - 1];
    const rsi14v = rsi(closes, 14);
    const ema20v = ema(closes, 20);
    const atr14v = atr(candles, 14);

    const pnlPct = side === 'LONG'
        ? ((cur - entryPrice) / entryPrice * 100).toFixed(2)
        : ((entryPrice - cur) / entryPrice * 100).toFixed(2);

    // 反轉形態偵測
    const reversal = detectReversal(candles, side);
    const alerts = [];
    // 反轉警報已移除，不再推送 reversal 訊息到 alerts

    // 基礎指標警告
    if (side === 'LONG') {
        if (rsi14v < 40) alerts.push(`RSI轉弱(${rsi14v.toFixed(0)})`);
    } else {
        if (rsi14v > 60) alerts.push(`RSI轉強(${rsi14v.toFixed(0)})`);
    }

    return {
        shouldExit: false,
        exitReason: null,
        alert: alerts.length > 0,
        alerts,
        price: cur, rsi: rsi14v, ema20: ema20v, atr: atr14v, pnlPct,
        reversal,
    };
}

// ── 抄底/抄頂：取漲跌幅極端幣種 ─────────────────────────────────
// 回傳漲幅最高（抄頂做空）和跌幅最深（抄底做多）各一個
export async function fetchExtremeTickers() {
    const data = await get(`${BINGX_PUBLIC}/openApi/swap/v2/quote/ticker`);
    if (!data || data.code !== 0) return { top: null, bottom: null };

    const valid = data.data
        .filter(t => isValidBingxSymbol(t.symbol))
        .map(t => ({
            symbol: t.symbol,
            base: t.symbol.replace('-USDT', ''),
            change: parseFloat(t.priceChangePercent),
            volume: parseFloat(t.quoteVolume),
            price: parseFloat(t.lastPrice),
        }))
        .filter(t => t.volume >= 1_000_000); // 最低流動性門檻

    if (!valid.length) return { top: null, bottom: null };

    // 漲幅第一（抄頂做空候選）
    const top = valid.reduce((a, b) => b.change > a.change ? b : a);
    // 跌幅第一（抄底做多候選）
    const bottom = valid.reduce((a, b) => b.change < a.change ? b : a);

    return { top, bottom };
}

// ── 抄底形態確認（跌幅第一 → 做多）─────────────────────────────
// 條件：RSI 超賣 + 出現反轉K線形態
export async function detectBottomReversal(base) {
    const candles = await fetchKlines(base, '15m', 60);
    if (!candles || candles.length < 20) return { pass: false };

    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || c[7] || 0));
    const len = candles.length;

    const cur = closes[len - 1];
    const curO = opens[len - 1];
    const curH = highs[len - 1];
    const curL = lows[len - 1];
    const prev = closes[len - 2];
    const prevO = opens[len - 2];

    const rsi14 = rsi(closes, 14);
    const atr14 = atr(candles, 14);
    const avgVol20 = avgVolume(candles, 20);
    const curVol = vols[len - 1];
    const recentLow = Math.min(...lows.slice(-20, -1));
    const recentHigh = Math.max(...highs.slice(-20, -1));

    const reasons = [];
    let score = 0;

    // RSI 超賣（< 30）
    if (rsi14 < 30) { score += 3; reasons.push(`RSI超賣(${rsi14.toFixed(0)})`); }
    else if (rsi14 < 40) { score += 1; reasons.push(`RSI偏低(${rsi14.toFixed(0)})`); }

    // 錘子線：下影線 > 實體 2x，收陽
    const body = Math.abs(cur - curO);
    const lowerWick = Math.min(cur, curO) - curL;
    const upperWick = curH - Math.max(cur, curO);
    if (lowerWick > body * 2 && upperWick < body * 0.5 && cur > curO) {
        score += 2; reasons.push('錘子線');
    }

    // 底部吞沒
    if (prev < prevO && cur > curO && curO <= prev && cur >= prevO) {
        score += 3; reasons.push('底部吞沒');
    }

    // 放量反彈
    if (cur > curO && curVol > avgVol20 * 1.5) {
        score += 2; reasons.push(`放量反彈(${(curVol / avgVol20).toFixed(1)}x)`);
    }

    if (score < 4) return { pass: false, score, reasons };

    const sl = recentLow - atr14 * 0.5;
    const slPct = ((cur - sl) / cur * 100);
    if (slPct > 8) return { pass: false, score, reasons, reason: `SL距離過大(${slPct.toFixed(1)}%)` };

    const risk = cur - sl;
    return {
        pass: true, score, reasons,
        strength: score >= 7 ? 'HIGH' : score >= 5 ? 'MED' : 'LOW',
        price: cur, sl,
        tp1: cur + risk * 1.0,
        tp2: cur + risk * 1.618,
        tp3: cur + risk * 2.618,
        rsi: rsi14, atr: atr14,
    };
}

// ── 抄頂形態確認（漲幅第一 → 做空）─────────────────────────────
export async function detectTopReversal(base) {
    const candles = await fetchKlines(base, '15m', 60);
    if (!candles || candles.length < 20) return { pass: false };

    const closes = candles.map(c => parseFloat(c[4]));
    const highs  = candles.map(c => parseFloat(c[2]));
    const lows   = candles.map(c => parseFloat(c[3]));
    const opens  = candles.map(c => parseFloat(c[1]));
    const vols   = candles.map(c => parseFloat(c[5] || c[7] || 0));
    const len = candles.length;

    const cur = closes[len - 1];
    const curO = opens[len - 1];
    const curH = highs[len - 1];
    const curL = lows[len - 1];
    const prev = closes[len - 2];
    const prevO = opens[len - 2];

    const rsi14 = rsi(closes, 14);
    const atr14 = atr(candles, 14);
    const avgVol20 = avgVolume(candles, 20);
    const curVol = vols[len - 1];
    const recentHigh = Math.max(...highs.slice(-20, -1));

    const reasons = [];
    let score = 0;

    // RSI 超買（> 70）
    if (rsi14 > 70) { score += 3; reasons.push(`RSI超買(${rsi14.toFixed(0)})`); }
    else if (rsi14 > 60) { score += 1; reasons.push(`RSI偏高(${rsi14.toFixed(0)})`); }

    // 射擊之星：上影線 > 實體 2x，收陰
    const body = Math.abs(cur - curO);
    const upperWick = curH - Math.max(cur, curO);
    const lowerWick = Math.min(cur, curO) - curL;
    if (upperWick > body * 2 && lowerWick < body * 0.5 && cur < curO) {
        score += 2; reasons.push('射擊之星');
    }

    // 頂部吞沒
    if (prev > prevO && cur < curO && curO >= prev && cur <= prevO) {
        score += 3; reasons.push('頂部吞沒');
    }

    // 放量下跌
    if (cur < curO && curVol > avgVol20 * 1.5) {
        score += 2; reasons.push(`放量下跌(${(curVol / avgVol20).toFixed(1)}x)`);
    }

    if (score < 4) return { pass: false, score, reasons };

    const sl = recentHigh + atr14 * 0.5;
    const slPct = ((sl - cur) / cur * 100);
    if (slPct > 8) return { pass: false, score, reasons, reason: `SL距離過大(${slPct.toFixed(1)}%)` };

    const risk = sl - cur;
    return {
        pass: true, score, reasons,
        strength: score >= 7 ? 'HIGH' : score >= 5 ? 'MED' : 'LOW',
        price: cur, sl,
        tp1: cur - risk * 1.0,
        tp2: cur - risk * 1.618,
        tp3: cur - risk * 2.618,
        rsi: rsi14, atr: atr14,
    };
}
