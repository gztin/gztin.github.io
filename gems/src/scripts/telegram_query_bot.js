import fs from 'fs';
import path from 'path';

// --- Env Loader --- (Move to top)
function loadEnv() {
    const envFiles = ['.env.local', '.env'];
    envFiles.forEach(file => {
        const envPath = path.join(process.cwd(), file);
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const [key, ...valueParts] = line.split('=');
                if (key && valueParts.length > 0) {
                    const k = key.trim();
                    if (!Object.prototype.hasOwnProperty.call(process.env, k)) {
                        process.env[k] = valueParts.join('=').trim();
                    }
                }
            }
        }
    });
}
loadEnv();

import { execSync } from 'child_process';
import { BOT_CONFIG } from './config/bot.config.js';
import { openOrder, closeOrder, closeAllPositions, getPositions, calcLeverage, toBingxSymbol, saveCredentials, loadCredentials, testCredentials, getFundingRate, getOpenInterest, updateStopLoss } from './trading/bingx_trader.js';
import { monitorPosition, fetchBingxTickers, secondStageFilter, fetchKlines, detectBreakout } from './trading/scanner.js';
import { ema, rsi, atr, avgVolume } from './core/indicators.js';
import { runLoopMajor } from './loops/loopA_major.js';
import { runLoopMonitor } from './loops/loopB_monitor.js';
import { generateCandleChart } from './trading/chart_generator.js';
import { vegasCheck4hCHoCH } from './trading/vegas.js';
import { loadGlobalState, saveGlobalState, loadUserState, saveUserState, getAllUserChatIds, migrateFromLegacy } from './core/state_manager.js';
import { curl, curlState, API_BASE, sendMessage, sendDiscordMessage, sendDocument, sendPhoto, editMessage, deleteMessage } from './core/telegram_api.js';
import { fetchBinanceData, formatPrice } from './trading/analysis.js';
import { createCommandHandlers } from './ui/commands.js';

const TOKEN = process.env.TG_TOKEN;
if (!TOKEN) {
    console.error('??TG_TOKEN is missing! Please set it in your .env or .env.local file.');
    process.exit(1);
}

// --- Version Loader ---
function getLatestVersion() {
    try {
        const changelogPath = path.join(process.cwd(), 'BOT_CHANGELOG.md');
        if (fs.existsSync(changelogPath)) {
            const content = fs.readFileSync(changelogPath, 'utf8');
            const match = content.match(/## \[(.*?)\]/);
            if (match) return match[1];
        }
    } catch (e) { console.error('Failed to parse version:', e.message); }
    return '1.0.0';
}

const LOCATION = process.env.LOCATION || 'home';
const BOT_VERSION = getLatestVersion();
const ENV_LABEL = `?? [${LOCATION.toUpperCase()}]`;
console.log(`[SYS] Starting v${BOT_VERSION} at ${LOCATION}...`);

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

function isProcessAlive(pid) {
    if (!pid || pid === process.pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        if (err?.code === 'EPERM') return true;
        return false;
    }
}

function acquireInstanceLock() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const lockPath = path.join(DATA_DIR, 'bot.lock');
    const writeLock = () => {
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(fd, JSON.stringify({
            pid: process.pid,
            location: LOCATION,
            startedAt: new Date().toISOString(),
        }, null, 2));
        fs.closeSync(fd);
    };

    try {
        writeLock();
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;

        let existing = null;
        try {
            existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch (_) {}

        if (existing?.pid && isProcessAlive(existing.pid)) {
            console.error(`[SYS] Another bot instance is already running (pid ${existing.pid}, location ${existing.location || 'unknown'}). Exiting.`);
            process.exit(1);
        }

        console.warn('[SYS] Removing stale bot.lock before startup.');
        try { fs.unlinkSync(lockPath); } catch (_) {}
        writeLock();
    }

    const release = () => {
        try {
            const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            if (current.pid === process.pid) fs.unlinkSync(lockPath);
        } catch (_) {}
    };

    process.once('exit', release);
    process.once('SIGINT', () => { release(); process.exit(130); });
    process.once('SIGTERM', () => { release(); process.exit(143); });
}

acquireInstanceLock();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || '';
const ADMIN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY;

let lastUpdateId = 0;
let botState = {
    subscriptions: {},
    activeStrategies: {},
    lastSignals: {},
    history: [],
    userBindings: {},
    whitelist: [],
    verifiedUsers: {},
    admins: BOT_CONFIG.admins,
    lastAhr999NotifyDate: null,
    waitingState: {},
    scanCooldown: {},
    loopAPending: {},
    loopFPending: {},
};

// --- Supabase Helper ---
const DB = {
    async call(table, method, query = '', body = null, useAdmin = false) {
        if (!SUPABASE_URL) return null;
        const key = useAdmin ? ADMIN_KEY : SUPABASE_KEY;
        const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
        const headers = [
            `-H "apikey: ${key}"`,
            `-H "Authorization: Bearer ${key}"`,
            `-H "Content-Type: application/json"`,
            `-H "Prefer: return=representation"`
        ];
        const bodyFlag = body ? `-d '${JSON.stringify(body).replace(/'/g, "'\\''")}'` : '';
        const cmd = `curl -s -X ${method} ${headers.join(' ')} ${bodyFlag} "${url}"`;
        try {
            const stdout = execSync(cmd).toString();
            return JSON.parse(stdout);
        } catch (e) { return null; }
    },

    async authCall(endpoint, body) {
        if (!SUPABASE_URL) return null;
        const url = `${SUPABASE_URL}/auth/v1/${endpoint}`;
        const cmd = `curl -s -X POST -H "apikey: ${SUPABASE_KEY}" -H "Content-Type: application/json" -d '${JSON.stringify(body).replace(/'/g, "'\\''")}' "${url}"`;
        try {
            const stdout = execSync(cmd).toString();
            return JSON.parse(stdout);
        } catch (e) { return null; }
    },

    async signUp(email, password, chatId) {
        const res = await this.authCall('signup', { email, password });
        if (res?.error) return { error: res.error.message };
        if (!res?.user) return { error: '閮餃?憭望?嚗?蝔??岫' };
        const profile = await this.call('profiles', 'POST', '', {
            id: res.user.id,
            email: email.toLowerCase(),
            telegram_chat_id: String(chatId),
            updated_at: new Date().toISOString()
        }, true);
        return { user: res.user, profile: profile?.[0] };
    },

    async bindProfile(chatId, email) {
        const res = await this.call('profiles', 'PATCH', `?email=eq.${email.toLowerCase()}`, { telegram_chat_id: String(chatId) }, true);
        if (res && res.length > 0) return res[0];
        return null;
    },

    async getSettings(chatId) {
        const res = await this.call('profiles', 'GET', `?telegram_chat_id=eq.${chatId}`, null, true);
        if (res && res.length > 0 && res[0].settings) {
            return {
                principal: res[0].settings.defaultPrincipal || 100,
                leverage: res[0].settings.defaultLeverage || 20
            };
        }
        return { principal: 100, leverage: 20 };
    },

    async pushStrategy(userId, strategy) {
        if (!userId) return;
        return this.call('strategies', 'POST', '', {
            user_id: userId,
            symbol: strategy.symbol,
            status: strategy.status || 'ACTIVE',
            entry_price: strategy.entryPrice,
            data: strategy,
            updated_at: new Date().toISOString()
        }, true);
    },

    async updateStrategy(userId, symbol, updates) {
        if (!userId) return;
        return this.call('strategies', 'PATCH', `?user_id=eq.${userId}&symbol=eq.${symbol}&status=eq.ACTIVE`, updates, true);
    }
};

// ??閮??瑕嚗?銝撟?車 4 撠??找????券?????? botState.scanCooldown
const scanSignalCooldown = {};

// K 蝺翰??loopMonitor ??loopExit ?梁嚗TL 15 蝘??銴? API嚗?const klineCache = {};
const KLINE_CACHE_TTL = 15 * 1000;

function loadState() {
    const globalState = loadGlobalState();
    if (globalState.admins !== undefined) botState.admins = globalState.admins;
    if (globalState.whitelist !== undefined) botState.whitelist = globalState.whitelist;
    if (globalState.rankSnapshot !== undefined) botState.rankSnapshot = globalState.rankSnapshot;
    if (globalState.rankBestRank !== undefined) botState.rankBestRank = globalState.rankBestRank;
    if (globalState.scanCooldown !== undefined) botState.scanCooldown = globalState.scanCooldown;
    if (globalState.loopAPending !== undefined) botState.loopAPending = globalState.loopAPending;
    if (globalState.loopFPending !== undefined) botState.loopFPending = globalState.loopFPending;
    if (globalState.lastUpdateId) lastUpdateId = globalState.lastUpdateId;
    
    if (!botState.subscriptions) botState.subscriptions = {};
    if (!botState.activeStrategies) botState.activeStrategies = {};
    if (!botState.lastSignals) botState.lastSignals = {};
    if (!botState.history) botState.history = [];
    if (!botState.userBindings) botState.userBindings = {};
    if (!botState.verifiedUsers) botState.verifiedUsers = {};
    if (!botState.admins) botState.admins = BOT_CONFIG.admins;
    if (!botState.lastAhr999NotifyDate) botState.lastAhr999NotifyDate = null;
    if (!botState.waitingState) botState.waitingState = {};
    if (!botState.scanCooldown) botState.scanCooldown = {};
    if (!botState.loopAPending) botState.loopAPending = {};
    if (!botState.loopFPending) botState.loopFPending = {};

    // ?? 頛???嗥???閮 ??????????????????????????????????
    try {
        // ???亦恣???activeStrategies嚗?        const adminIds = botState.admins || [];
        const adminIds = botState.admins || [];
        for (const cid of adminIds) {
            const uState = loadUserState(cid);
            if (uState.activeStrategies) {
                for (const [sKey, strategy] of Object.entries(uState.activeStrategies)) {
                    botState.activeStrategies[sKey] = strategy;
                }
            }
        }
        console.log(`[SYS] Loaded active strategies: ${Object.keys(botState.activeStrategies).length}`);

        // 頛???嗥?閮皜嚗??恍?蝞∠??∴?
        const allChatIds = getAllUserChatIds();
        let subCount = 0;
        for (const cid of allChatIds) {
            const uState = loadUserState(cid);
            if (Array.isArray(uState.subscriptions) && uState.subscriptions.length > 0) {
                botState.subscriptions[cid] = uState.subscriptions;
                subCount += uState.subscriptions.length;
            }
        }
        console.log(`[SYS] Loaded subscriptions from ${allChatIds.length} users, total symbols: ${subCount}`);
    } catch (e) {
        console.error('[StateManager] failed to load persisted user state:', e.message);
    }

    Object.assign(scanSignalCooldown, botState.scanCooldown);
}

function saveState() {
    try {
        saveGlobalState({
            admins: botState.admins || [],
            whitelist: botState.whitelist || [],
            rankSnapshot: botState.rankSnapshot || {},
            rankBestRank: botState.rankBestRank || {},
            scanCooldown: botState.scanCooldown || {},
            loopAPending: botState.loopAPending || {},
            loopFPending: botState.loopFPending || {},
            isRankRunning: botState.isRankRunning || false,
            lastUpdateId: lastUpdateId,
        });
    } catch (e) { console.error('Failed to save state:', e.message); }
}

loadState();
migrateFromLegacy();
let lastHeartbeat = Date.now();

// --- Create command handlers bound to context ---
const { handleUpdate, handleCallbackQuery } = createCommandHandlers({
    botState, sendMessage, sendPhoto, sendDocument, editMessage, deleteMessage,
    curl, API_BASE, DB, saveState,
});

// ?? ???身摰???????????????????????????????????????????????????
const MAX_POSITIONS_TOTAL  = 7;
const MAX_POSITIONS_SCAN   = 5;

// ?? Loop C嚗歇蝘駁嚗??箏蝞∠?撌脫? Loop B ????????????????????

// ?? Loop B嚗??皜?+ ???菜葫 + ?箏蝞∠?嚗? 30 蝘???????????
let isMonitorRunning = false;
async function loopMonitor() {
    if (isMonitorRunning) return;
    isMonitorRunning = true;
    try {
        await runLoopMonitor({
            botState, sendMessage, sendDiscordMessage, monitorPosition,
            formatPrice, saveState,
        });
    } catch (e) {
        console.error(`[MONITOR] loopMonitor error: ${e.message}`);
    } finally {
        isMonitorRunning = false;
    }
}
let isScanRunning = false;
async function loopScan() {
    if (isScanRunning) return;
    isScanRunning = true;
    try {
        await runLoopMajor({
            botState, sendMessage, sendDiscordMessage, openOrder, closeOrder, getPositions,
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

// ?? Loop F嚗?銵?????嚗? 5 蝘?????????????????????????????


function normalizeLoopType(loopType = '') {
    const value = String(loopType).toLowerCase();
    if (value === 'a' || value === 'loopa') return 'loopA';
    return value;
}

function calcTradeStats(trades) {
    const count = trades.length;
    const wins = trades.filter(t => parseFloat(t.pnlPct || 0) > 0).length;
    const pnlUsdt = trades.reduce((sum, t) => sum + parseFloat(t.pnlUsdt || 0), 0);
    return {
        count,
        winRate: count > 0 ? wins / count : null,
        pnlUsdt,
    };
}

function formatStats(stats) {
    if (!stats || stats.count === 0) return '撠鈭斗?鞈?';
    return `${stats.count} 蝑?/ ?? ${(stats.winRate * 100).toFixed(1)}% / PnL ${stats.pnlUsdt.toFixed(2)}U`;
}

async function fetchBotUpdates() {
    const data = await curl(`${API_BASE}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    if (!data && curlState.lastStatus === 409 && curlState.lastUrl.includes('/getUpdates')) {
        console.error('[SYS] Telegram getUpdates returned 409 Conflict. Another bot instance is polling this token; exiting this instance.');
        process.exit(1);
    }
    if (data?.ok) {
        lastHeartbeat = Date.now();
        if (data.result.length > 0) {
            console.log(`[SYS] Received ${data.result.length} updates from Telegram.`);
            for (const u of data.result) {
                lastUpdateId = u.update_id;
                if (u.message) {
                    handleUpdate(u).catch(e => console.error(`[HANDLER ERROR] Fatal error in handleUpdate: ${e.stack}`));
                } else if (u.callback_query) {
                    handleCallbackQuery(u.callback_query).catch(e => console.error(`[CALLBACK ERROR] Fatal error in handleCallbackQuery: ${e.stack}`));
                }
            }
        }
    } else if (data) {
        console.error(`[SYS] getUpdates failed: ${JSON.stringify(data)}`);
    }
}

async function setBotCommands() {
    try {
        await new Promise(r => setTimeout(r, 3000));

        const scopes = [
            { type: 'default' },
            { type: 'all_private_chats' }
        ];

        if (botState.admins && Array.isArray(botState.admins)) {
            botState.admins.forEach(id => scopes.push({ type: 'chat', chat_id: id }));
        }

        for (const scope of scopes) {
            await curl(`${API_BASE}/setMyCommands`, {
                method: 'POST',
                body: JSON.stringify({ commands: [], scope })
            });
            await curl(`${API_BASE}/deleteMyCommands`, {
                method: 'POST',
                body: JSON.stringify({ scope })
            });
        }
        
        console.log('[BOT] Slash commands thoroughly cleared for all scopes.');
    } catch (e) {
        console.error('[BOT] Failed to clear commands:', e.message);
    }
}

async function run() {
    const token = process.env.TG_TOKEN;
    const maskedToken = token ? `${token.substring(0, 5)}...${token.slice(-4)}` : 'MISSING';
    console.log(`?? bot v${BOT_VERSION} (${LOCATION}) started... (Token: ${maskedToken})`);
    await setBotCommands();
    setInterval(loopScan,          1 * 1000);
    setInterval(loopMonitor,      30 * 1000);
    setInterval(() => {
        const elapsed = Date.now() - lastHeartbeat;
        if (elapsed > BOT_CONFIG.intervals.watchdogTimeoutMs) {
            console.error(`[WATCHDOG] No successful poll for ${Math.round(elapsed / 1000)}s. Exiting for restart...`);
            process.exit(1);
        }
    }, BOT_CONFIG.intervals.watchdogMs);
    while (true) { await fetchBotUpdates(); await new Promise(r => setTimeout(r, 1000)); }
}

run().catch(console.error);
