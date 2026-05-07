/**
 * BingX 自動交易模組
 * 策略：掃描排行榜 → 形態確認 → 動態槓桿開單
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.BINGX_BASE_URL || 'https://open-api-vst.bingx.com';

// API Key 動態讀取：優先從 userState（Telegram 設定），再從 bingx_credentials.json，最後 fallback 到環境變數
const CREDENTIALS_FILE = path.join(process.cwd(), 'bingx_credentials.json');

// 讀取 admin chatId 的 userState credentials（延遲 import 避免循環依賴）
function loadUserCredentials() {
    try {
        const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
        // 讀取所有 state_*.json，找第一個有 credentials.apiKey 的
        const files = fs.readdirSync(dataDir).filter(f => f.startsWith('state_') && f.endsWith('.json') && f !== 'state_global.json');
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
                if (data.credentials?.apiKey && data.credentials?.apiSecret) {
                    return { 
                        apiKey: data.credentials.apiKey, 
                        apiSecret: data.credentials.apiSecret,
                        paperEnabled: !!data.credentials.paperEnabled 
                    };
                }
            } catch (_) { }
        }
    } catch (_) { }
    return null;
}

export function loadCredentials() {
    // 1. 優先讀 userState（Telegram 設定的 key）
    const userCred = loadUserCredentials();
    if (userCred) return userCred;

    // 2. fallback: bingx_credentials.json
    try {
        if (fs.existsSync(CREDENTIALS_FILE)) {
            const stat = fs.statSync(CREDENTIALS_FILE);
            if (!stat.isDirectory()) {
                const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
                if (data.apiKey && data.apiSecret) return data;
            }
        }
    } catch (e) { console.error('[CRED] Load error:', e.message); }

    // 3. fallback: 環境變數
    return {
        apiKey: process.env.BINGX_API_KEY || '',
        apiSecret: process.env.BINGX_API_SECRET || '',
        paperEnabled: false,
    };
}

export function saveCredentials(apiKey, apiSecret) {
    // 如果路徑是目錄（舊版殘留），先移除再建立檔案
    try {
        const stat = fs.statSync(CREDENTIALS_FILE);
        if (stat.isDirectory()) {
            fs.rmSync(CREDENTIALS_FILE, { recursive: true, force: true });
        }
    } catch (e) { /* 不存在，正常 */ }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ apiKey, apiSecret }, null, 2));
}

function getKeys() {
    const cred = loadCredentials();
    const isVst = cred.paperEnabled !== undefined ? !!cred.paperEnabled : true;
    const defaultUrl = isVst ? 'https://open-api-vst.bingx.com' : 'https://open-api.bingx.com';
    const baseUrl = process.env.BINGX_BASE_URL || defaultUrl;
    return { 
        API_KEY: cred.apiKey, 
        SECRET: cred.apiSecret,
        BASE_URL: baseUrl
    };
}

const MARGIN_USDT = 3;  // 每筆保證金固定 3U，開倉金額 = 3 × 槓桿

// 特殊幣種固定槓桿（覆蓋動態槓桿）
const FIXED_LEVERAGE = {
    'BTC-USDT': 75,
    'ETH-USDT': 75,
    'NCCOGOLD2USD-USDT': 75,
    'NCCO1OILWTI2USD-USDT': 75,
    'NCCOOILWTI2USD-USDT': 75,
    'NCCO1OILBRENT2USD-USDT': 75,
    'NCCOXAG2USD-USDT': 75,
};

// BingX 合約名稱對應（symbol → BingX 格式）
// 掃描時動態建立，這裡只放特殊名稱
const SPECIAL_SYMBOL_MAP = {
    // 用戶輸入別名
    OIL: 'NCCO1OILWTI2USD-USDT',
    WTI: 'NCCO1OILWTI2USD-USDT',
    OIL100: 'NCCOOILWTI2USD-USDT',
    WTI100: 'NCCOOILWTI2USD-USDT',
    BRENT: 'NCCO1OILBRENT2USD-USDT',
    XAU: 'NCCOGOLD2USD-USDT',
    GOLD: 'NCCOGOLD2USD-USDT',
    XAG: 'NCCOXAG2USD-USDT',
    SILVER: 'NCCOXAG2USD-USDT',
    XAUUSDT: 'NCCOGOLD2USD-USDT',
    XAGUSDT: 'NCCOXAG2USD-USDT',
    'NCCO1OILWTI2USDUSDT': 'NCCO1OILWTI2USD-USDT',
    'NCCO1OILWTI2USD': 'NCCO1OILWTI2USD-USDT',
    'NCCOOILWTI2USD': 'NCCOOILWTI2USD-USDT',
    // 掃描器 base 直接對應
    'NCCOGOLD2USD': 'NCCOGOLD2USD-USDT',
    'NCCOXAG2USD': 'NCCOXAG2USD-USDT',
};

export function toBingxSymbol(symbol) {
    // 已是 BingX 格式（含 -USDT）直接回傳
    if (symbol.includes('-')) return symbol;
    // 特殊對應
    if (SPECIAL_SYMBOL_MAP[symbol]) return SPECIAL_SYMBOL_MAP[symbol];
    // 標準格式：BTCUSDT → BTC-USDT
    return symbol.replace('USDT', '') + '-USDT';
}

// ── 動態槓桿（依形態強度）────────────────────────────────────────
// strength: 'HIGH' | 'MED' | 'LOW'
// HIGH = BOS + 量價齊升 + RSI確認 → 10x
// MED  = 部分條件符合         → 5x
// HIGH = 多條件強確認         → 10x
// MED  = 部分條件符合         → 7x
// LOW  = 只有漲幅，形態弱     → 5x
export function calcLeverage(strength = 'MED') {
    if (strength === 'HIGH') return 10;
    if (strength === 'MED') return 7;
    return 5;
}

// ── 簽名 ──────────────────────────────────────────────────────────
function sign(queryString, secret) {
    return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

// ── HTTP 請求 ─────────────────────────────────────────────────────
async function request(method, path, params = {}) {
    const { API_KEY, SECRET, BASE_URL: dynamicBaseUrl } = getKeys();
    params.timestamp = Date.now();
    const query = Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const signature = sign(query, SECRET);
    const url = `${dynamicBaseUrl}${path}?${query}&signature=${signature}`;
    try {
        const res = await fetch(url, {
            method,
            headers: { 'X-BX-APIKEY': API_KEY },
        });
        const data = await res.json();
        if (data.code !== 0) {
            console.error(`[BINGX] Error ${data.code}: ${data.msg}`);
            return null;
        }
        return data.data;
    } catch (e) {
        console.error(`[BINGX] Request failed: ${e.message}`);
        return null;
    }
}

// ── 查詢目前持倉 ──────────────────────────────────────────────────
export async function getPositions(symbol = null) {
    const { API_KEY, SECRET } = getKeys();
    if (!API_KEY || !SECRET) return [];
    const params = symbol ? { symbol: toBingxSymbol(symbol) } : {};
    const data = await request('GET', '/openApi/swap/v2/user/positions', params);
    if (!data) return [];
    // 過濾掉空倉（positionAmt = 0）
    return data.filter(p => parseFloat(p.positionAmt) !== 0);
}

// ── 查詢成交歷史紀錄 ──────────────────────────────────────────
export async function getTradeHistory(symbol = null, limit = 10) {
    const params = { limit };
    if (symbol) params.symbol = toBingxSymbol(symbol);
    return await request('GET', '/openApi/swap/v1/user/trades', params);
}

// ── 設定槓桿 ──────────────────────────────────────────────────────
async function setLeverage(bxSymbol, leverage) {
    for (const side of ['LONG', 'SHORT']) {
        await request('POST', '/openApi/swap/v2/trade/leverage', {
            symbol: bxSymbol, side, leverage,
        });
    }
    console.log(`[BINGX] 槓桿設定 ${bxSymbol} x${leverage}`);
}

// ── 開單 ──────────────────────────────────────────────────────────
export async function getOpenOrders(symbol = null) {
    const params = symbol ? { symbol: toBingxSymbol(symbol) } : {};
    const data = await request('GET', '/openApi/swap/v2/trade/openOrders', params);
    if (!data?.orders) return [];
    return data.orders;
}

export async function openOrder({
    symbol,
    side,
    entryPrice,
    sl,
    tp1,
    tp2,
    tp3,
    strength = 'MED',
    orderType = 'MARKET',
    limitPrice = null,
}) {
    const { API_KEY, SECRET } = getKeys();
    if (!API_KEY || !SECRET) {
        console.warn('[BINGX] API Key 未設定，跳過開單');
        return null;
    }

    const bxSymbol = toBingxSymbol(symbol);

    // ── 重複開倉檢查：查 BingX 實際持倉 ──────────────────────────
    const existing = await getPositions(symbol);
    const duplicate = existing.find(p => {
        const posSide = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
        return posSide === side;
    });
    if (duplicate) {
        console.warn(`[BINGX] 跳過開單 ${bxSymbol} ${side}：已有持倉 qty=${duplicate.positionAmt}`);
        return { skipped: true, reason: 'duplicate', symbol: bxSymbol, side };
    }
    const leverage = FIXED_LEVERAGE[bxSymbol] ?? calcLeverage(strength);
    await setLeverage(bxSymbol, leverage);

    // 開倉金額 = 保證金 × 槓桿，數量 = 金額 / 價格
    const notional = MARGIN_USDT * leverage;
    const pricingRef = orderType === 'LIMIT' && limitPrice ? limitPrice : entryPrice;
    const qty = parseFloat((notional / pricingRef).toFixed(4));
    const bxSide = side === 'LONG' ? 'BUY' : 'SELL';
    const positionSide = side === 'LONG' ? 'LONG' : 'SHORT';
    const orderParams = {
        symbol: bxSymbol,
        side: bxSide,
        positionSide,
        type: orderType,
        quantity: qty,
    };
    if (orderType === 'LIMIT') {
        orderParams.price = parseFloat(pricingRef.toFixed(4));
        orderParams.timeInForce = 'GTC';
    }

    const order = await request('POST', '/openApi/swap/v2/trade/order', orderParams);
    if (!order) return null;
    console.log(`[BINGX] 開單 ${bxSymbol} ${side} ${orderType} x${leverage} qty:${qty} margin:${MARGIN_USDT}U`);

    if (orderType === 'LIMIT') {
        return {
            orderId: order.orderId,
            leverage,
            qty,
            bxSymbol,
            margin: MARGIN_USDT,
            orderType,
            limitPrice: pricingRef,
            pending: true,
        };
    }

    // SL
    await request('POST', '/openApi/swap/v2/trade/order', {
        symbol: bxSymbol,
        side: side === 'LONG' ? 'SELL' : 'BUY',
        positionSide, type: 'STOP_MARKET', quantity: qty,
        stopPrice: parseFloat(sl.toFixed(4)), workingType: 'MARK_PRICE',
    });

    // TP1 (50%), TP2 (25%), TP3 (15%) -> 剩下 10% 放飛
    const tpList = [
        { price: tp1, ratio: 0.5 },
        { price: tp2, ratio: 0.25 },
        { price: tp3, ratio: 0.15 },
    ];
    for (const { price, ratio } of tpList) {
        if (!price) continue;
        await request('POST', '/openApi/swap/v2/trade/order', {
            symbol: bxSymbol,
            side: side === 'LONG' ? 'SELL' : 'BUY',
            positionSide, type: 'TAKE_PROFIT_MARKET',
            quantity: parseFloat((qty * ratio).toFixed(4)),
            stopPrice: parseFloat(price.toFixed(4)), workingType: 'MARK_PRICE',
        });
    }

    return { orderId: order.orderId, leverage, qty, bxSymbol, margin: MARGIN_USDT, orderType };
}

// ── 更新止損單（取消舊 SL，掛新 SL）────────────────────────────
export async function updateStopLoss({ symbol, side, newSl, qty }) {
    const bxSymbol = toBingxSymbol(symbol);
    const positionSide = side === 'LONG' ? 'LONG' : 'SHORT';
    const slSide = side === 'LONG' ? 'SELL' : 'BUY';

    // 1. 查詢所有掛單，找出 STOP_MARKET 止損單
    const openOrders = await request('GET', '/openApi/swap/v2/trade/openOrders', { symbol: bxSymbol });
    if (openOrders?.orders) {
        const slOrders = openOrders.orders.filter(o =>
            o.type === 'STOP_MARKET' && o.positionSide === positionSide
        );
        // 2. 取消所有舊止損單
        for (const o of slOrders) {
            await request('DELETE', '/openApi/swap/v2/trade/order', {
                symbol: bxSymbol,
                orderId: o.orderId,
            });
            console.log(`[BINGX] 取消舊止損單 ${bxSymbol} orderId=${o.orderId}`);
        }
    }

    // 3. 掛新止損單
    const result = await request('POST', '/openApi/swap/v2/trade/order', {
        symbol: bxSymbol,
        side: slSide,
        positionSide,
        type: 'STOP_MARKET',
        quantity: parseFloat(qty.toFixed(4)),
        stopPrice: parseFloat(newSl.toFixed(4)),
        workingType: 'MARK_PRICE',
    });

    if (result) {
        console.log(`[BINGX] 新止損單已掛 ${bxSymbol} ${side} SL=${newSl} qty=${qty}`);
    } else {
        console.error(`[BINGX] 掛新止損單失敗 ${bxSymbol} ${side} SL=${newSl}`);
    }
    return result;
}

// ── 平倉（市價全平）──────────────────────────────────────────────
export async function closeOrder({ symbol, side, qty }) {
    const { API_KEY, SECRET } = getKeys();
    if (!API_KEY || !SECRET) return null;
    const bxSymbol = toBingxSymbol(symbol);
    const result = await request('POST', '/openApi/swap/v2/trade/order', {
        symbol: bxSymbol,
        side: side === 'LONG' ? 'SELL' : 'BUY',
        positionSide: side === 'LONG' ? 'LONG' : 'SHORT',
        type: 'MARKET', quantity: qty,
    });
    if (result) console.log(`[BINGX] 平倉 ${bxSymbol} ${side}`);
    return result;
}

// ── 一鍵平倉（查倉位後全平）─────────────────────────────────────
export async function closeAllPositions(symbol = null) {
    const positions = await getPositions(symbol);
    if (!positions.length) return [];
    const results = [];
    for (const pos of positions) {
        const qty = Math.abs(parseFloat(pos.positionAmt));
        const side = pos.positionSide || (parseFloat(pos.positionAmt) > 0 ? 'LONG' : 'SHORT');
        const result = await request('POST', '/openApi/swap/v2/trade/order', {
            symbol: pos.symbol,
            side: side === 'LONG' ? 'SELL' : 'BUY',
            positionSide: side,
            type: 'MARKET', quantity: qty,
        });
        if (result) results.push({ symbol: pos.symbol, side, qty });
    }
    return results;
}

// ── 查詢持倉量（Open Interest）────────────────────────────────
export async function getOpenInterest(symbol) {
    try {
        const bxSymbol = toBingxSymbol(symbol);
        const res = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/openInterest?symbol=${bxSymbol}`);
        const data = await res.json();
        if (data.code !== 0 || !data.data) return null;
        return {
            oi: parseFloat(data.data.openInterest),
            time: data.data.time,
        };
    } catch { return null; }
}

// ── 查詢資金費率 ──────────────────────────────────────────────────
export async function getFundingRate(symbol) {
    try {
        const bxSymbol = toBingxSymbol(symbol);
        const res = await fetch(`https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex?symbol=${bxSymbol}`);
        const data = await res.json();
        if (data.code !== 0 || !data.data) return null;
        return {
            rate: parseFloat(data.data.lastFundingRate),      // 當前費率（小數，如 0.0001）
            nextFundingTime: data.data.nextFundingTime,
            markPrice: parseFloat(data.data.markPrice),
        };
    } catch { return null; }
}

function extractRateLimitHeaders(headers) {
    const picked = [];
    for (const [key, value] of headers.entries()) {
        if (/(limit|quota|rate|x-bx)/i.test(key)) {
            picked.push({ key, value });
        }
    }
    return picked;
}

export async function getApiQuotaInfo(apiKey, apiSecret) {
    try {
        const { API_KEY, SECRET, BASE_URL: dynamicBaseUrl } = getKeys();
        const params = { timestamp: Date.now() };
        const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        const sig = crypto.createHmac('sha256', SECRET).update(query).digest('hex');
        const url = `${dynamicBaseUrl}/openApi/swap/v2/user/balance?${query}&signature=${sig}`;
        const res = await fetch(url, { headers: { 'X-BX-APIKEY': apiKey } });
        const data = await res.json();
        if (data.code !== 0) {
            return { ok: false, msg: `錯誤碼 ${data.code}: ${data.msg}` };
        }

        const balance = data.data?.balance?.balance || '0';
        const availableMargin = data.data?.balance?.availableMargin || data.data?.balance?.available || null;
        const frozenMargin = data.data?.balance?.freezedMargin || data.data?.balance?.frozenMargin || null;
        const rateHeaders = extractRateLimitHeaders(res.headers);

        return {
            ok: true,
            balance,
            availableMargin,
            frozenMargin,
            rateHeaders,
            staticLimits: {
                marketSharedIp: '500 次 / 10 秒',
                accountTotalIp: '2000 次 / 10 秒',
                balance: '5 次 / 秒',
                positions: '5 次 / 秒',
                order: '10 次 / 秒',
            },
        };
    } catch (e) {
        return { ok: false, msg: e.message };
    }
}

export async function testCredentials(apiKey, apiSecret) {
    return await getApiQuotaInfo(apiKey, apiSecret);
}
