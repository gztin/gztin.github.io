/**
 * Loop B：持倉監測 + 反轉偵測 + 出場管理
 *
 * 執行頻率：每 30 秒
 *
 * 職責：
 *   1. 反轉偵測（monitorPosition）：HIGH 權重 > 6 → 平倉
 *   2. TP 出場：現價達到 tp1/tp2/tp3 → 通知（tp3 清除倉位）
 *   3. 超時深度虧損：持倉 > 48h 且虧損 ≥ 9% → 平倉
 *   4. 資金費率監測：每 8 分鐘更新一次
 */

import fs from 'fs';
import path from 'path';
import { fetchKlines } from '../trading/scanner.js';
import { getFundingRate, closeOrder, getPositions } from '../trading/bingx_trader.js';
import { loadUserState, saveUserState } from '../core/state_manager.js';
import { addToAlert, removeFromAlert, syncAlertList } from '../core/alert_list.js';
import { getStrategyParam } from '../core/strategy_params.js';
import { closedPositionsCache } from '../core/bollinger_strategy.js';

const TIMEOUT_MS   = 48 * 60 * 60 * 1000; // 48 小時

function normalizeSymbol(symbol = '') {
    return symbol.includes('-') ? symbol : `${symbol.replace(/USDT$/, '')}-USDT`;
}

function positionSide(pos) {
    return pos.positionSide || (parseFloat(pos.positionAmt) > 0 ? 'LONG' : 'SHORT');
}

function positionRoePct(pos) {
    const pnlUsdt = parseFloat(pos.unrealizedProfit || 0);
    const qty = Math.abs(parseFloat(pos.positionAmt || 0));
    const entry = parseFloat(pos.entryPrice || pos.avgPrice || 0);
    const leverage = parseFloat(pos.leverage || 1);
    const margin = entry > 0 && qty > 0 && leverage > 0 ? (entry * qty / leverage) : 0;
    return margin > 0 ? (pnlUsdt / margin * 100) : 0;
}

function findStrategyEntry(botState, symbol, side) {
    const fullSymbol = normalizeSymbol(symbol);
    return Object.entries(botState.activeStrategies || {}).find(([, st]) =>
        normalizeSymbol(st.symbol) === fullSymbol && st.side === side
    );
}

function makePositionKey(symbol, side) {
    return `${normalizeSymbol(symbol)}_${side}`;
}

function fallbackAlertChatId(botState) {
    return String((botState.admins || [])[0] || '');
}

function isPositionConnected(chatId) {
    if (!chatId) return false;
    const userState = loadUserState(chatId);
    return userState.botSettings?.positionConnected === true;
}

export async function runLoopMonitor(ctx) {
    const {
        botState, sendMessage, monitorPosition,
        formatPrice, saveState,
    } = ctx;

    const activeStrategies = Object.entries(botState.activeStrategies || {});
    const connectedChatIds = new Set(
        activeStrategies
            .map(([, strategy]) => strategy.chatId || fallbackAlertChatId(botState))
            .filter(chatId => isPositionConnected(chatId))
            .map(String)
    );

    if (connectedChatIds.size === 0) {
        syncAlertList(new Set());
        _cleanupWatchlists();
        return;
    }

    const exchangePositions = await getPositions().catch(() => []);
    const exchangePositionMap = new Map(
        exchangePositions.map(pos => [makePositionKey(pos.symbol, positionSide(pos)), pos])
    );
    const alertLossRoe = getStrategyParam('risk', 'attentionLossRoe');
    const forceCloseLossRoe = getStrategyParam('risk', 'forceCloseLossRoe');
    const timeoutLossPct = getStrategyParam('risk', 'timeoutLossPct');

    // --- 0. 先以交易所實際持倉同步注意清單 ---
    const allActiveKeys = new Set();
    for (const pos of exchangePositions) {
        const side = positionSide(pos);
        const [strategyKey, strategy] = findStrategyEntry(botState, pos.symbol, side) || [];
        const chatId = strategy?.chatId || fallbackAlertChatId(botState);
        if (chatId) allActiveKeys.add(`${chatId}_${pos.symbol}_${side}`);
        if (strategyKey) allActiveKeys.add(strategyKey);
    }
    syncAlertList(allActiveKeys);

    // --- 1. 交易所實際持倉風控：-15% 加入注意清單，-25% 強制平倉 ---
    for (const pos of exchangePositions) {
        const side = positionSide(pos);
        const roe = positionRoePct(pos);
        if (roe > alertLossRoe) continue;

        const fullSymbol = pos.symbol;
        const [strategyKey, strategy] = findStrategyEntry(botState, fullSymbol, side) || [];
        const chatId = strategy?.chatId || fallbackAlertChatId(botState);
        if (!chatId) continue;

        if (roe <= forceCloseLossRoe) {
            const qty = Math.abs(parseFloat(pos.positionAmt || 0));
            const exitPrice = parseFloat(pos.markPrice || pos.price || pos.lastPrice || pos.avgPrice || pos.entryPrice || 0);
            try {
                const closeResult = await closeOrder({ symbol: fullSymbol, side, qty });
                if (!closeResult) throw new Error('closeOrder returned empty result');
            } catch (e) {
                console.error(`[LOOP B] 強制平倉失敗 ${fullSymbol}:`, e.message);
                continue;
            }

            removeFromAlert(chatId, fullSymbol, side);
            if (strategyKey && strategy) {
                _recordExit(ctx, strategyKey, strategy, exitPrice || strategy.entryPrice, roe.toFixed(2), '風控強制平倉');
            } else {
                saveState();
            }
            continue;
        }

        const added = addToAlert(chatId, fullSymbol, side, roe.toFixed(2));
        if (added) console.log(`[LOOP B] 已加入背景關注名單 ${fullSymbol} ${side} roe=${roe.toFixed(1)}%`);
    }

    for (const [strategyKey, strategy] of activeStrategies) {
        const { symbol, side, entryPrice, sl, tp1, tp2, tp3, time, chatId, bingxQty, loopType } = strategy;
        if (!isPositionConnected(chatId || fallbackAlertChatId(botState))) continue;

        const base    = symbol.replace('-USDT', '').replace('USDT', '');
        const symFull = symbol.includes('-') ? symbol : `${symbol}-USDT`;
        const livePosition = exchangePositionMap.get(makePositionKey(symFull, side));

        // 先以 BingX API 真實持倉為準；若交易所已無此倉位，直接結案清理本地殘留策略
        if (!livePosition) {
            removeFromAlert(chatId, symFull, side);
            const fallbackExitPrice = parseFloat(strategy.lastPrice || strategy.lastMarkPrice || entryPrice || 0) || entryPrice;
            const fallbackExitPnl = Number.isFinite(parseFloat(strategy.lastPnl))
                ? parseFloat(strategy.lastPnl).toFixed(2)
                : '0.00';

            if (loopType !== 'loopF' && chatId) {
                await sendMessage(
                    chatId,
                    `ℹ️ 已同步清理 ${base} (${side === 'LONG' ? '做多' : '做空'})\n` +
                    `BingX API 已查無此持倉，系統已自動將本地策略結案。\n` +
                    `結案損益：${fallbackExitPnl}%`
                );
            }

            _recordExit(ctx, strategyKey, strategy, fallbackExitPrice, fallbackExitPnl, 'BingX 持倉同步清理');
            closedPositionsCache.set(symFull, Date.now()); // 加入冷卻
            continue;
        }

        // ── 1. 反轉偵測（monitorPosition）────────────────────────
        const monitor = await monitorPosition(base, side, entryPrice).catch(() => null);
        if (!monitor) continue;

        const { price, alerts, pnlPct, reversal } = monitor;

        if (reversal?.reversed) {
            strategy.lastReversal = {
                confidence: reversal.confidence,
                reason: reversal.reason,
                totalWeight: reversal.totalWeight,
                time: Date.now(),
            };

            if (reversal.totalWeight > 6) {
                // HIGH 反轉 → 平倉
                const monitor2 = await monitorPosition(base, side, entryPrice).catch(() => monitor);
                const exitPrice = monitor2?.price || price;
                const exitPnl   = monitor2?.pnlPct || pnlPct;
                const pnlEmoji  = parseFloat(exitPnl) >= 0 ? '🟢' : '🔴';

                if (loopType !== 'loopF') {
                    await sendMessage(chatId,
                        `🚨 反轉平倉 ${base} (HIGH)\n` +
                        `${reversal.reason}\n` +
                        `${pnlEmoji} 進場 \`${formatPrice(entryPrice)}\` → 出場 \`${formatPrice(exitPrice)}\`\n` +
                        `損益 ${exitPnl}%`
                    );
                }

                try {
                    if (bingxQty) {
                        await closeOrder({ symbol: symFull, side, qty: bingxQty });
                    } else {
                        const positions = await getPositions(symFull);
                        const pos = positions.find(p => {
                            const ps = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
                            return ps === side;
                        });
                        if (pos) await closeOrder({ symbol: symFull, side, qty: Math.abs(parseFloat(pos.positionAmt)) });
                    }
                } catch (e) {
                    console.error(`[LOOP B] 反轉平倉失敗 ${base}:`, e.message);
                }

                _recordExit(ctx, strategyKey, strategy, exitPrice, exitPnl, `反轉平倉 (${reversal.reason})`);
                continue;
            }
        } else if (!reversal?.reversed && strategy.alertSent) {
            strategy.alertSent = false;
            strategy.lastReversal = null;
            strategy.medNotifyCount = 0;
            strategy.medFirstNotifyTime = 0;
        }

        strategy.lastAlerts = alerts.length > 0 ? alerts : [];

        // ── 2. TP / 超時出場管理 ────────────────────────────────
        if (sl) {
            const curPrice = price; // monitorPosition 已取得現價

            // ── 3. TP 出場（依序 tp1 → tp2 → tp3）───────────────
            const tpLevels = [
                { key: 'tp1Hit', price: tp1, label: 'TP1', pct: '50%' },
                { key: 'tp2Hit', price: tp2, label: 'TP2', pct: '30%' },
                { key: 'tp3Hit', price: tp3, label: 'TP3', pct: '20%' },
            ];

            let tpTriggered = false;
            for (const tp of tpLevels) {
                if (!tp.price || strategy[tp.key]) continue;
                const tpHit = side === 'LONG' ? curPrice >= tp.price : curPrice <= tp.price;
                if (tpHit) {
                    strategy[tp.key] = true;
                    const tpPnl = side === 'LONG'
                        ? (tp.price - entryPrice) / entryPrice * 100
                        : (entryPrice - tp.price) / entryPrice * 100;
                    await sendMessage(chatId,
                        `🟢 模擬盤自動出場 ${base} ${tp.label}\n` +
                        `進場 \`${formatPrice(entryPrice)}\` → 出場 \`${formatPrice(tp.price)}\`\n` +
                        `損益 +${tpPnl.toFixed(2)}% (${tp.pct} 倉位)`
                    );
                    if (tp.key === 'tp3Hit') {
                        removeFromAlert(chatId, base, side);
                        _recordExit(ctx, strategyKey, strategy, tp.price, tpPnl.toFixed(2), 'TP3 全出');
                        tpTriggered = false;
                        break;
                    }
                    tpTriggered = true;
                    break;
                }
            }
            if (tpTriggered) {
                // TP1/TP2 部分出場，更新 lastPnl 並存檔
                strategy.lastPnl = parseFloat(pnlPct || 0).toFixed(2);
                if (chatId) {
                    const uState = loadUserState(chatId);
                    if (uState.activeStrategies?.[strategyKey]) {
                        uState.activeStrategies[strategyKey] = strategy;
                        saveUserState(chatId, uState);
                    }
                }
                saveState();
                continue;
            }

            // ── 4. 超時深度虧損 ───────────────────────────────────
            const holdMs = Date.now() - (time || 0);
            const pnlNum = side === 'LONG'
                ? (curPrice - entryPrice) / entryPrice * 100
                : (entryPrice - curPrice) / entryPrice * 100;
            if (holdMs > TIMEOUT_MS && pnlNum <= -timeoutLossPct) {
                await sendMessage(chatId,
                    `⏰ 超時止損 ${base}\n` +
                    `持倉 ${Math.floor(holdMs / 3600000)}h，虧損 ${pnlNum.toFixed(2)}%\n` +
                    `進場 \`${formatPrice(entryPrice)}\` → 現價 \`${formatPrice(curPrice)}\``
                );
                removeFromAlert(chatId, base, side);
                _recordExit(ctx, strategyKey, strategy, curPrice, pnlNum.toFixed(2), '超時止損');
                continue;
            }
        }

        // ── 5. 資金費率監測（每 8 分鐘）─────────────────────────
        const now = Date.now();
        const lastFrCheck = strategy.lastFrCheck || 0;
        if (now - lastFrCheck > 8 * 60 * 1000) {
            strategy.lastFrCheck = now;
            const fr = await getFundingRate(symbol).catch(() => null);
            if (fr) {
                strategy.lastFundingRate = {
                    rate: fr.rate,
                    isExtreme: (side === 'LONG' && fr.rate > 0.001) || (side === 'SHORT' && fr.rate < -0.001),
                };
            }
        }

        // 更新 lastPnl
        strategy.lastPnl = parseFloat(pnlPct || 0).toFixed(2);
        strategy.lastPrice = price;
        strategy.lastMarkPrice = livePosition?.markPrice || livePosition?.price || livePosition?.lastPrice || strategy.lastMarkPrice || null;
        saveState();
    }

    // ── 6. 清理過期的觀察清單 (24h) ───────────────────────────
    _cleanupWatchlists();
}

/**
 * 遍歷所有用戶狀態，移除超過 24 小時的觀察標的
 */
function _cleanupWatchlists() {
    const dataDir = process.env.DATA_DIR || 'data';
    if (!fs.existsSync(dataDir)) return;

    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('state_') && f.endsWith('.json') && f !== 'state_global.json');
    const now = Date.now();
    const EXPIRE_MS = 24 * 60 * 60 * 1000;

    for (const file of files) {
        try {
            const filePath = path.join(dataDir, file);
            const raw = fs.readFileSync(filePath, 'utf-8');
            const userState = JSON.parse(raw);
            
            if (!userState.watchlist || Object.keys(userState.watchlist).length === 0) continue;

            let changed = false;
            for (const [symbol, data] of Object.entries(userState.watchlist)) {
                if (now - data.addedTime > EXPIRE_MS) {
                    delete userState.watchlist[symbol];
                    changed = true;
                    console.log(`[WATCHLIST] 自動移除過期幣種: ${symbol} (User: ${userState.chatId})`);
                }
            }

            if (changed) {
                fs.writeFileSync(filePath, JSON.stringify(userState, null, 2), 'utf-8');
            }
        } catch (e) {
            console.error(`[WATCHLIST] 清理 ${file} 失敗:`, e.message);
        }
    }
}

// ── 內部：記錄出場歷史並清除倉位 ─────────────────────────────
function _recordExit(ctx, strategyKey, strategy, exitPrice, exitPnl, reason) {
    const { botState, saveState } = ctx;
    const { symbol, side, entryPrice, chatId, leverage, principal, time, entrySnapshot, strategyType } = strategy;
    const base = symbol.replace('-USDT', '').replace('USDT', '');
    const pnlPctNum = parseFloat(exitPnl || 0);
    const positionLeverage = leverage || 75;
    const positionPrincipal = principal || 2;
    const pnlUsdt = ((pnlPctNum / 100) * positionPrincipal * positionLeverage).toFixed(3);
    
    // 記錄冷卻時間
    const fullSymbol = symbol.includes('-') ? symbol : `${symbol}-USDT`;
    closedPositionsCache.set(fullSymbol, Date.now());
    const historyEntry = {
        symbol: base, side, entryPrice, exitPrice,
        pnlPct: exitPnl, pnlUsdt,
        leverage: positionLeverage,
        principal: positionPrincipal,
        reason, time: Date.now(), chatId,
        entryTime: time || null,
        loopType: strategyType || 'loopA',
        entrySnapshot: entrySnapshot || null,
    };

    botState.history.push(historyEntry);

    // 清除 botState（記憶體）
    delete botState.activeStrategies[strategyKey];

    // 清除 userState（持久化）— 不用可選鏈，確保真的刪除
    if (chatId) {
        const uState = loadUserState(chatId);
        if (!uState.history) uState.history = [];
        uState.history.push(historyEntry);
        if (uState.activeStrategies && uState.activeStrategies[strategyKey]) {
            delete uState.activeStrategies[strategyKey];
        }
        saveUserState(chatId, uState);
    }

    saveState();
}
