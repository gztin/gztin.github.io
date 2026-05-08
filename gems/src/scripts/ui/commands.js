/**
 * 指令處理層
 * handleUpdate, handleCallbackQuery, and all command handlers
 *
 * Usage:
 *   import { createCommandHandlers } from './commands.js';
 *   const { handleUpdate, handleCallbackQuery } = createCommandHandlers({
 *     botState, sendMessage, sendPhoto, sendDocument, editMessage, deleteMessage,
 *     curl, API_BASE, DB, saveState
 *   });
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { generateCandleChart } from '../trading/chart_generator.js';
import { openOrder, closeOrder, closeAllPositions, getPositions, calcLeverage, toBingxSymbol, saveCredentials, loadCredentials, testCredentials, getFundingRate, getOpenInterest, updateStopLoss, getApiQuotaInfo } from '../trading/bingx_trader.js';
import { monitorPosition, fetchBingxTickers, fetchKlines } from '../trading/scanner.js';
import { KEYBOARDS } from './keyboards.js';
import { loadUserState, saveUserState } from '../core/state_manager.js';
import { getMultiTfAnalysis, fetchBinanceData, fetch24hTicker, fetchOIContext, formatReport, formatPrice } from '../trading/analysis.js';

// ── 幣種別名對應（用戶輸入 → 內部 symbol）────────────────────────
const SYMBOL_ALIAS = {
    'XAU':  'XAU',
    'GOLD': 'XAU',
    'BTC':  'BTC',
    'ETH':  'ETH',
    'SOL':  'SOL',
    'ADA':  'ADA',
    'DOGE': 'DOGE',
    'WLD':  'WLD',
    'OIL':  'NCCO1OILWTI2USD',
    'WTI':  'NCCO1OILWTI2USD',
};

const MAINSTREAM_TRACE_KEYWORDS = new Set(['主流', '主流幣', '主流幣種', 'MAJOR', 'MAJORS', 'MAIN']);
const MAINSTREAM_TRACE_SYMBOLS = ['BTC', 'ETH', 'XAU', 'OIL'];

function parseSymbol(input) {
    const raw = (input || '').toUpperCase().replace(/USDT$/, '').trim();
    return SYMBOL_ALIAS[raw] || raw;
}

function isMainstreamTraceRequest(input) {
    const raw = (input || '').trim().toUpperCase().replace(/\s+/g, '');
    return MAINSTREAM_TRACE_KEYWORDS.has(raw);
}

function logDebug(message) {
    const timestamp = new Date().toISOString();
    console.log(`[DEBUG] [${timestamp}] ${message}`);
}

// --- 按鈕冷卻時間（避免指令塞車）---
const buttonCooldowns = {};
function checkCooldown(chatId, cooldownMs = 5000) {
    const now = Date.now();
    if (buttonCooldowns[chatId] && now - buttonCooldowns[chatId] < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - (now - buttonCooldowns[chatId])) / 1000);
        return remaining;
    }
    buttonCooldowns[chatId] = now;
    return 0;
}

const timeoutOrNull = (p, ms = 5000) => Promise.race([
    Promise.resolve(p).catch(() => null),
    new Promise(r => setTimeout(() => r(null), ms)),
]);

function getUserActiveStrategyEntries(botState, chatId) {
    return Object.entries(botState.activeStrategies || {}).filter(([, st]) =>
        String(st.chatId) === String(chatId) && !st.hidden
    );
}

function formatPositionLine(symbol, side, roe, pnlUsdt) {
    const sideLabel = side === 'LONG' ? '做多' : '做空';
    const good = Number(roe) >= 0;
    const emoji = good ? '🟢' : '🔴';
    const status = good ? '獲利' : '虧損';
    const roeText = `${roe >= 0 ? '' : '-'}${Math.abs(roe).toFixed(1)}%`;
    const pnlText = `${pnlUsdt >= 0 ? '' : '-'}${Math.abs(pnlUsdt).toFixed(2)}U`;
    return `- ${symbol} (${sideLabel}) ${emoji} ${status}: ${roeText} (${pnlText})`;
}

/**
 * Factory: creates handleUpdate and handleCallbackQuery bound to the given context.
 * @param {object} ctx - { botState, sendMessage, sendPhoto, sendDocument, editMessage, deleteMessage, curl, API_BASE, DB, saveState }
 */
export function createCommandHandlers(ctx) {
    const { botState, sendMessage, sendPhoto, sendDocument, editMessage, deleteMessage, curl, API_BASE, DB, saveState } = ctx;

    async function handleUpdate(update, _internal = false) {
        try {
            console.log(`[SYS] Processing update: ${JSON.stringify(update)}`);
            if (!update.message || !update.message.text) return;
            const chatId = String(update.message.chat.id);
    
            // 群組訊息一律忽略（只接受私人對話）
            const chatType = update.message.chat.type;
            if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') {
                // 直接忽略群組訊息，不發送任何回應避免影響鍵盤狀態
                return;
            }
    
            let rawText = update.message.text.trim().normalize('NFC').replace(/\s+/g, ' ');
            // Debug: log hex of received text to diagnose invisible char issues
            console.log(`[BOT] RAW hex: ${Buffer.from(update.message.text).toString('hex').substring(0, 80)}`);
    
            // --- Button to Command Mapper ---
            const btnMap = {
                // 第一層：主選單
                '📊 幣種分析':          '/CHECK',
                '🔭 幣種追蹤':          '/TRACE',
                '📋 追蹤列表':          '/LIST',
                '📈 排行榜':            '/RANK',
                '❌ 清空觀察名單':      '/CLEAN',
                '📜 版本資訊':          '/VERSION',
                '⚙️ 進階操作':          '/TOOLS',
                // 第二層：工具選單
                '🎮 模擬交易':          '/SIMTRADE',
                '🛡️ 管理者功能':        '/ADMIN',
                '🤖 設定BOT資料':        '/BOT_SETTINGS',
                '⬅️ 返回主選單':        '/MAIN',
                // 第三層：模擬交易選單
                '🟢 串接 API（運作中）': '/SETAPI',
                '🔴 串接 API（無資料）': '/SETAPI',
                '🟢 模擬倉（已連線）':   '/PAPER_DISCONNECT',
                '🔴 連結模擬倉':         '/PAPER_CONNECT',
                '📶 API 額度查詢':       '/API_QUOTA',
                '📤 數據匯出':           '/EXPORT',
                '📊 持倉資訊':           '/POSITIONS',
                '🧹 清除紀錄':           '/PRUNE',
                '⬅️ 返回工具選單':       '/TOOLS',
                '🆔 設定 Channel ID':    '/SET_CHANNEL_ID',
                '⬅️ 返回管理者功能':     '/ADMIN',
                '🟢 串接模擬倉（已連線）': '/PAPER_DISCONNECT',
                '🔴 串接模擬倉（未連線）': '/PAPER_CONNECT',
                '🟢 串接API（已設定）':   '/SETAPI',
                '🔴 串接API（未設定）':   '/SETAPI',
                '🟢 連線倉位（開啟）':    '/POSITION_CONNECT_OFF',
                '⚪ 連線倉位（關閉）':    '/POSITION_CONNECT_ON',
                // 第三層：管理員選單
                '🔐 帳號登入':           '/LOGIN',
                '➕ 新增白名單':         '/ADDUID',
                '➖ 移除白名單':         '/DELUID',
                '📋 查看白名單':         '/LISTUID',
                '/SIMTRADE': '/SIMTRADE',
                '/SETAPI': '/SETAPI',
                '/PAPER_CONNECT': '/PAPER_CONNECT',
                '/PAPER_DISCONNECT': '/PAPER_DISCONNECT',
            };
    
    
    
    
            // Normalize btnMap keys to handle Telegram's auto-spacing, zero-width chars, variation selectors
            // Strip ALL non-visible characters: whitespace, zero-width space (U+200B), variation selectors (U+FE0F), etc.
            const stripInvisible = (s) => s.normalize('NFC').replace(/[\s\u200B\u200C\u200D\uFEFF\uFE0F\uFE0E]/g, '');
            const normalizedBtnMap = {};
            for (const [k, v] of Object.entries(btnMap)) {
                normalizedBtnMap[stripInvisible(k)] = v;
            }
    
            const normalizedRaw = stripInvisible(rawText);
            // Exact match first, then fallback: check if any btnMap key is contained in the raw text
            let isButtonInput = !!normalizedBtnMap[normalizedRaw];
            if (isButtonInput) {
                rawText = normalizedBtnMap[normalizedRaw];
            } else {
                // Fallback: find a btnMap key whose stripped version is a substring of stripped raw
                for (const [k, v] of Object.entries(btnMap)) {
                    if (normalizedRaw.includes(stripInvisible(k)) || stripInvisible(k).includes(normalizedRaw)) {
                        rawText = v;
                        isButtonInput = true;
                        console.log(`[BOT] Fuzzy button match: "${rawText}" -> "${v}"`);
                        break;
                    }
                }
            }
    
            console.log(`[BOT] Received message: "${rawText}" from ${chatId} | isButtonInput: ${isButtonInput}`);

            // Fallback: keyboard text may be mojibake; handle simulated account toggle by keyword.
            if (!rawText.startsWith('/') && rawText.includes('模擬倉') && botState.admins.includes(chatId)) {
                const userState = loadUserState(chatId);
                userState.credentials = userState.credentials || {};
                const currentlyEnabled = !!userState.credentials.paperEnabled;
                userState.credentials.paperEnabled = !currentlyEnabled;
                saveUserState(chatId, userState);
                const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                if (userState.credentials.paperEnabled) {
                    return sendMessage(chatId, `🟢 **模擬倉已連線**\n模擬交易功能已啟用。`, { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(hasApiKey, true) });
                }
                return sendMessage(chatId, `🔴 **模擬倉已斷線**\n模擬交易功能已停用。`, { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(hasApiKey, false) });
            }
    
            // --- Conversational State: Unified Waiting State ---
            // Must be checked BEFORE the button-only interceptor so user can type data when prompted
            if (botState.waitingState[chatId]) {
                const state = botState.waitingState[chatId];
    
                // 如果是按鈕觸發的新指令（非文字輸入），先詢問是否中止目前等待
                if (isButtonInput && rawText.startsWith('/')) {
                    // 確認中的狀態：用戶已按「確認中止」或「繼續」
                    if (state.type === 'CONFIRM_CANCEL') {
                        // 這裡不處理，讓下方 /CONFIRM_CANCEL 指令處理
                    } else {
                        // 儲存用戶想切換的目標指令
                        botState.waitingState[chatId] = {
                            ...state,
                            pendingSwitch: rawText,
                            type: 'CONFIRM_CANCEL',
                            originalType: state.type,
                        };
                        saveState();
                        const typeLabel = {
                            TRACE: '追蹤幣種', CHECK: '分析幣種', UNTRACE: '取消追蹤',
                            LOGIN: '帳號登入', ADDUID: '新增白名單', DELUID: '移除白名單',
                            SETAPI_KEY: '設定 API Key', SETAPI_SECRET: '設定 API Secret',
                        }[state.type] || state.type;
                        return sendMessage(chatId, `⚠️ 您正在進行「${typeLabel}」，尚未完成輸入。\n\n要中止並切換到新操作嗎？`, {
                            replyMarkup: {
                                inline_keyboard: [[
                                    { text: '✅ 確認中止', callback_data: 'confirm_cancel_yes' },
                                    { text: '❌ 繼續原操作', callback_data: 'confirm_cancel_no' },
                                ]]
                            }
                        });
                    }
                }
    
                if (!rawText.startsWith('/')) {
                // Symbol input (TRACE / CHECK)
                if (state.type === 'TRACE' || state.type === 'CHECK') {
                    const cmd = state.type === 'TRACE' ? '/TRACE' : '/CHECK';
                    delete botState.waitingState[chatId];
                    saveState();
                    return handleUpdate({ message: { chat: { id: chatId }, text: `${cmd} ${rawText}` } }, true);
                }
    
                // Symbol input (UNTRACE)
                if (state.type === 'UNTRACE') {
                    const symbol = parseSymbol(rawText);
                    delete botState.waitingState[chatId];
                    saveState();
                    const subs = botState.subscriptions[chatId] || [];
                    if (!subs.includes(symbol)) {
                        return sendMessage(chatId, `⚠️ *${symbol}* 不在您的追蹤名單中。\n\n目前追蹤：${subs.length > 0 ? subs.map(s => `\`${s}\``).join('、') : '（空）'}`);
                    }
                    botState.subscriptions[chatId] = subs.filter(s => s !== symbol);
                    const strategyKey = `${chatId}_${symbol}`;
                    if (botState.activeStrategies[strategyKey]) delete botState.activeStrategies[strategyKey];
                    saveState();
                    // 持久化訂閱到用戶狀態檔
                    const uStateUntrace = loadUserState(chatId);
                    uStateUntrace.subscriptions = botState.subscriptions[chatId];
                    saveUserState(chatId, uStateUntrace);
                    return sendMessage(chatId, `✅ 已取消追蹤：*${symbol}/USDT*\n\n剩餘追蹤：${botState.subscriptions[chatId].length > 0 ? botState.subscriptions[chatId].map(s => `\`${s}\``).join('、') : '（空）'}`);
                }
    
                // UID input (LOGIN / ADDUID / DELUID)
                if (state.type === 'LOGIN' || state.type === 'ADDUID' || state.type === 'DELUID') {
                    if (/^\d{5,12}$/.test(rawText)) {
                        const cmd = state.type === 'LOGIN' ? '/LOGIN' : (state.type === 'ADDUID' ? '/ADDUID' : '/DELUID');
                        delete botState.waitingState[chatId];
                        saveState();
                        return handleUpdate({ message: { chat: { id: chatId }, text: `${cmd} ${rawText}` } }, true);
                    } else {
                        const actionName = state.type === 'LOGIN' ? '登入' : '操作';
                        return sendMessage(chatId, `⚠️ 請輸入正確的 UID 格式（純數字）。\n若要取消${actionName}，請點擊下方的「⬅️ 返回主選單」。`);
                    }
                }
    
                // API Key 輸入 - 第一階段
                if (state.type === 'SETAPI_KEY') {
                    const apiKey = rawText.trim();
                    if (!apiKey || apiKey.length < 10) {
                        return sendMessage(chatId, `❌ API Key 格式不正確，請重新輸入。`);
                    }
                    botState.waitingState[chatId] = { type: 'SETAPI_SECRET', apiKey };
                    saveState();
                    return sendMessage(chatId, `✅ 已收到 API Key\n\n請輸入您的 **API Secret**：`);
                }
    
                // API Secret 輸入 - 第二階段，驗證並儲存
                if (state.type === 'SETAPI_SECRET') {
                    const apiSecret = rawText.trim();
                    const apiKey = state.apiKey;
                    delete botState.waitingState[chatId];
                    saveState();
                    if (!apiSecret || apiSecret.length < 10) {
                        return sendMessage(chatId, `❌ API Secret 格式不正確，請重新執行 /SETAPI。`);
                    }
                    await sendMessage(chatId, `⏳ 驗證 API Key 中...`);
                    const result = await testCredentials(apiKey, apiSecret);
                    if (result.ok) {
                        const userState = loadUserState(chatId);
                        userState.credentials.apiKey = apiKey;
                        userState.credentials.apiSecret = apiSecret;
                        saveUserState(chatId, userState);
                        const hasPaperConn = !!userState.credentials?.paperEnabled;
                        await sendMessage(chatId, `✅ API Key 驗證成功！\n帳戶餘額：\`${parseFloat(result.balance).toFixed(2)} USDT\`\n\nAPI 已儲存，後續開單將使用此 Key。`);
                        return sendMessage(chatId, '🎮 **模擬交易**', { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(true, hasPaperConn) });
                    } else {
                        return sendMessage(chatId, `❌ 沒有回應，請重新輸入正確的 API Key 資料。`);
                    }
                }

                if (state.type === 'SET_CHANNEL_ID') {
                    const channelId = rawText.trim();
                    if (channelId && !/^-?\d+$/.test(channelId)) {
                        return sendMessage(chatId, `❌ Channel ID 格式不正確，請輸入純數字（可含負號）。`);
                    }
                    const userState = loadUserState(chatId);
                    userState.botSettings = userState.botSettings || {};
                    userState.botSettings.channelId = channelId || '';
                    delete botState.waitingState[chatId];
                    saveState();
                    saveUserState(chatId, userState);
                    const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                    const hasPaperConn = !!userState.credentials?.paperEnabled;
                    const hasPositionConn = !!userState.botSettings?.positionConnected;
                    return sendMessage(chatId, `✅ Channel ID 已更新：\`${channelId || '(空白)'}\``, {
                        replyMarkup: KEYBOARDS.BOT_SETTINGS_INLINE(hasApiKey, hasPaperConn, hasPositionConn)
                    });
                }
    
                // 確認清空監控（輸入 clean）
                if (state.type === 'CONFIRM_CLEAN') {
                    delete botState.waitingState[chatId];
                    if (rawText.trim().toLowerCase() === 'clean') {
                        const subCount = (botState.subscriptions[chatId] || []).length;
                        botState.subscriptions[chatId] = [];
                        // 持久化訂閱到用戶狀態檔
                        const uStateConfirmClean = loadUserState(chatId);
                        uStateConfirmClean.subscriptions = [];
                        saveUserState(chatId, uStateConfirmClean);
                        let strategyCount = 0, closedCount = 0;
                        const failedSymbols = [];
                        const cred = loadCredentials();
                        const hasApi = !!(cred.apiKey && cred.apiSecret);
                        for (const [s, st] of Object.entries(botState.activeStrategies)) {
                            if (String(st.chatId) === chatId) {
                                if (hasApi && st.symbol) {
                                    try {
                                        const sym = st.symbol.includes('-') ? st.symbol : `${st.symbol}-USDT`;
                                        if (st.bingxQty) {
                                            await closeOrder({ symbol: sym, side: st.side, qty: st.bingxQty });
                                            closedCount++;
                                        } else {
                                            const positions = await getPositions(sym);
                                            const pos = positions.find(p => {
                                                const ps = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
                                                return ps === st.side;
                                            });
                                            if (pos) { await closeOrder({ symbol: sym, side: st.side, qty: Math.abs(parseFloat(pos.positionAmt)) }); closedCount++; }
                                        }
                                    } catch (e) { failedSymbols.push(st.symbol); }
                                }
                                delete botState.activeStrategies[s];
                                strategyCount++;
                            }
                        }
                        saveState();
                        let resultMsg = `⚡ **閃電平倉完成**\n已移除 ${subCount} 個偵測項目與 ${strategyCount} 個部位。`;
                        if (hasApi) {
                            resultMsg += `\n平倉：${closedCount} 筆成功`;
                            if (failedSymbols.length > 0) resultMsg += `，${failedSymbols.length} 筆失敗（${failedSymbols.join(', ')}）`;
                        } else {
                            resultMsg += `\n⚠️ 未設定 API Key，請手動平倉。`;
                        }
                        return sendMessage(chatId, resultMsg, { replyMarkup: KEYBOARDS.MAIN_INLINE(botState.admins.includes(chatId)) });
                    } else {
                        saveState();
                        return sendMessage(chatId, `❌ 已取消清空監控。`, { replyMarkup: KEYBOARDS.MAIN_INLINE(botState.admins.includes(chatId)) });
                    }
                }
                } // end !rawText.startsWith('/')
            }
    
            // --- 指令全面按鈕化：非按鈕來源的 / 指令一律導回主選單 ---
            // 允許例外：/START、/HELP、/MAIN（系統入口）以及內部遞迴呼叫
            const ALLOWED_TEXT_COMMANDS = ['/START', '/HELP', '/HELPE', '/MAIN'];
            if (!_internal && rawText.startsWith('/') && !isButtonInput && !ALLOWED_TEXT_COMMANDS.includes(rawText.split(/\s+/)[0].toUpperCase())) {
                const isAdm = botState.admins.includes(chatId);
                return sendMessage(chatId, `🤖 請使用下方按鈕操作`, { replyMarkup: KEYBOARDS.MAIN_INLINE(isAdm) });
            }
            const parts = rawText.split(/\s+/);
            const command = parts[0].toUpperCase();
            console.log(`[BOT] command="${command}" isButtonInput=${isButtonInput}`);
    
            if (command === '/START' || command === '/HELP' || command === '/HELPE' || command === '/MAIN') {
                delete botState.waitingState[chatId]; // Clear any waiting state when returning to main
                const isAdmin = botState.admins.includes(chatId);
                let msg = `🤖 **AI 交易策略機器人 - 功能選單**\n` +
                    `━━━━━━━━━━━━━\n\n` +
                    `請點擊下方按鈕開始操作：\n\n` +
                    `📊 **幣種分析**：立即分析指定幣種\n` +
                    `🔭 **幣種追蹤**：開始追蹤幣種\n` +
                    `📋 **追蹤列表**：查看目前持倉與追蹤\n` +
                    `📈 **排行榜**：查看漲幅排行\n` +
                    `⚙️ **進階操作**：歷史戰績、設定等功能\n`;
                
                // 強制重新發送鍵盤，確保按鈕顯示
                return sendMessage(chatId, msg, { 
                    replyMarkup: KEYBOARDS.MAIN_INLINE(isAdmin)
                });
            }
    
            if (command === '/TOOLS') {
                const isAdmin = botState.admins.includes(chatId);
                return sendMessage(chatId, '⚙️ **進階操作**\n請選擇功能：', { replyMarkup: KEYBOARDS.TOOLS_INLINE() });
            }

            if (command === '/SIMTRADE') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                const hasApiKey   = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                const hasPaperConn = !!userState.credentials?.paperEnabled;
                return sendMessage(chatId, '🎮 **模擬交易**\n管理 API 連線與模擬倉設定：', { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(hasApiKey, hasPaperConn) });
            }

            if (command === '/ADMIN') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                return sendMessage(chatId, '🛡️ **管理者功能**\n請選擇操作：', { replyMarkup: KEYBOARDS.ADMIN_INLINE() });
            }

            if (command === '/BOT_SETTINGS') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                const hasPaperConn = !!userState.credentials?.paperEnabled;
                const hasPositionConn = !!userState.botSettings?.positionConnected;
                const channelId = userState.botSettings?.channelId || '';
                return sendMessage(chatId,
                    `🤖 **BOT資料設定**\n\n` +
                    `Channel ID：\`${channelId || '(空白)'}\`\n` +
                    `連線倉位：${hasPositionConn ? '開啟' : '關閉'}`,
                    { replyMarkup: KEYBOARDS.BOT_SETTINGS_INLINE(hasApiKey, hasPaperConn, hasPositionConn) }
                );
            }

            if (command === '/SET_CHANNEL_ID') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                botState.waitingState[chatId] = { type: 'SET_CHANNEL_ID' };
                saveState();
                return sendMessage(chatId, `🆔 請輸入發送訊息的 Channel ID（留空代表清除）。`);
            }

            if (command === '/POSITION_CONNECT_ON' || command === '/POSITION_CONNECT_OFF') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                userState.botSettings = userState.botSettings || {};
                userState.botSettings.positionConnected = command === '/POSITION_CONNECT_ON';
                saveUserState(chatId, userState);
                const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                const hasPaperConn = !!userState.credentials?.paperEnabled;
                const hasPositionConn = !!userState.botSettings?.positionConnected;
                return sendMessage(chatId,
                    hasPositionConn ? `🟢 連線倉位已開啟` : `⚪ 連線倉位已關閉`,
                    { replyMarkup: KEYBOARDS.BOT_SETTINGS_INLINE(hasApiKey, hasPaperConn, hasPositionConn) }
                );
            }
    
            if (command === '/SETAPI') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                const cred = userState.credentials;
                const hasKey = !!(cred.apiKey && cred.apiSecret);
                const statusLine = hasKey
                    ? `目前狀態：🟢 已設定（Key: \`...${cred.apiKey.slice(-6)}\`）`
                    : `目前狀態：🔴 未設定`;
                botState.waitingState[chatId] = { type: 'SETAPI_KEY' };
                saveState();
                return sendMessage(chatId,
                    `🔑 **設定 BingX API Key**\n\n${statusLine}\n\n⚠️ Key 將儲存在本機，不會上傳任何伺服器。\n\n請輸入您的 **API Key**：`
                );
            }

            if (command === '/API_QUOTA') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                const cred = userState.credentials || {};
                if (!cred.apiKey || !cred.apiSecret) {
                    return sendMessage(chatId, `❌ 尚未設定 BingX API Key，請先使用「串接 API」完成設定。`, {
                        replyMarkup: KEYBOARDS.SIMTRADE_INLINE(false, !!cred.paperEnabled),
                    });
                }

                await sendMessage(chatId, `⏳ 查詢 BingX API 額度中...`);
                const quota = await getApiQuotaInfo(cred.apiKey, cred.apiSecret);
                if (!quota.ok) {
                    return sendMessage(chatId, `❌ API 額度查詢失敗：${quota.msg || '未知錯誤'}`);
                }

                const balanceNum = Number.parseFloat(quota.balance || '0');
                const availableNum = Number.parseFloat(quota.availableMargin || '0');
                const frozenNum = Number.parseFloat(quota.frozenMargin || '0');
                const headerLines = Array.isArray(quota.rateHeaders) && quota.rateHeaders.length > 0
                    ? quota.rateHeaders.map(({ key, value }) => `- \`${key}\`: \`${value}\``).join('\n')
                    : '（BingX 本次回應未提供剩餘額度 header）';

                const limitLines = [
                    `- 行情類共用 IP：${quota.staticLimits.marketSharedIp}`,
                    `- 帳戶類總 IP：${quota.staticLimits.accountTotalIp}`,
                    `- 餘額查詢：${quota.staticLimits.balance}`,
                    `- 持倉查詢：${quota.staticLimits.positions}`,
                    `- 下單：${quota.staticLimits.order}`,
                ].join('\n');

                return sendMessage(
                    chatId,
                    `📶 **BingX API 額度查詢**\n\n` +
                    `帳戶餘額：\`${Number.isFinite(balanceNum) ? balanceNum.toFixed(2) : quota.balance} USDT\`\n` +
                    `可用保證金：\`${Number.isFinite(availableNum) ? availableNum.toFixed(2) : (quota.availableMargin ?? 'N/A')} USDT\`\n` +
                    `凍結保證金：\`${Number.isFinite(frozenNum) ? frozenNum.toFixed(2) : (quota.frozenMargin ?? 'N/A')} USDT\`\n\n` +
                    `**目前可讀到的限頻 Header**\n${headerLines}\n\n` +
                    `**BingX 常用額度上限**\n${limitLines}`
                );
            }

            if (command === '/PAPER_CONNECT') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                userState.credentials = userState.credentials || {};
                userState.credentials.paperEnabled = true;
                saveUserState(chatId, userState);
                const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                return sendMessage(chatId, `🟢 **模擬倉已連線**\n模擬交易功能已啟用。`, { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(hasApiKey, true) });
            }

            if (command === '/PAPER_DISCONNECT') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const userState = loadUserState(chatId);
                userState.credentials = userState.credentials || {};
                userState.credentials.paperEnabled = false;
                saveUserState(chatId, userState);
                const hasApiKey = !!(userState.credentials?.apiKey && userState.credentials?.apiSecret);
                return sendMessage(chatId, `🔴 **模擬倉已斷線**\n模擬交易功能已停用。`, { replyMarkup: KEYBOARDS.SIMTRADE_INLINE(hasApiKey, false) });
            }
    
            // --- Auth Guard 已移除，所有用戶可直接使用 ---
            const isAdmin = botState.admins.includes(chatId);
            const isVerified = true; // Auth guard 已移除，所有用戶視為已驗證
    
            if (command === '/RANK') {
                try {
                    const topN = parseInt(parts[1]) || 20;
                    const tickers = await fetchBingxTickers();
                    const rankStr = tickers
                        .sort((a, b) => (b.volVelocity || 0) - (a.volVelocity || 0))
                        .slice(0, topN)
                        .map((t, i) => `${i + 1}. \`${t.base}\` (+${t.change.toFixed(2)}%)`)
                        .join('\n');
                    return sendMessage(chatId, `📈 **BingX 活躍榜 Top ${topN}**\n(依成交量突增排序)\n\n${rankStr}`);
                } catch (e) {
                    return sendMessage(chatId, '❌ 無法取得排行榜資料');
                }
            }

            // ── /LIST: 顯示追蹤列表 ─────────────────────────────────────
            if (command === '/LIST') {
                const userState = loadUserState(chatId);
                const tickers = await fetchBingxTickers();
                const msg = await formatWatchlistMessage(userState, tickers);
                return sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            }

            // ── /CLEAN: 清空觀察清單 ────────────────────────────────────
            if (command === '/CLEAN') {
                const userState = loadUserState(chatId);
                userState.watchlist = {};
                saveUserState(chatId, userState);
                return sendMessage(chatId, '✅ 已清空性能觀察名單（主流幣行情仍會保留在列表底部）。');
            }
    
            if (command === '/VERSION') {
                const changelogPath = path.join(process.cwd(), 'BOT_CHANGELOG.md');
                if (fs.existsSync(changelogPath)) {
                    const content = fs.readFileSync(changelogPath, 'utf8');
                    const lastVersion = getLatestVersion();
                    const sections = content.split('## [');
                    let bodyText = '';
                    if (sections.length > 1) {
                        const latest = sections[1];
                        const [versionHeader, ...body] = latest.split('\n');
                        bodyText = body.join('\n').split('---')[0].trim();
                    }
                    const versionInfo = `🤖 機器人版本資訊\n目前運行版本: ${lastVersion}\n環境狀態: ${ENV_LABEL}\n\n${bodyText}`.slice(0, 4000);
                    // 用純文字模式發送，避免 Markdown 解析錯誤
                    const taggedText = `${ENV_LABEL}\n${versionInfo}`;
                    await curl(`${API_BASE}/sendMessage`, {
                        method: 'POST',
                        body: JSON.stringify({ chat_id: chatId, text: taggedText }),
                    });
                    return;
                }
                return sendMessage(chatId, `版本 ${BOT_VERSION} (無法讀取詳細改版資訊)`);
            }
    
            if (command === '/UNTRACE_PROMPT') {
                const remaining = checkCooldown(chatId);
                if (remaining > 0) return sendMessage(chatId, `⏳ 請稍候 ${remaining} 秒再操作。`);
                const subs = botState.subscriptions[chatId] || [];
                if (subs.length === 0) return sendMessage(chatId, '⚠️ 您目前沒有任何追蹤中的幣種。');
                botState.waitingState[chatId] = { type: 'UNTRACE' };
                saveState();
                return sendMessage(chatId, `❌ *取消追蹤*\n\n目前追蹤：${subs.map(s => `\`${s}\``).join('、')}\n\n請輸入要取消的幣種名稱（例如：\`BTC\`）：`);
            }
    
            if (command === '/UNTRACE') {
                const symbol = parseSymbol(parts[1]);
                if (!symbol) return sendMessage(chatId, '❌ 請輸入要取消監控的幣種\n範例：`/untrace BTC`');
                if (botState.subscriptions[chatId]) {
                    botState.subscriptions[chatId] = botState.subscriptions[chatId].filter(s => s !== symbol);
                }
                const strategyKey = `${chatId}_${symbol}`;
                if (botState.activeStrategies[strategyKey]) {
                    delete botState.activeStrategies[strategyKey];
                }
                saveState();
                return sendMessage(chatId, `✅ 已取消監控: ${symbol}/USDT`);
            }
    
            if (command === '/CLEAN') {
                const activeCount = Object.values(botState.activeStrategies).filter(st => String(st.chatId) === chatId).length;
                if (activeCount === 0) {
                    botState.subscriptions[chatId] = [];
                    saveState();
                    // 持久化訂閱到用戶狀態檔
                    const uStateClean = loadUserState(chatId);
                    uStateClean.subscriptions = [];
                    saveUserState(chatId, uStateClean);
                    return sendMessage(chatId, `✨ 列表已清空，目前無持倉。`);
                }
                // 有持倉時，先詢問確認
                botState.waitingState[chatId] = { type: 'CONFIRM_CLEAN' };
                saveState();
                return sendMessage(chatId,
                    `⚠️ **確認清空監控**\n\n` +
                    `目前有 **${activeCount}** 個持倉中部位。\n` +
                    `清空監控將同時**閃電平倉所有倉位**。\n\n` +
                    `確認請輸入：\`clean\`\n取消請按其他按鈕。`
                );
            }
    
            // --- User Login (Whitelist) ---
            if (command === '/LOGIN') {
                const uid = parts[1];
                if (!uid) {
                    botState.waitingState[chatId] = { type: 'LOGIN' };
                    saveState();
                    return sendMessage(chatId, '🔐 **帳號登入程序**\n\n請直接在對話框輸入您的 **交易所 UID**：\n(純數字，例如: `32075535`)');
                }
                if (botState.verifiedUsers[chatId] && botState.verifiedUsers[chatId].uid === uid) {
                    delete botState.waitingState[chatId];
                    saveState();
                    return sendMessage(chatId, `✅ 您已登入 (UID: \`${uid}\`)`);
                }
                if (!botState.whitelist.includes(uid) && !botState.admins.includes(chatId)) return sendMessage(chatId, `❌ 此 UID 未被授權\n請聯繫管理員開通白名單。`);
                botState.verifiedUsers[chatId] = { uid, verifiedAt: Date.now() };
                delete botState.waitingState[chatId];
                saveState();
                return sendMessage(chatId, `🎉 **歡迎使用 AI 交易策略機器人！**\n\n` +
                    `UID: \`${uid}\` 登入成功\n\n` +
                    `請使用下方按鈕開始操作 👇`, { replyMarkup: KEYBOARDS.MAIN_INLINE(true) });
            }
    
            // --- Admin Commands ---
            if (command === '/ADDUID') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, '❌ 無權限');
                const uid = parts[1];
                if (!uid) {
                    botState.waitingState[chatId] = { type: 'ADDUID' };
                    saveState();
                    return sendMessage(chatId, '➕ **新增白名單 UID**\n\n請直接在對話框輸入要授權的 **UID**：\n(純數字，例如: `12345678`)');
                }
                if (botState.whitelist.includes(uid)) return sendMessage(chatId, `⚠️ UID \`${uid}\` 已在白名單中`);
                botState.whitelist.push(uid);
                delete botState.waitingState[chatId];
                saveState();
                return sendMessage(chatId, `✅ 已新增白名單: \`${uid}\`\n目前共 ${botState.whitelist.length} 個 UID`);
            }
    
            if (command === '/DELUID') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, '❌ 無權限');
                const uid = parts[1];
                if (!uid) {
                    botState.waitingState[chatId] = { type: 'DELUID' };
                    saveState();
                    return sendMessage(chatId, '➖ **移除白名單 UID**\n\n請直接在對話框輸入要移除的 **UID**：\n(例如: `12345678`)');
                }
                botState.whitelist = botState.whitelist.filter(u => u !== uid);
                // Also remove any verified user with this UID
                for (const [cid, v] of Object.entries(botState.verifiedUsers)) {
                    if (v.uid === uid) delete botState.verifiedUsers[cid];
                }
                delete botState.waitingState[chatId];
                saveState();
                return sendMessage(chatId, `✅ 已移除白名單: \`${uid}\``);
            }
    
            if (command === '/LISTUID') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, '❌ 無權限');
                if (botState.whitelist.length === 0) return sendMessage(chatId, '📋 目前白名單沒有資料');
                let msg = `📋 **白名單 (${botState.whitelist.length})**\n\n`;
                for (const uid of botState.whitelist) {
                    const verified = Object.entries(botState.verifiedUsers).find(([_, v]) => v.uid === uid);
                    msg += `- \`${uid}\` ${verified ? '✅ 已登入' : '⏳ 待登入'}\n`;
                }
                return sendMessage(chatId, msg);
            }
    

            if (command === '/POSITIONS') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, '❌ 無權限');

                const strategyEntries = getUserActiveStrategyEntries(botState, chatId);
                const strategyLines = await Promise.all(strategyEntries.map(async ([, st]) => {
                    const symbol = st.symbol?.includes('-') ? st.symbol : `${st.symbol}-USDT`;
                    const base = symbol.replace('-USDT', '').replace('USDT', '');
                    const monitor = await timeoutOrNull(monitorPosition(base, st.side, st.entryPrice));
                    const price = monitor?.price || st.lastPrice || st.entryPrice;
                    const pnlPct = st.side === 'LONG'
                        ? (price - st.entryPrice) / st.entryPrice
                        : (st.entryPrice - price) / st.entryPrice;
                    const leverage = st.leverage || 75;
                    const principal = st.principal || 3;
                    const posRatio = st.positionRatio ?? 1;
                    const roe = pnlPct * leverage * 100;
                    const pnlUsdt = pnlPct * leverage * principal * posRatio;
                    return formatPositionLine(symbol, st.side, roe, pnlUsdt);
                }));

                const strategySymbols = new Set(strategyEntries.map(([, st]) =>
                    (st.symbol?.includes('-') ? st.symbol : `${st.symbol}-USDT`).replace('USDT-USDT', 'USDT')
                ));

                const exchangePositions = await getPositions().catch(() => []);
                const exchangeLines = (exchangePositions || [])
                    .filter(p => !strategySymbols.has(p.symbol))
                    .map(p => {
                        const side = p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
                        const qty = Math.abs(parseFloat(p.positionAmt || 0));
                        const entry = parseFloat(p.entryPrice || p.avgPrice || 0);
                        const pnlUsdt = parseFloat(p.unrealizedProfit || 0);
                        const lev = parseFloat(p.leverage || 1);
                        const margin = entry > 0 && qty > 0 && lev > 0 ? (entry * qty / lev) : 0;
                        const roe = margin > 0 ? (pnlUsdt / margin * 100) : 0;
                        return formatPositionLine(p.symbol, side, roe, pnlUsdt);
                    });

                const lines = [...strategyLines, ...exchangeLines];
                if (!lines.length) {
                    return sendMessage(chatId, '📭 執行中部位 (Positions)\n------------------------------\n目前沒有持倉。');
                }

                const msg = `🚀 執行中部位 (Positions)\n------------------------------\n${lines.join('\n')}`;

                return sendMessage(chatId, msg);
            }
    
            // --- Auth Guard: Whitelist check ---
            // isAdmin / isVerified 已在上方宣告，此處不重複宣告
            if (!isAdmin && !isVerified) {
                return sendMessage(chatId,
                    `🔒 **請先登入**\n\n` +
                    `請點擊下方「🔐 帳號登入」按鈕，輸入您的交易所 UID 完成驗證。`,
                    { replyMarkup: KEYBOARDS.TOOLS_INLINE() }
                );
            }
    
            if (command === '/TRACE') {
                if (isMainstreamTraceRequest(parts[1])) {
                    if (!botState.subscriptions[chatId]) botState.subscriptions[chatId] = [];
                    const added = [];
                    const already = [];
                    const failed = [];
                    const uState = loadUserState(chatId);
                    uState.watchlist = uState.watchlist || {};

                    for (const label of MAINSTREAM_TRACE_SYMBOLS) {
                        const symbol = parseSymbol(label);
                        try {
                            const ticker = await fetch24hTicker(symbol);
                            if (!ticker) {
                                failed.push(label);
                                continue;
                            }

                            if (botState.subscriptions[chatId].includes(symbol)) {
                                already.push(label);
                            } else {
                                botState.subscriptions[chatId].push(symbol);
                                added.push(label);
                            }

                            const watchKey = `${symbol}-USDT`;
                            if (!uState.watchlist[watchKey]) {
                                uState.watchlist[watchKey] = {
                                    symbol: watchKey,
                                    entryPrice: ticker.price,
                                    starCount: 1,
                                    addedAt: Date.now(),
                                    source: 'mainstream_trace',
                                };
                            }
                        } catch (err) {
                            console.error(`[TRACE] failed to add mainstream symbol ${label}:`, err.message);
                            failed.push(label);
                        }
                    }

                    uState.subscriptions = botState.subscriptions[chatId];
                    saveUserState(chatId, uState);
                    saveState();

                    let msg = `✅ 已加入主流幣追蹤：${MAINSTREAM_TRACE_SYMBOLS.map(s => `\`${s}\``).join('、')}`;
                    if (already.length) msg += `\n\n已在清單中：${already.map(s => `\`${s}\``).join('、')}`;
                    if (failed.length) msg += `\n\n⚠️ 查價失敗，稍後可再試：${failed.map(s => `\`${s}\``).join('、')}`;
                    return sendMessage(chatId, msg);
                }

                const symbol = parseSymbol(parts[1]);
                if (!symbol) {
                    botState.waitingState[chatId] = { type: 'TRACE' };
                    saveState();
                    return sendMessage(chatId, '🔭 **請輸入您想追蹤的幣種名稱**\n例如直接輸入：`BTC` 或 `ETH`');
                }
                if (!botState.subscriptions[chatId]) botState.subscriptions[chatId] = [];
                if (!botState.subscriptions[chatId].includes(symbol)) {
                    // Validate symbol exists before adding
                    const testData = await fetchBinanceData(symbol, '1h');
                    if (!testData) {
                        return sendMessage(chatId, `❌ 找不到幣種 **${symbol}** 的資料\n請確認幣種名稱是否正確（例如：\`BTC\`、\`ETH\`、\`SOL\`）`);
                    }
                    botState.subscriptions[chatId].push(symbol);
                    saveState();
                    // 持久化訂閱到用戶狀態檔
                    const uState = loadUserState(chatId);
                    uState.subscriptions = botState.subscriptions[chatId];
                    saveUserState(chatId, uState);
                }
                return sendMessage(chatId, `✅ 已開始追蹤 **${symbol}**`);
            }
    
            if (command === '/LIST') {
                const remaining = checkCooldown(chatId);
                if (remaining > 0) return sendMessage(chatId, `⏳ 請稍候 ${remaining} 秒再操作。`);

                // 先回應讓用戶知道有在處理
                await sendMessage(chatId, `⏳ 載入中...`);

                const subs = Array.from(new Set(botState.subscriptions[chatId] || []));
                const subTickers = await Promise.all(
                    subs.map(symbol => timeoutOrNull(fetch24hTicker(symbol)).then(t => [symbol, t]))
                );
                const subTickerMap = Object.fromEntries(subTickers);

                let msg = `📡 追蹤列表 (Watchlist)\n------------------------------\n`;
                if (subs.length === 0) {
                    msg += '目前沒有追蹤項目。';
                } else {
                    for (const symbol of subs) {
                        const ticker = subTickerMap[symbol];
                        if (!ticker) {
                            msg += `- ${symbol} | ⚠️ 無法取得報價\n`;
                            continue;
                        }
                        const changeEmoji = ticker.change24h >= 0 ? '🟢' : '🔴';
                        const changeStr = `${ticker.change24h >= 0 ? '+' : ''}${ticker.change24h.toFixed(2)}%`;
                        msg += `- ${symbol} | ${formatPrice(ticker.price)} ${changeEmoji} ${changeStr}\n`;
                    }
                }

                return sendMessage(chatId, msg);
            }
    
            if (command === '/HISTORY') {
                const userHistory = (loadUserState(chatId).history || []);
                if (userHistory.length === 0) return sendMessage(chatId, '📋 尚無戰績。');
    
                // Parse limit from command: /HISTORY <N>
                let limit = 5;
                let warningMsg = '';
                if (parts[1]) {
                    const parsed = parseInt(parts[1], 10);
                    if (!isNaN(parsed) && parsed > 0) {
                        if (parsed > userHistory.length) {
                            limit = userHistory.length;
                            warningMsg = `⚠️ **提示**: 您要求顯示 ${parsed} 筆，但目前僅有 ${userHistory.length} 筆紀錄。\n\n`;
                        } else {
                            limit = parsed;
                        }
                    }
                }
    
                const wins = userHistory.filter(h => parseFloat(h.pnlPct) > 0).length;
                const totalPnl = userHistory.reduce((acc, h) => {
                    const u = h.pnlUsdt != null
                        ? (parseFloat(h.pnlUsdt) || 0)
                        : (parseFloat(h.pnlPct) / 100) * (h.principal || 3) * (h.leverage || 75);
                    return acc + u;
                }, 0).toFixed(1);
    
                let msg = `${warningMsg}🏆 **AI 累計戰績**\n勝率: \`${(wins / userHistory.length * 100).toFixed(1)}%\` | 總益: \`${totalPnl}U\`\n\n📜 最近 ${limit} 筆結算:\n`;
    
                // Show recent N records (reverse chronological order)
                const recentHistory = userHistory.slice(-limit).reverse();
                for (const h of recentHistory) {
                    const date = new Date(h.time).toLocaleDateString();
                    const symbol = h.symbol.padEnd(5);
                    // 簡化 reason：只顯示止盈/止損
                    const pnlPctVal = parseFloat(h.pnlPct);
                    const reasonLabel = pnlPctVal >= 0 ? '止盈' : '止損';
                    // fallback：舊記錄沒有 pnlUsdt，用 pnlPct × principal × leverage 補算
                    const pnlUsdt = h.pnlUsdt != null
                        ? parseFloat(h.pnlUsdt)
                        : (pnlPctVal / 100) * (h.principal || 3) * (h.leverage || 75);
                    const pnlUsdtStr = pnlUsdt.toFixed(3);
                    msg += `\n• \`${date}\` | \`${symbol}\` | ${pnlPctVal >= 0 ? '🟢' : '🔴'} \`${h.pnlPct}%\` (\`${pnlUsdtStr}U\`) | ${reasonLabel}`;
                }
                return sendMessage(chatId, msg);
            }
    
            if (command === '/EXPORT') {
                console.log(`[BOT] Handling /EXPORT for ${chatId}`);
                const statusMsg = await sendMessage(chatId, '⏳ **正在準備匯出數據...**\n系統正在從數據庫整理您的交易紀錄，請稍候。');
                const statusId = statusMsg?.result?.message_id;
    
                try {
                    const userHistory = loadUserState(chatId).history || [];
    
                    // Check if history is empty
                    if (userHistory.length === 0) {
                        if (statusId) await editMessage(chatId, statusId, '📋 **尚無交易紀錄**\n\n目前沒有可匯出的交易紀錄。');
                        return;
                    }
    
                    // Update progress
                    if (statusId) await editMessage(chatId, statusId, `⏳ **正在生成報表...** (共 ${userHistory.length} 筆紀錄)\n正在格式化為 CSV 檔案...`);
    
                    const workbook = new ExcelJS.Workbook();
                    const sheet1 = workbook.addWorksheet('交易實績');
                    const sheet2 = workbook.addWorksheet('排行榜預測');
    
                    const columns = [
                        { header: '幣種', key: 'symbol', width: 15 },
                        { header: '方向', key: 'side', width: 10 },
                        { header: '平均進場', key: 'entryPrice', width: 15 },
                        { header: '平均出場', key: 'exitPrice', width: 15 },
                        { header: '損益(%)', key: 'pnlPct', width: 12 },
                        { header: '損益(USDT)', key: 'pnlUsdt', width: 15 },
                        { header: '槓桿', key: 'leverage', width: 8 },
                        { header: '本金', key: 'principal', width: 10 },
                        { header: '進場時間', key: 'entryTime', width: 20 },
                        { header: '出場時間', key: 'exitTime', width: 20 },
                        { header: '出場原因', key: 'reason', width: 25 }
                    ];
    
                    const loopFColumns = [
                        ...columns.slice(0, 10),
                        { header: '入選 R²', key: 'r2', width: 12 },
                        { header: '入選斜率', key: 'slope', width: 12 },
                        { header: '入選排名', key: 'rank', width: 12 },
                        { header: '出場原因', key: 'reason', width: 25 }
                    ];
    
                    sheet1.columns = columns;
                    sheet2.columns = loopFColumns;
    
                    userHistory.forEach(h => {
                        const rowData = {
                            symbol: h.symbol,
                            side: h.side === 'LONG' ? '做多' : '做空',
                            entryPrice: h.entryPrice,
                            exitPrice: h.exitPrice,
                            pnlPct: h.pnlPct + '%',
                            pnlUsdt: h.pnlUsdt,
                            leverage: h.leverage + 'x',
                            principal: h.principal + 'U',
                            entryTime: h.entryTime ? new Date(h.entryTime).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '',
                            exitTime: new Date(h.time).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
                            reason: h.reason || '',
                            r2: h.entrySnapshot?.r2?.toFixed(3) || '',
                            slope: h.entrySnapshot?.slopePct?.toFixed(4) || '',
                            rank: h.entrySnapshot?.rank || ''
                        };
    
                        if (h.loopType === 'loopF') {
                            sheet2.addRow(rowData);
                        } else {
                            sheet1.addRow(rowData);
                        }
                    });
    
                    // 美化表格
                    [sheet1, sheet2].forEach(s => {
                        s.getRow(1).font = { bold: true };
                        s.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
                    });
    
                    const fileName = `TradeReport_${chatId}_${Date.now()}.xlsx`;
                    const filePath = path.join(process.cwd(), fileName);
                    await workbook.xlsx.writeFile(filePath);
    
    
                    if (statusId) await editMessage(chatId, statusId, `✅ **報表生成完成！**\n正在上傳至 Telegram...`);
    
                    const res = await sendDocument(chatId, filePath, '📊 **策略歷史紀錄匯出**\n包含交易時間、方向、損益及勝率統計。');
    
                    if (!res || !res.ok) {
                        throw new Error(res ? JSON.stringify(res) : '上傳系統無回應');
                    }
    
                    if (statusId) await editMessage(chatId, statusId, `✅ 匯出完成！`);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch (err) {
                    console.error(`[/EXPORT ERROR]`, err);
                    if (statusId) {
                        await editMessage(chatId, statusId, `❌ **匯出失敗**\n原因: \`${err.message}\``);
                    } else {
                        await sendMessage(chatId, `❌ **匯出失敗**\n原因: \`${err.message}\``);
                    }
                }
                return;
            }
    
            if (command === '/PRUNE') {
                const userState = loadUserState(chatId);
                const count = (userState.history || []).length;
                userState.history = [];
                saveUserState(chatId, userState);
                return sendMessage(chatId, `✅ 已清除所有戰績紀錄（共 ${count} 筆）。`);
            }
    
            // --- /LOGOUT ---
            if (command === '/LOGOUT') {
                if (!botState.verifiedUsers[chatId]) return sendMessage(chatId, '⚠️ 您尚未登入。');
                const uid = botState.verifiedUsers[chatId].uid;
                delete botState.verifiedUsers[chatId];
                saveState();
                await sendMessage(chatId, `🚪 **已登出**\nUID: \`${uid}\` 已解除綁定。\n\n如需重新登入，請輸入 \`/LOGIN <UID>\``);
                return showMainMenu(chatId);
            }
    
            // --- /CHECK <symbol> [timeframe] : Analyze a crypto pair ---
            if (command === '/CHECK') {
                const sym = (parts[1] || '').toUpperCase().replace(/USDT$/, '');
                if (!sym) {
                    botState.waitingState[chatId] = { type: 'CHECK' };
                    saveState();
                    return sendMessage(chatId, '📊 **請輸入您想分析的幣種名稱**\n例如直接輸入：`BTC` 或 `SOL`');
                }
    
                // Parse optional timeframe
                const allowedTfs = ['5m', '15m', '30m', '1h', '4h', '1d'];
                let requestedTf = '15m'; // Default timeframe
                if (parts[2]) {
                    if (allowedTfs.includes(parts[2].toLowerCase())) {
                        requestedTf = parts[2].toLowerCase();
                    } else {
                        return sendMessage(chatId, `❌ 無效時區。支援：${allowedTfs.join(', ')}`);
                    }
                }
    
                logDebug(`Processing /CHECK ${sym} (${requestedTf}) for chatId ${chatId}`);
    
                // Validate symbol exists on Binance before running full analysis
                const testData = await fetchBinanceData(sym, '1h');
                if (!testData) {
                    return sendMessage(chatId, `❌ 找不到幣種 **${sym}** 的資料\n請確認幣種名稱是否正確（例如：\`BTC\`、\`ETH\`、\`SOL\`）`);
                }
    
                // Send progress message
                const progressMsg = await sendMessage(chatId, `⏳ *${sym}* 分析中... 0%\n${'░'.repeat(10)}`);
                const progressMsgId = progressMsg?.result?.message_id;
    
                logDebug(`progressMsgId: ${progressMsgId} | raw: ${JSON.stringify(progressMsg)}`);
    
                const onProgress = async (i, total, tf) => {
                    const pct = Math.round(((i + 1) / total) * 80); // 0-80% for data fetching
                    const filled = Math.round(pct / 10);
                    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
                    if (progressMsgId) {
                        logDebug(`Editing progress message ${progressMsgId} to ${pct}%`);
                        editMessage(chatId, progressMsgId, `⏳ *${sym}* 分析中... ${pct}%\n${bar}\n📡 擷取 ${tf} K線`).catch(e => logDebug(`Failed to edit progress msg: ${e}`));
                    } else {
                        logDebug(`No progressMsgId available, skipping progress update`);
                    }
                };
    
                // Fetch all timeframes to support multi-timeframe trend analysis output
                const analysis = await getMultiTfAnalysis(sym, true, onProgress);
                if (!analysis) {
                    logDebug(`Analysis failed for ${sym}`);
                    if (progressMsgId) await deleteMessage(chatId, progressMsgId);
                    return await sendMessage(chatId, `❌ 找不到 ${sym} 的數據`);
                }
    
                // Check if data exists for requested timeframe
                const targetData = analysis.allTfs[requestedTf];
                if (!targetData) {
                    return sendMessage(chatId, `⚠️ 目前沒有 ${sym} 在 ${requestedTfs} 的數據`);
                }
    
                // Construct analysis object for the requested timeframe
                // We override 'main' with the requested timeframe data so formatReport works correctly
                const targetAnalysis = {
                    ...analysis,
                    main: targetData,
                    // We might want to keep the overall side/strategyType or recalculate based on TF?
                    // For now, let's trust the logic reusing 'side' from 15m or recalculating if needed.
                    // Actually, formatReport uses 'main' for indicators, so this is correct for the report.
                    // But 'side' property on root analysis might be specific to 15m (trend following strategy default).
                    // Let's rely on targetData.side if we want TF-specific signal.
                    side: targetData.side
                };
    
                // Generate Chart
                const candles = targetData.candles;
    
                const oiData = await fetchOIContext(sym);
                const tpMul = oiData?.tpMul || 1;
                const slMul = oiData?.slMul || 1;
    
                const settings = await DB.getSettings(chatId);
                const report = formatReport(targetAnalysis, 'ENTRY', {
                    tp: targetAnalysis.side === 'LONG' ? targetAnalysis.main.price * (1 + 0.03 * tpMul) : targetAnalysis.main.price * (1 - 0.03 * tpMul),
                    sl: targetAnalysis.side === 'LONG' ? targetAnalysis.main.price * (1 - 0.015 * slMul) : targetAnalysis.main.price * (1 + 0.015 * slMul),
                    oiData,
                    timeframe: requestedTf,
                    ...settings
                });
    
                if (candles && candles.length > 0) {
                    try {
                        // Update progress: chart generation
                        if (progressMsgId) editMessage(chatId, progressMsgId, `⏳ *${sym}* 分析中... 90%\n${'█'.repeat(9)}░\n🎨 生成K線圖表`).catch(e => logDebug(`Failed to edit progress: ${e}`));
    
                        logDebug(`Starting chart generation for ${sym} (${requestedTfs})...`);
                        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Chart generation timed out')), 10000));
    
                        const chartUrl = await Promise.race([
                            generateCandleChart(sym, requestedTf, candles, targetAnalysis.main),
                            timeoutPromise
                        ]);
    
                        // Update progress: sending
                        if (progressMsgId) editMessage(chatId, progressMsgId, `⏳ *${sym}* 分析中... 95%\n${'█'.repeat(9)}░\n📤 發送報告`).catch(e => logDebug(`Failed to edit progress: ${e}`));
    
                        logDebug(`Chart URL generated: ${chartUrl}`);
                        // 分開發送：圖表配短標題 + 詳細文字報告 (解決 Telegram 1024 字符圖文限制)
                        await sendPhoto(chatId, chartUrl, `📊 **${sym} 圖表分析 (${requestedTf})**`);
                        await sendMessage(chatId, report, { replyMarkup: KEYBOARDS.SYMBOL_ACTIONS(sym) });
                        logDebug(`Photo and Report sent successfully to ${chatId}`);
                    } catch (e) {
                        logDebug(`Chart generation or sending failed: ${e.message}`);
                        console.error('Chart generation failed:', e);
                        await sendMessage(chatId, report, { replyMarkup: KEYBOARDS.SYMBOL_ACTIONS(sym) });
                        logDebug(`Fallback text report sent to ${chatId}`);
                    }
                } else {
                    logDebug(`No candles available for chart, sending text report`);
                    await sendMessage(chatId, report, { replyMarkup: KEYBOARDS.SYMBOL_ACTIONS(sym) });
                }
                // Clean up progress message
                if (progressMsgId) await deleteMessage(chatId, progressMsgId);
                return;
            }
    
            // --- /POS : 查詢目前持倉 ---
            if (command === '/POS') {
                const positions = await getPositions();
                if (!positions.length) return sendMessage(chatId, `📭 目前無持倉`);
                let msg = `📊 目前持倉\n━━━━━━━━━━━━━\n`;
                for (const p of positions) {
                    const side = (p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT')) === 'LONG' ? '多' : '空';
                    const pnl = parseFloat(p.unrealizedProfit || 0).toFixed(2);
                    const pnlEmoji = parseFloat(pnl) >= 0 ? '🟢' : '🔴';
                    msg += `${pnlEmoji} ${p.symbol}  ${side}  ${Math.abs(parseFloat(p.positionAmt))} 張\n`;
                    msg += `  進場 \`${parseFloat(p.entryPrice).toFixed(4)}\`  未實現 \`${pnl}U\`\n`;
                }
                return sendMessage(chatId, msg);
            }
    
            // --- /CLOSE [symbol] : 平倉 ---
            if (command === '/CLOSE') {
                if (!botState.admins.includes(chatId)) return sendMessage(chatId, `⛔ 無權限`);
                const targetSym = parts[1] ? toBingxSymbol(parts[1].toUpperCase()) : null;
                const closed = await closeAllPositions(targetSym);
                if (!closed.length) return sendMessage(chatId, `📭 無持倉可平`);
                const list = closed.map(c => `• ${c.symbol} ${c.side} ${c.qty}張`).join('\n');
                return sendMessage(chatId, `✅ 已平倉：\n${list}`);
            }
    
            // --- Catch-all: unrecognized text input ---
            if (!rawText.startsWith('/') && !isButtonInput) {
                const isAdm = botState.admins.includes(chatId);
                return sendMessage(chatId, `💡 輸入文字不會自動觸發分析\n請使用下方按鈕操作：\n\n📊 **幣種分析** — 分析指定幣種\n🔭 **幣種追蹤** — 開始追蹤幣種`, { replyMarkup: KEYBOARDS.MAIN_INLINE(isAdm) });
            }
        } catch (e) {
            console.error(`[HANDLER ERROR] Fatal error in handleUpdate: ${e.stack}`);
        }
    }
    // --- Monitoring Engine ---
    
    // ── 持倉上限設定 ──────────────────────────────────────────────────
    const MAX_POSITIONS_TOTAL  = 7; // 總上限
    const MAX_POSITIONS_SCAN   = 5; // loopA 順勢掃描上限
    
    // ── Loop F：BTC 獨立掃描（已移除，由 Loop A 統一處理）──────────
    // ── Loop G：ETH 獨立掃描（已移除，由 Loop A 統一處理）──────────
    
    // ── Loop A：主流幣掃描（BTC/ETH，每 1 秒）────────────────────────
    let isScanRunning = false;
    async function loopScan() {
        if (isScanRunning) return;
        isScanRunning = true;
        try {
            await runLoopMajor({
                botState, sendMessage, openOrder, closeOrder, getPositions,
                loadCredentials, saveState, calcLeverage, formatPrice,
                MAX_POSITIONS_TOTAL,
                monitorPosition,
            });
        } catch (e) {
            console.error(`[SCAN] loopScan error: ${e.message}`);
        } finally {
            isScanRunning = false;
        }
    }
    // ── Loop B：反轉偵測 + 指標警告（每 1 分鐘）────────────────────
    async function handleCallbackQuery(query) {
        const chatId = String(query.message.chat.id);
        const data = query.data;
        const messageId = query.message.message_id;
    
        // 群組 callback 一律忽略
        const chatType = query.message.chat.type;
        if (chatType === 'group' || chatType === 'supergroup' || chatType === 'channel') return;
    
        console.log(`[BOT] Received callback: "${data}" from ${chatId}`);
    
        // Answer callback query to stop loading state in Telegram
        await curl(`${API_BASE}/answerCallbackQuery`, {
            method: 'POST',
            body: JSON.stringify({ callback_query_id: query.id })
        });
    
        if (data.startsWith('trace_')) {
            const symbol = data.replace('trace_', '');
            // Mock a message to reuse handleUpdate logic or call logic directly
            return handleUpdate({ message: { chat: { id: chatId }, text: `/TRACE ${symbol}` } }, true);
        }
    
        if (data.startsWith('check_')) {
            const symbol = data.replace('check_', '');
            return handleUpdate({ message: { chat: { id: chatId }, text: `/CHECK ${symbol}` } }, true);
        }

        const callbackCommandMap = {
            menu_check: '/CHECK',
            menu_trace: '/TRACE',
            menu_list: '/LIST',
            menu_rank: '/RANK',
            menu_clean: '/CLEAN',
            menu_version: '/VERSION',
            menu_tools: '/TOOLS',
            tools_simtrade: '/SIMTRADE',
            tools_admin: '/ADMIN',
            tools_back_main: '/MAIN',
            simtrade_api: '/SETAPI',
            simtrade_quota: '/API_QUOTA',
            simtrade_export: '/EXPORT',
            simtrade_positions: '/POSITIONS',
            simtrade_prune: '/PRUNE',
            simtrade_back_tools: '/TOOLS',
            simtrade_paper_on: '/PAPER_CONNECT',
            simtrade_paper_off: '/PAPER_DISCONNECT',
            admin_bot_settings: '/BOT_SETTINGS',
            admin_back_tools: '/TOOLS',
        };

        if (callbackCommandMap[data]) {
            return handleUpdate({ message: { chat: { id: chatId }, text: callbackCommandMap[data] } }, true);
        }

        if (data === 'bot_settings_channel') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/SET_CHANNEL_ID' } }, true);
        }

        if (data === 'bot_settings_api') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/SETAPI' } }, true);
        }

        if (data === 'bot_settings_paper_on') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/PAPER_CONNECT' } }, true);
        }

        if (data === 'bot_settings_paper_off') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/PAPER_DISCONNECT' } }, true);
        }

        if (data === 'bot_settings_position_on') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/POSITION_CONNECT_ON' } }, true);
        }

        if (data === 'bot_settings_position_off') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/POSITION_CONNECT_OFF' } }, true);
        }

        if (data === 'bot_settings_back') {
            return handleUpdate({ message: { chat: { id: chatId }, text: '/ADMIN' } }, true);
        }

        // 確認中止等待狀態
        if (data === 'confirm_cancel_yes') {
            const state = botState.waitingState[chatId];
            const pendingSwitch = state?.pendingSwitch;
            delete botState.waitingState[chatId];
            saveState();
            await sendMessage(chatId, `✅ 已中止程序，請重新選擇操作。`);
            if (pendingSwitch) {
                return handleUpdate({ message: { chat: { id: chatId }, text: pendingSwitch } }, true);
            }
            const isAdm = botState.admins.includes(chatId);
            return sendMessage(chatId, `請使用下方按鈕操作：`, { replyMarkup: KEYBOARDS.MAIN_INLINE(isAdm) });
        }
    
        if (data === 'confirm_cancel_no') {
            const state = botState.waitingState[chatId];
            if (state) {
                botState.waitingState[chatId] = { type: state.originalType };
                saveState();
            }
            const typeLabel = {
                TRACE: '追蹤幣種', CHECK: '分析幣種', UNTRACE: '取消追蹤',
                LOGIN: '帳號登入', ADDUID: '新增白名單', DELUID: '移除白名單',
                SETAPI: '設定 API Key',
            }[state?.originalType] || '操作';
            return sendMessage(chatId, `↩️ 繼續「${typeLabel}」，請輸入內容：`);
        }

        // ── 處理 Watchlist 回調 ──────────────────────────────────
        const watchlistRes = handleWatchlistCallback(query, ctx);
        if (watchlistRes) return watchlistRes;
    }

    return { handleUpdate, handleCallbackQuery };
}
async function formatWatchlistMessage(userState, tickers) {
    const watchlist = userState.watchlist || {};
    const groups = { 3: [], 2: [], 1: [] };
    const mainSymbolsSet = new Set(['BTC-USDT', 'ETH-USDT', 'NCCOGOLD2USD-USDT', 'NCCOOILWTI2USD-USDT']);
    const formatElapsed = (startedAt) => {
        const ts = Number(startedAt || 0);
        if (!ts) return '0:00';
        const elapsedMinutes = Math.max(0, Math.floor((Date.now() - ts) / 60000));
        const hours = Math.floor(elapsedMinutes / 60);
        const minutes = String(elapsedMinutes % 60).padStart(2, '0');
        return `${hours}:${minutes}`;
    };
    const formatRankMove = (data) => {
        const rank = Number(data.rank || 0);
        const prevRank = Number(data.prevRank || 0);
        if (!rank || !prevRank || rank === prevRank) return '';
        return rank < prevRank ? `  ↑ from #${prevRank}` : `  ↓ from #${prevRank}`;
    };
    const sortedLines = (items) => items.sort((a, b) => b.pnl - a.pnl).map(item => item.line).join('\n');
    const get15mChange = async (symbol) => {
        const klines = await fetchKlines(symbol.replace('-USDT', ''), '15m', 2).catch(() => null);
        if (!klines || klines.length < 2) return 0;
        const prev = parseFloat(klines[klines.length - 2][4]);
        const cur = parseFloat(klines[klines.length - 1][4]);
        return prev > 0 ? ((cur - prev) / prev * 100) : 0;
    };
    
    // 分組
    for (const [symbol, data] of Object.entries(watchlist)) {
        if (mainSymbolsSet.has(symbol)) continue;
        const ticker = tickers.find(t => t.symbol === symbol);
        const curPrice = ticker ? ticker.price : data.entryPrice;
        const entryPrice = Number(data.entryPrice || data.lastSignalPrice || curPrice || 0);
        const pnl = entryPrice > 0 ? ((curPrice - entryPrice) / entryPrice * 100) : 0;
        const sign = pnl >= 0 ? '+' : '';
        const elapsed = formatElapsed(data.lastSignalAt || data.addedAt || data.addedTime);
        const line = `\`${symbol.replace('-USDT','')}\`  ${sign}${pnl.toFixed(2)}%  ( 經過時間 : ${elapsed} )`;
        groups[data.starCount || 1].push({
            pnl,
            line: `\`${symbol.replace('-USDT','')}\`  ${sign}${pnl.toFixed(2)}%  ( 經過時間 : ${elapsed} )${formatRankMove(data)}`,
        });
    }

    let msg = `📡 **追蹤列表 (Watchlist)**\n`;
    msg += `------------------------------\n`;
    msg += `績效觀察清單\n\n`;
    msg += `⭐️⭐️⭐️ (爆發級)\n${groups[3].length ? sortedLines(groups[3]) : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `⭐️⭐️ (趨勢級)\n${groups[2].length ? sortedLines(groups[2]) : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `⭐️ (潛力級)\n${groups[1].length ? sortedLines(groups[1]) : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `主流幣種\n`;

    const mainSymbolsForDisplay = ['BTC-USDT', 'ETH-USDT', 'NCCOGOLD2USD-USDT', 'NCCOOILWTI2USD-USDT'];
    const mainNamesForDisplay = { 
        'BTC-USDT': 'BTC', 
        'ETH-USDT': 'ETH', 
        'NCCOGOLD2USD-USDT': 'XAU',
        'NCCOOILWTI2USD-USDT': 'OIL'
    };
    const mainDisplayLines = [];
    for (const sym of mainSymbolsForDisplay) {
        const data = watchlist[sym];
        if (!data) continue;
        const ticker = tickers.find(t => t.symbol === sym);
        const curPrice = ticker ? ticker.price : data.entryPrice;
        const change15m = await get15mChange(sym);
        const sign = change15m >= 0 ? '+' : '';
        const elapsed = formatElapsed(data.lastSignalAt || data.addedAt || data.addedTime);
        mainDisplayLines.push({
            pnl: change15m,
            line: `\`${mainNamesForDisplay[sym] || sym.replace('-USDT','')}\`  ${formatPrice(curPrice)}  ${sign}${change15m.toFixed(2)}% (15m)  ( 經過時間 : ${elapsed} )`,
        });
    }
    msg += `${mainDisplayLines.length ? sortedLines(mainDisplayLines) : '無'}\n`;
    return msg;
    msg += `**績效觀察清單**\n\n`;

    msg += `⭐️⭐️⭐️ (爆發級)\n${groups[3].length ? groups[3].join('\n') : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `⭐️⭐️ (趨勢級)\n${groups[2].length ? groups[2].join('\n') : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `⭐️ (潛力級)\n${groups[1].length ? groups[1].join('\n') : '無'}\n\n`;
    msg += `---\n\n`;
    msg += `主流幣種\n`;

    const mainSymbols = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'NCCOGOLD2USD-USDT'];
    const mainNames = { 'BTC-USDT': 'BTC', 'ETH-USDT': 'ETH', 'SOL-USDT': 'SOL', 'NCCOGOLD2USD-USDT': 'XAU' };
    const mainLines = [];
    for (const sym of mainSymbols) {
        const data = watchlist[sym];
        if (!data) continue;
        const ticker = tickers.find(t => t.symbol === sym);
        const curPrice = ticker ? ticker.price : data.entryPrice;
        const entryPrice = Number(data.entryPrice || data.lastSignalPrice || curPrice || 0);
        const pnl = entryPrice > 0 ? ((curPrice - entryPrice) / entryPrice * 100) : 0;
        const sign = pnl >= 0 ? '+' : '';
        const elapsed = formatElapsed(data.lastSignalAt || data.addedAt || data.addedTime);
        mainLines.push(`\`${mainNames[sym] || sym.replace('-USDT','')}\`  ${sign}${pnl.toFixed(2)}%  ( 經過時間 : ${elapsed} )`);
    }
    msg += `${mainLines.length ? mainLines.join('\n') : '無'}\n`;
    return msg;

    if (groups[3].length > 0) {
        msg += `⭐⭐⭐ (爆發級)\n${groups[3].join('\n')}\n\n`;
    }
    if (groups[2].length > 0) {
        msg += `⭐⭐ (趨勢級)\n${groups[2].join('\n')}\n\n`;
    }
    if (groups[1].length > 0) {
        msg += `⭐ (潛力級)\n${groups[1].join('\n')}\n\n`;
    }
    if (Object.keys(watchlist).length === 0) {
        msg += `（目前無追蹤幣種）\n\n`;
    }

    // 主流幣區塊
    msg += `**主流幣**\n`;
    const MAJORS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'NCCOGOLD2USD-USDT'];
    const MAJOR_NAMES = { 'BTC-USDT': 'BTC', 'ETH-USDT': 'ETH', 'SOL-USDT': 'SOL', 'NCCOGOLD2USD-USDT': 'XAU' };
    
    for (const sym of MAJORS) {
        const t = tickers.find(ticker => ticker.symbol === sym);
        if (t) {
            const emoji = t.change >= 0 ? '🟢' : '🔴';
            const sign = t.change >= 0 ? '+' : '';
            msg += `- ${MAJOR_NAMES[sym]} | ${t.price.toFixed(2)} ${emoji} ${sign}${t.change.toFixed(2)}%\n`;
        }
    }

    return msg;
}

/**
 * 在 handleCallbackQuery 中加入處理
 */
export function handleWatchlistCallback(query, ctx) {
    const { chatId, data } = query;
    const { botState, sendMessage, saveState } = ctx;

    if (data.startsWith('watch_add_')) {
        const parts = data.split('_'); // watch_add_SYMBOL_PRICE_STARS
        const symbol = parts[2];
        const price = parseFloat(parts[3]);
        const stars = parseInt(parts[4]);

        const userState = loadUserState(chatId);
        userState.watchlist = userState.watchlist || {};
        userState.watchlist[symbol] = {
            entryPrice: price,
            starCount: stars,
            addedTime: Date.now()
        };
        saveUserState(chatId, userState);

        return { text: `✅ 已加入觀察：${symbol.replace('-USDT','')}`, show_alert: false };
    }
    return null;
}
