/**
 * Loop A：主流標的進場掃描（BTC/ETH/XAU/OIL100）
 *
 * 設計重點：
 * 1. 只負責進場審核與開倉，不處理反手平倉
 * 2. 採三層判斷：4h Regime -> 1h 動能 -> 15m 觸發
 * 3. 先做交易所持倉檢查，再送單，避免重複開倉
 */

import { fetchKlines, getMaxLeverage } from '../trading/scanner.js';
import { rsi, ema, atr, macd } from '../core/indicators.js';
import { runLoopD } from './loopD_pattern.js';
import { loadUserState, saveUserState } from '../core/state_manager.js';
import { loadCredentials, openOrder, getPositions, getFundingRate, getOpenOrders } from '../trading/bingx_trader.js';
import { fetchOIContext } from '../trading/analysis.js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadChannels() {
    const p = resolve(__dirname, '../../../ignoreCommit/channels.json');
    if (existsSync(p)) {
        try { return JSON.parse(readFileSync(p, 'utf8')); } catch(_) {}
    }
    return { loopA_channel: '-1003869568904', loopA_thread_id: null };
}
const CHANNELS = loadChannels();
const LOOP_A_CHANNEL   = CHANNELS.loopA_channel;
const LOOP_A_THREAD_ID = CHANNELS.loopA_thread_id ?? null;

const MAJOR_COINS = [
    { base: 'BTC',    symbol: 'BTC-USDT' },
    { base: 'ETH',    symbol: 'ETH-USDT' },
    { base: 'XAU',    symbol: 'NCCOGOLD2USD-USDT' },
    { base: 'OIL100', symbol: 'NCCOOILWTI2USD-USDT' },
];
const PENDING_TTL_MS = 15 * 60 * 1000;

function analyzeMomentum(candles, side) {
    if (!candles || candles.length < 35) return { pass: false, rsi: 50, hist: 0, price: 0 };
    const closes = candles.map(c => parseFloat(c[4]));
    const curPrice = closes[closes.length - 1];
    const curRsi = rsi(closes, 14);
    const ema21 = ema(closes, 21);
    const ema55 = ema(closes, 55);
    const macdV = macd(closes);
    if (side === 'LONG') {
        return { pass: curPrice > ema21 && ema21 >= ema55 && curRsi >= 52 && macdV.hist > 0, rsi: curRsi, hist: macdV.hist, price: curPrice };
    }
    return { pass: curPrice < ema21 && ema21 <= ema55 && curRsi <= 48 && macdV.hist < 0, rsi: curRsi, hist: macdV.hist, price: curPrice };
}

function computeFibZone(candles, side) {
    if (!candles || candles.length < 40) return null;
    const slice = candles.slice(-30);
    const highs = slice.map(c => parseFloat(c[2]));
    const lows = slice.map(c => parseFloat(c[3]));
    const swingHigh = Math.max(...highs);
    const swingLow = Math.min(...lows);
    const range = swingHigh - swingLow;
    if (!(range > 0)) return null;
    if (side === 'LONG') {
        return {
            anchorHigh: swingHigh,
            anchorLow: swingLow,
            entryMin: swingHigh - range * 0.618,
            entryMax: swingHigh - range * 0.382,
            limitEntry: swingHigh - range * 0.5,
            stopLoss: swingLow - range * 0.12,
        };
    }
    return {
        anchorHigh: swingHigh,
        anchorLow: swingLow,
        entryMin: swingLow + range * 0.382,
        entryMax: swingLow + range * 0.618,
        limitEntry: swingLow + range * 0.5,
        stopLoss: swingHigh + range * 0.12,
    };
}

function inFibZone(price, fib, side) {
    if (!fib) return false;
    const low = Math.min(fib.entryMin, fib.entryMax);
    const high = Math.max(fib.entryMin, fib.entryMax);
    return price >= low && price <= high;
}

function getLiveEntryPrice(candles3m) {
    return parseFloat(candles3m[candles3m.length - 1][4]);
}

function logPending(base, side, msg) {
    console.log(`[LOOP-A] [${base} ${side}] ${msg}`);
}

async function scanCoin(base, side, botState) {
    const pendingKey = `${base}_${side}`;
    const pendingMap = botState.loopAPending || (botState.loopAPending = {});
    const pending = pendingMap[pendingKey];
    const now = Date.now();

    if (pending?.stage === 'order_pending') {
        const symbol = pending.symbol || `${base}-USDT`;
        const [positions, openOrders] = await Promise.all([
            getPositions(symbol).catch(() => []),
            getOpenOrders(symbol).catch(() => []),
        ]);
        const pos = positions.find(p => {
            const ps = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
            return ps === side && Math.abs(parseFloat(p.positionAmt || 0)) > 0;
        });
        if (pos) {
            delete pendingMap[pendingKey];
            logPending(base, side, `limit filled qty=${Math.abs(parseFloat(pos.positionAmt || 0)).toFixed(4)}`);
            return {
                pendingFilled: true,
                side,
                base,
                symbol,
                fillQty: Math.abs(parseFloat(pos.positionAmt || 0)),
                fillOrderId: pending.orderId,
                ...pending.strategy,
            };
        }
        const stillOpen = openOrders.some(o => String(o.orderId) === String(pending.orderId));
        if (stillOpen) {
            logPending(base, side, `waiting fill limit=${pending.limitPrice.toFixed(2)} orderId=${pending.orderId}`);
            return null;
        }
        if (now - (pending.updatedAt || pending.startedAt || 0) > PENDING_TTL_MS) {
            logPending(base, side, `limit expired/unfilled orderId=${pending.orderId}`);
            delete pendingMap[pendingKey];
        }
        return null;
    }

    const [candles3m, candles5m, candles15m, candles30m, candles1h] = await Promise.all([
        fetchKlines(base, '3m', 100),
        fetchKlines(base, '5m', 100),
        fetchKlines(base, '15m', 100),
        fetchKlines(base, '30m', 100),
        fetchKlines(base, '1h', 100),
    ]);
    if (!candles3m || !candles5m || !candles15m || !candles30m || !candles1h) return null;

    const mom1h = analyzeMomentum(candles1h, side);
    const mom30m = analyzeMomentum(candles30m, side);
    if (!mom1h.pass || !mom30m.pass) return null;

    const funding = await getFundingRate(base).catch(() => null);
    const oiContext = await fetchOIContext(base).catch(() => null);
    if (side === 'LONG') {
        if (funding?.rate > 0.0015) return null;
        if (oiContext?.smartSide === 'SHORT' && !oiContext?.divergence) return null;
    } else {
        if (funding?.rate < -0.0015) return null;
        if (oiContext?.smartSide === 'LONG' && !oiContext?.divergence) return null;
    }

    const fib = computeFibZone(candles1h, side);
    if (!fib) return null;
    const price15m = parseFloat(candles15m[candles15m.length - 1][4]);
    if (!inFibZone(price15m, fib, side)) return null;

    const closes15m = candles15m.map(c => parseFloat(c[4]));
    const closes5m = candles5m.map(c => parseFloat(c[4]));
    const closes3m = candles3m.map(c => parseFloat(c[4]));
    const rsi15m = rsi(closes15m, 14);
    const rsi5m = rsi(closes5m, 14);
    const macd5m = macd(closes5m);
    const macd3m = macd(closes3m);
    const price5m = closes5m[closes5m.length - 1];
    const price3m = closes3m[closes3m.length - 1];
    const prev3m = closes3m[closes3m.length - 2] || price3m;

    const trigger15m = side === 'LONG' ? rsi15m >= 50 : rsi15m <= 50;
    const trigger5m = side === 'LONG'
        ? rsi5m >= 52 && macd5m.hist > 0 && price5m >= fib.limitEntry
        : rsi5m <= 48 && macd5m.hist < 0 && price5m <= fib.limitEntry;
    const trigger3m = side === 'LONG'
        ? macd3m.hist > 0 && price3m >= prev3m
        : macd3m.hist < 0 && price3m <= prev3m;
    if (pending && now - (pending.updatedAt || pending.startedAt || 0) > PENDING_TTL_MS) {
        logPending(base, side, `pending expired at stage=${pending.stage}`);
        delete pendingMap[pendingKey];
    }

    if (!trigger3m) {
        if (pendingMap[pendingKey]) logPending(base, side, `3m invalidated, clearing pending stage=${pendingMap[pendingKey].stage}`);
        delete pendingMap[pendingKey];
        return null;
    }

    if (!pendingMap[pendingKey]) {
        pendingMap[pendingKey] = {
            stage: '3m',
            startedAt: now,
            updatedAt: now,
            fib,
            direction: side,
        };
        logPending(base, side, `3m ignited price=${price3m.toFixed(2)} fib=${fib.limitEntry.toFixed(2)}`);
        return null;
    }

    if (pendingMap[pendingKey].stage === '3m') {
        if (!trigger5m) {
            logPending(base, side, `waiting 5m confirm rsi5m=${rsi5m.toFixed(1)} macd5m=${macd5m.hist.toFixed(6)}`);
            return null;
        }
        pendingMap[pendingKey] = {
            ...pendingMap[pendingKey],
            stage: '5m',
            updatedAt: now,
        };
        logPending(base, side, `5m confirmed price=${price5m.toFixed(2)}`);
        return null;
    }

    if (pendingMap[pendingKey].stage === '5m' && !trigger15m) {
        logPending(base, side, `waiting 15m expansion rsi15m=${rsi15m.toFixed(1)}`);
        return null;
    }

    if (!trigger15m || !trigger5m) return null;

    const entryPrice = getLiveEntryPrice(candles3m);
    if (!inFibZone(entryPrice, fib, side)) {
        logPending(base, side, `live price drifted out of fib zone entry=${entryPrice.toFixed(2)} zone=${Math.min(fib.entryMin, fib.entryMax).toFixed(2)}-${Math.max(fib.entryMin, fib.entryMax).toFixed(2)}`);
        return null;
    }
    const sl = fib.stopLoss;
    const risk = Math.abs(entryPrice - sl);
    const slPct = Math.abs(risk / entryPrice * 100);
    if (slPct > 4) {
        logPending(base, side, `reject due to slPct=${slPct.toFixed(2)}%`);
        return null;
    }
    logPending(base, side, `15m expanded -> ready to enter entry=${entryPrice.toFixed(2)} sl=${sl.toFixed(2)}`);
    delete pendingMap[pendingKey];

    return {
        readyToPlace: true,
        side,
        base,
        symbol: `${base}-USDT`,
        price: entryPrice,
        sl,
        tp1: side === 'LONG' ? entryPrice + risk : entryPrice - risk,
        tp2: side === 'LONG' ? entryPrice + risk * 1.618 : entryPrice - risk * 1.618,
        tp3: side === 'LONG' ? entryPrice + risk * 2.618 : entryPrice - risk * 2.618,
        strength: Math.abs(macd5m.hist) > Math.abs(macd3m.hist) ? 'HIGH' : 'MED',
        reasons: [
            `1h/30m momentum aligned`,
            `Fib ${(side === 'LONG' ? 'pullback buy' : 'pullback sell')} zone ${Math.min(fib.entryMin, fib.entryMax).toFixed(2)}-${Math.max(fib.entryMin, fib.entryMax).toFixed(2)}`,
            `Live entry ${entryPrice.toFixed(2)} (limit ref ${fib.limitEntry.toFixed(2)})`,
            `Funding ${funding?.rate != null ? funding.rate.toFixed(4) : 'N/A'}`,
            `OI ${oiContext?.smartSide || 'N/A'}`,
            `15m RSI ${rsi15m.toFixed(0)}`,
            `5m MACD ${macd5m.hist > 0 ? 'up' : 'down'}`,
            `3m trigger`,
        ],
        stage2: {
            pass: true,
            indicators: {
                rsi6: rsi(closes5m, 6),
                rsi12: rsi(closes15m, 12),
                rsi24: rsi(closes30m, 24),
                macdHist: macd5m.hist,
            },
        },
        trailMult: 2.0,
        initRisk: risk,
        maxHoldMs: 72 * 60 * 60 * 1000,
        is4hReversal: false,
        regime: 'momentum_fib',
    };
}

export async function runLoopMajor(ctx) {
    const {
        botState, sendMessage,
        saveState, formatPrice,
        MAX_POSITIONS_TOTAL,
        getPositions,
    } = ctx;
    const now = Date.now();

    // 如需總倉位上限，可打開下行限制
    // if (Object.keys(botState.activeStrategies).length >= MAX_POSITIONS_TOTAL) return;

    const adminIds = botState.admins || [];
    if (!adminIds.length) return;

    // 建立 O(1) 持倉索引，避免每次掃描做 O(n) 查找
    const existingMap = new Map();
    for (const [k, st] of Object.entries(botState.activeStrategies)) {
        if (st.symbol) {
            existingMap.set(st.symbol, k);
            existingMap.set(st.symbol.replace('-USDT', ''), k);
        }
    }

    // 並行掃描所有主流標的雙向訊號
    const scanResults = await Promise.all(
        MAJOR_COINS.flatMap(({ base, symbol }) =>
            ['LONG', 'SHORT'].map(side =>
                scanCoin(base, side, botState)
                    .then(signal => ({ base, symbol, side, signal }))
                    .catch(e => {
                        console.error(`[LOOP-A] scanCoin error ${base} ${side}:`, e.message);
                        return { base, symbol, side, signal: null };
                    })
            )
        )
    );

    for (const { base, symbol } of MAJOR_COINS) {
        // 讀取該標的現有倉位
        const existingKey = existingMap.get(base) ?? existingMap.get(symbol);
        const existing = existingKey ? botState.activeStrategies[existingKey] : null;

        // 讀取該標的 LONG/SHORT 掃描結果
        const coinResults = scanResults.filter(r => r.base === base);
        const cooldowns = botState.scanCooldown || {};

        for (const { side, signal } of coinResults) {
            if (!signal) continue;

            if (existing) {
                // loopA 不處理反手，已有持倉時直接跳過此幣種
                continue;
            }

            if (signal.pendingFilled) {
                const { price, sl, tp1, tp2, tp3, strength, reasons, stage2, trailMult, initRisk, maxHoldMs, is4hReversal, regime, fillQty, fillOrderId } = signal;
                const maxLev = await getMaxLeverage(base);
                const leverage = Math.floor((maxLev || 20) * 0.5);
                const principal = /add-position/.test((reasons || []).join(' ')) ? 4 : 2;
                const slPct = Math.abs((sl - price) / price * 100).toFixed(1);
                const emoji = strength === 'HIGH' ? '🔥' : strength === 'MED' ? '⭐' : '📌';
                const sideEmoji = side === 'LONG' ? '📈' : '📉';
                const modeLabel = is4hReversal ? ' (reversal)' : '';
                const regimeLabel = regime === 'strong_trend' ? ' [strong]' : regime === 'weak_trend' ? ' [weak]' : regime === 'momentum_fib' ? ' [momentum-fib]' : '';
                const msg =
                    `${emoji}${sideEmoji} ${side === 'LONG' ? 'LONG' : 'SHORT'} signal ${base}${modeLabel}${regimeLabel}\n` +
                    `Price \`${formatPrice(price)}\`  Leverage x${leverage}\n` +
                    `SL \`${formatPrice(sl)}\` (${slPct}%)  Trail x${trailMult}\n` +
                    `Max hold: 72h\n` +
                    `Reasons: ${(reasons || []).join(' | ')}\n` +
                    `RSI 6/12/24: \`${stage2?.indicators?.rsi6?.toFixed(0)}/${stage2?.indicators?.rsi12?.toFixed(0)}/${stage2?.indicators?.rsi24?.toFixed(0)}\`  ` +
                    `MACD: \`${stage2?.indicators?.macdHist > 0 ? '↑' : '↓'}${Math.abs(stage2?.indicators?.macdHist || 0).toFixed(6)}\``;
                await sendMessage(LOOP_A_CHANNEL, msg, {
                    omitLabel: true,
                    ...(LOOP_A_THREAD_ID ? { message_thread_id: LOOP_A_THREAD_ID } : {})
                });
                for (const chatId of adminIds) {
                    const sk = `${chatId}_${base}`;
                    const userState = loadUserState(chatId);
                    if (!userState.activeStrategies) userState.activeStrategies = {};
                    if (botState.activeStrategies[sk] || userState.activeStrategies[sk]) continue;
                    const newStrategy = {
                        chatId, symbol: base, side,
                        entryPrice: price, sl,
                        trailMult, initRisk,
                        trailSl: sl,
                        bestPrice: price,
                        maxHoldMs,
                        tp1, tp2, tp3,
                        tp1Hit: false, tp2Hit: false,
                        strength, leverage, principal,
                        time: Date.now(), status: 'ACTIVE',
                        strategyType: 'major',
                        loopType: 'loopA',
                        isPaper: true,
                        regime,
                        bingxQty: fillQty,
                        bingxOrderId: fillOrderId,
                        entrySnapshot: { reasons, strength },
                    };
                    botState.activeStrategies[sk] = newStrategy;
                    userState.activeStrategies[sk] = newStrategy;
                    saveUserState(chatId, userState);
                    await sendMessage(chatId, msg);
                }
                saveState();
                break;
            }

            // loopD 型態過濾
            const pattern = await runLoopD(base, side, { price: signal.price }, { caller: 'loopA' });
            console.log(`[LOOP-D] ${base} score=${pattern.score} ${pattern.label}` +
                (pattern.chasingRisk     ? ` [chasing-risk]` : '') +
                (pattern.reasons.length  ? ` | ${pattern.reasons.join(' | ')}` : '') +
                (pattern.warnings.length ? ` | ${pattern.warnings.join(' ')}` : ''));
            if (!pattern.pass) {
                console.log(`[LOOP-D] [SKIP] ${base} pattern filter not passed`);
                continue;
            }

            // 交易所實倉檢查：防止重複開倉
            try {
                const realPositions = await getPositions(symbol);
                const hasPos = realPositions.some(p => {
                    const ps = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
                    return ps === side && Math.abs(parseFloat(p.positionAmt)) > 0;
                });
                if (hasPos) {
                    console.log(`[LOOP-A] ${base} already has exchange position, skip`);
                    continue;
                }
            } catch (e) {
                console.error(`[LOOP-A] failed to check exchange position ${base}:`, e.message);
            }

            // API key 未設定時不送單
            const cred = loadCredentials();
            if (!cred.apiKey || !cred.apiSecret) {
                console.log(`[LOOP-A] API key not configured, skip ${base} ${side}`);
                break;
            }

            const { price, sl, tp1, tp2, tp3, strength, reasons, stage2, trailMult, initRisk, maxHoldMs, is4hReversal, regime } = signal;
            // 預設本金與槓桿規則
            const maxLev    = await getMaxLeverage(base);
            const leverage  = Math.floor((maxLev || 20) * 0.5);
            // 型態評分加碼：score >= 5 時本金提高
            const principal = pattern.addPosition ? 4 : 2;
            const slPct     = Math.abs((sl - price) / price * 100).toFixed(1);
            const emoji     = strength === 'HIGH' ? '🔥' : strength === 'MED' ? '⭐' : '📌';
            const sideEmoji = side === 'LONG' ? '📈' : '📉';
            const modeLabel = is4hReversal ? ' (reversal)' : '';
            const regimeLabel = regime === 'strong_trend' ? ' [strong]' : regime === 'weak_trend' ? ' [weak]' : '';

            const patternLine = pattern.score > 0
                ? `\nloopD ${pattern.label}${pattern.reasons.length ? ' | ' + pattern.reasons.join(' | ') : ''}${pattern.addPosition ? ' | add-position' : ''}`
                : '';

            const msg =
                `${emoji}${sideEmoji} ${side === 'LONG' ? 'LONG' : 'SHORT'} signal ${base}${modeLabel}${regimeLabel}${pattern.addPosition ? ' [scale-in]' : ''}\n` +
                `Price \`${formatPrice(price)}\`  Leverage x${leverage}\n` +
                `SL \`${formatPrice(sl)}\` (${slPct}%)  Trail x${trailMult}\n` +
                `Max hold: 72h\n` +
                `Reasons: ${reasons.join(' | ')}${patternLine}\n` +
                `RSI 6/12/24: \`${stage2.indicators?.rsi6?.toFixed(0)}/${stage2.indicators?.rsi12?.toFixed(0)}/${stage2.indicators?.rsi24?.toFixed(0)}\`  ` +
                `MACD: \`${stage2.indicators?.macdHist > 0 ? '↑' : '↓'}${Math.abs(stage2.indicators?.macdHist || 0).toFixed(6)}\``;

            let bxOrder = null;
            try {
                bxOrder = await openOrder({
                    symbol,
                    side,
                    entryPrice: price,
                    sl,
                    tp1,
                    tp2,
                    tp3,
                    strength,
                    orderType: 'LIMIT',
                    limitPrice: price,
                });
            } catch (e) {
                console.error(`[LOOP-A] paper order failed ${base}:`, e.message);
                continue;
            }

            if (!bxOrder || bxOrder.skipped) {
                if (bxOrder?.skipped) {
                    console.log(`[LOOP-A] paper order skipped (already has position): ${base} ${side}`);
                } else {
                    console.log(`[LOOP-A] paper order returned empty result: ${base} ${side}`);
                }
                continue;
            }

            botState.loopAPending[`${base}_${side}`] = {
                stage: 'order_pending',
                startedAt: Date.now(),
                updatedAt: Date.now(),
                symbol,
                orderId: bxOrder.orderId,
                limitPrice: price,
                strategy: {
                    price, sl, tp1, tp2, tp3, strength, reasons, stage2, trailMult, initRisk, maxHoldMs, is4hReversal, regime,
                },
            };
            console.log(`[LOOP-A] limit order submitted ${base} ${side} orderId=${bxOrder.orderId} price=${price}`);
            saveState();
            break; // 同一標的本輪只取一個方向
        }
    }
}
