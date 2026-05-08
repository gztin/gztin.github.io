/**
 * Loop G嚗???撣???? (15m + 1h)
 * 蝯曹???詨??摩 - ?桀馳閰喟敦??
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { fetchKlines, getMaxLeverage } from '../trading/scanner.js';
import { bollingerBands, avgVolume } from '../core/indicators.js';
import { loadCredentials } from '../trading/bingx_trader.js';
import { loadUserState, saveUserState } from '../core/state_manager.js';

// ?€?€ ?€????€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
const trackingList = new Map();
const NOTIFY_STAGES = [0, 15, 30, 60, 240]; 
const PERSISTENT_TRACKING = true; // 是否從日誌恢復追蹤狀態
const SIGNAL_PUSH_ENABLED = true;
const DISCORD_STAR_WEBHOOKS = {
    1: process.env.DISCORD_WEBHOOK_URL_STAR_1 || '',
    2: process.env.DISCORD_WEBHOOK_URL_STAR_2 || '',
    3: process.env.DISCORD_WEBHOOK_URL_STAR_3 || '',
};
const DISCORD_STAR_COLORS = {
    1: 0xf1c40f,
    2: 0x3498db,
    3: 0xe74c3c,
};
const DISCORD_SEND_GAP_MS = 1500;
const MIN_SIGNAL_SCORE = Number(process.env.MIN_SIGNAL_SCORE || 60);
const SIGNAL_JOURNAL_FILE = 'signal_journal.json';
const SUMMARY_WEBHOOK_URL = process.env.DISCORD_SUMMARY_WEBHOOK_URL || '';
const SUMMARY_SEND_INTERVAL_MS = 30 * 60 * 1000;
const SIGNAL_WIN_THRESHOLDS = {
    '15m': 0.8,
    '30m': 1.5,
    '1h': 5,
    '2h': 15,
    '4h': 25,
};
let discordSendQueue = Promise.resolve();
let lastSummarySentAt = 0;

// --- 掃描日誌 ---
const DISCORD_JOURNAL_WEBHOOK_URL = process.env.DISCORD_JOURNAL_WEBHOOK_URL || '';
const JOURNAL_SEND_INTERVAL_MS = 5 * 60 * 1000;
let lastJournalSentAt = 0;
let lastGitPushAt = 0;
const GIT_PUSH_INTERVAL_MS = 10 * 60 * 1000;
let latestScanStats = null; // 最近一次掃描結果，供 journal 使用

function maskWebhook(url = '') {
    if (!url) return 'NOT_SET';
    if (url.length < 20) return 'SET';
    return `${url.slice(0, 24)}...${url.slice(-6)}`;
}

console.log(`[DISCORD] config star1=${maskWebhook(DISCORD_STAR_WEBHOOKS[1])} star2=${maskWebhook(DISCORD_STAR_WEBHOOKS[2])} star3=${maskWebhook(DISCORD_STAR_WEBHOOKS[3])} summary=${maskWebhook(SUMMARY_WEBHOOK_URL)}`);

function getDataDir() {
    const dir = process.env.DATA_DIR || 'data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function getSignalJournalPath() {
    return path.join(getDataDir(), SIGNAL_JOURNAL_FILE);
}

function readSignalJournal() {
    const file = getSignalJournalPath();
    try {
        if (!fs.existsSync(file)) return { entries: [], summary: {}, updatedAt: Date.now() };
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return { entries: [], summary: {}, updatedAt: Date.now() };
    }
}

function writeSignalJournal(journal) {
    const file = getSignalJournalPath();
    fs.writeFileSync(file, JSON.stringify({ ...journal, updatedAt: Date.now() }, null, 2), 'utf-8');
    // Mirror to public path for remote dashboard read.
    try {
        const publicApiDir = path.join(process.cwd(), 'public', 'api');
        fs.mkdirSync(publicApiDir, { recursive: true });
        const publicFile = path.join(publicApiDir, 'signal_journal.json');
        fs.writeFileSync(publicFile, JSON.stringify({ ...journal, updatedAt: Date.now() }, null, 2), 'utf-8');
    } catch (err) {
        console.error('[JOURNAL] failed to mirror public signal journal:', err.message);
    }
    
    // Trigger auto git push (throttled)
    maybeGitPushJournal();
}

async function maybeGitPushJournal() {
    const now = Date.now();
    if (now - lastGitPushAt < GIT_PUSH_INTERVAL_MS) return;
    lastGitPushAt = now;

    console.log('[GIT] Attempting to push signal journal to web...');
    // Ensure git is configured in the container
    const setupCmd = `git config --global user.name "gztin" && git config --global user.email "atharsfake@gmail.com" && git config --global --add safe.directory /app`;
    const pushCmd = `git add public/api/signal_journal.json && git commit -m "auto: update signal journal [bot]" && git push`;
    
    exec(`${setupCmd} && ${pushCmd}`, { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[GIT] Push failed: ${error.message}`);
            return;
        }
        console.log(`[GIT] Push success: ${stdout.split('\n')[0]}`);
    });
}

function formatSummaryMessage(journal = {}) {
    const entries = Array.isArray(journal.entries) ? journal.entries : [];
    if (!entries.length) return 'Signal Summary\n\n暫無可用統計資料';

    const latestBySymbol = new Map();
    for (const entry of entries) {
        if (!entry?.symbol) continue;
        const current = latestBySymbol.get(entry.symbol);
        if (!current || (entry.timestamp || 0) > (current.timestamp || 0)) {
            latestBySymbol.set(entry.symbol, entry);
        }
    }

    const fmtPct = (v) => {
        if (typeof v !== 'number' || Number.isNaN(v)) return '0%';
        const rounded = Math.round(v * 100) / 100;
        const sign = rounded > 0 ? '+' : '';
        return `${sign}${rounded}%`;
    };

    const rows = [];
    for (const entry of latestBySymbol.values()) {
        const symbol = entry.symbol.replace('-USDT', '');
        const evaluations = entry.evaluations || {};
        const r1h = evaluations['1h'];
        const state60m = !r1h || typeof r1h.win !== 'boolean'
            ? 'pending'
            : (r1h.win ? 'pass' : 'fail');
        const pnl60m = (r1h && typeof r1h.pnlPct === 'number') ? r1h.pnlPct : null;
        rows.push({ symbol, score: entry.score || 0, state60m, pnl60m });
    }

    const passCount = rows.filter(r => r.state60m === 'pass').length;
    const failCount = rows.filter(r => r.state60m === 'fail').length;
    const pendingCount = rows.filter(r => r.state60m === 'pending').length;

    const topPasses = rows
        .filter(r => r.state60m === 'pass')
        .sort((a, b) => (b.pnl60m ?? 0) - (a.pnl60m ?? 0))
        .slice(0, 5)
        .map(r => `${r.symbol} ${fmtPct(r.pnl60m)}   Score: ${r.score.toFixed(1)}`);

    const sections = ['Signal Summary', ''];
    sections.push(`總覽: 達標 ${passCount} / 未達標 ${failCount} / 評估中 ${pendingCount}`);
    
    if (topPasses.length) {
        sections.push('', '表現最好 (1h 達標):');
        sections.push(...topPasses);
    }

    sections.push('', '分數段勝率統計 (15m 基準):');
    const brackets = journal.summary?.byScoreBracket || {};
    const keys = ['60-70', '70-80', '80-90', '90-100'];
    keys.forEach(k => {
        const b = brackets[k] || { wins: 0, total: 0, winRate: 0 };
        sections.push(`- ${k} 分: 勝率 ${b.winRate}% (${b.wins}/${b.total})`);
    });

    sections.push('', `更新時間: ${new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' })}`);
    return sections.join('\n');
}

const MAX_JOURNAL_ENTRIES = 2000;

function appendSignalJournalEntry(payload) {
    const journal = readSignalJournal();
    journal.entries.push(payload);
    
    // 如果資料量過大，進行裁切並封存
    if (journal.entries.length > MAX_JOURNAL_ENTRIES) {
        const removed = journal.entries.splice(0, journal.entries.length - MAX_JOURNAL_ENTRIES);
        archiveSignals(removed);
    }
    
    updateSignalSummary(journal);
    writeSignalJournal(journal);
}

function archiveSignals(entries) {
    try {
        const historyFile = path.join(getDataDir(), 'signal_history.ndjson');
        const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(historyFile, lines, 'utf-8');
    } catch (err) {
        console.error('[ARCHIVE] 封存失敗:', err.message);
    }
}

function updateSignalSummary(journal) {
    const byType = {};
    const byScoreBracket = {
        '60-70': { bracket: '60-70', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '70-80': { bracket: '70-80', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '80-90': { bracket: '80-90', total: 0, evaluated: 0, wins: 0, winRate: 0 },
        '90-100': { bracket: '90-100', total: 0, evaluated: 0, wins: 0, winRate: 0 },
    };

    for (const entry of journal.entries) {
        // 分數區間歸類
        const score = entry.score || 0;
        let bracket = null;
        if (score >= 90) bracket = '90-100';
        else if (score >= 80) bracket = '80-90';
        else if (score >= 70) bracket = '70-80';
        else if (score >= 60) bracket = '60-70';

        if (bracket) {
            byScoreBracket[bracket].total += 1;
            if (entry.evaluations) {
                const ev15m = entry.evaluations['15m'];
                if (ev15m && typeof ev15m.win === 'boolean') {
                    byScoreBracket[bracket].evaluated += 1;
                    if (ev15m.win) byScoreBracket[bracket].wins += 1;
                }
            }
        }

        if (!entry.evaluations) continue;
        for (const [horizon, result] of Object.entries(entry.evaluations)) {
            if (!result || typeof result.win !== 'boolean') continue;
            const typeKey = `${entry.signalType}__${horizon}`;
            if (!byType[typeKey]) byType[typeKey] = {
                signalType: entry.signalType,
                horizon,
                threshold: result.threshold,
                total: 0,
                wins: 0,
                winRate: 0,
            };
            byType[typeKey].total += 1;
            if (result.win) byType[typeKey].wins += 1;
        }
    }

    Object.values(byScoreBracket).forEach(b => {
        b.winRate = b.evaluated > 0 ? Number(((b.wins / b.evaluated) * 100).toFixed(2)) : 0;
    });
    Object.values(byType).forEach(t => {
        t.winRate = t.total > 0 ? Number(((t.wins / t.total) * 100).toFixed(2)) : 0;
    });

    journal.summary = { byType, byScoreBracket };
}

function queueDiscordSignal(sendDiscordMessage, message, options) {
    discordSendQueue = discordSendQueue
        .then(async () => {
            await sendDiscordMessage(message, options);
            await new Promise(resolve => setTimeout(resolve, DISCORD_SEND_GAP_MS));
        })
        .catch(err => {
            console.error('[DISCORD] queued send failed:', err.message);
            // 重置 queue，讓後續訊息不被這次失敗永久阻塞
            discordSendQueue = Promise.resolve();
        });
    return discordSendQueue;
}

const rankCache = new Map();
const orderLock = new Map();
const ORDER_LOCK_MS = 60 * 1000; 

let lastGlobalOrderTime = 0;
const GLOBAL_ORDER_INTERVAL_MS = 30 * 1000;

export const closedPositionsCache = new Map();
const POST_CLOSE_COOL_DOWN_MS = 15 * 60 * 1000;

const klineCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 分鐘快取，避免 Binance rate limit 重複打 API

function autoAddSignalWatchlist(ticker, stars, botState, chatIds, rank = {}) {
    const symbol = ticker.symbol;
    const subscriptionSymbol = symbol.replace('-USDT', '');
    const targets = Array.from(new Set((chatIds || []).map(String).filter(Boolean)));

    for (const chatId of targets) {
        try {
            if (!botState.subscriptions) botState.subscriptions = {};
            if (!Array.isArray(botState.subscriptions[chatId])) botState.subscriptions[chatId] = [];
            if (!botState.subscriptions[chatId].includes(subscriptionSymbol)) {
                botState.subscriptions[chatId].push(subscriptionSymbol);
            }

            const userState = loadUserState(chatId);
            userState.subscriptions = Array.from(new Set([
                ...(Array.isArray(userState.subscriptions) ? userState.subscriptions : []),
                subscriptionSymbol,
            ]));
            userState.watchlist = userState.watchlist || {};
            userState.watchlist[symbol] = {
                ...(userState.watchlist[symbol] || {}),
                symbol,
                entryPrice: userState.watchlist[symbol]?.entryPrice || ticker.price,
                starCount: Math.max(userState.watchlist[symbol]?.starCount || 0, stars || 1),
                lastSignalPrice: ticker.price,
                lastSignalAt: Date.now(),
                rank: rank.current || userState.watchlist[symbol]?.rank || null,
                prevRank: rank.previous || userState.watchlist[symbol]?.prevRank || null,
                source: 'auto_signal',
            };
            saveUserState(chatId, userState);
        } catch (err) {
            console.error(`[WATCHLIST] auto add failed for ${symbol} / ${chatId}:`, err.message);
        }
    }
}

/**
 * 閮??寞霈?
 */
function getPriceChange(candles) {
    if (!candles || candles.length < 2) return 0;
    const cur = parseFloat(candles[candles.length - 1][4]);
    const prev = parseFloat(candles[candles.length - 2][4]);
    return ((cur - prev) / prev) * 100;
}

function getVolumeChange(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 1) return 0;
    const currentVolume = parseFloat(candles[candles.length - 1][5] || 0);
    const prevVolumes = candles
        .slice(-(lookback + 1), -1)
        .map(c => parseFloat(c[5] || 0))
        .filter(v => Number.isFinite(v));
    const avgPrevVolume = prevVolumes.reduce((sum, value) => sum + value, 0) / (prevVolumes.length || 1);
    return avgPrevVolume > 0 ? ((currentVolume - avgPrevVolume) / avgPrevVolume * 100) : 0;
}

function emaSeries(values, period) {
    if (!values || values.length < period) return [];
    const multiplier = 2 / (period + 1);
    const result = [];
    let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
    result[period - 1] = ema;
    for (let i = period; i < values.length; i++) {
        ema = values[i] * multiplier + ema * (1 - multiplier);
        result[i] = ema;
    }
    return result;
}

function detectVReversal(candles) {
    if (!candles || candles.length < 35) return null;
    const closes = candles.map(c => parseFloat(c[4]));
    const lows = candles.map(c => parseFloat(c[3]));
    const current = closes[closes.length - 1];
    const recent = candles.slice(-16);
    const recentHigh = Math.max(...recent.map(c => parseFloat(c[2])));
    const recentLow = Math.min(...recent.map(c => parseFloat(c[3])));
    const dropPct = recentHigh > 0 ? ((recentLow - recentHigh) / recentHigh * 100) : 0;
    const reboundPct = recentLow > 0 ? ((current - recentLow) / recentLow * 100) : 0;
    const recoveryRatio = recentHigh > recentLow ? ((current - recentLow) / (recentHigh - recentLow)) : 0;
    const ema7 = emaSeries(closes, 7);
    const ema30 = emaSeries(closes, 30);
    const lastEma7 = ema7[ema7.length - 1];
    const lastEma30 = ema30[ema30.length - 1];
    const volChange = getVolumeChange(candles, 20);
    const regainedEma7 = current > lastEma7;
    const ema7NearOrAbove30 = lastEma7 >= lastEma30 * 0.995;

    if (dropPct <= -8 && reboundPct >= 8 && recoveryRatio >= 0.4 && volChange >= 80 && regainedEma7 && ema7NearOrAbove30) {
        return { dropPct, reboundPct, recoveryRatio, volChange };
    }
    return null;
}

function regressionStats(values) {
    const n = values.length;
    if (n < 2) return { r2: 0, slopePct: 0 };
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((sum, v) => sum + v, 0) / n;
    let ssXX = 0, ssXY = 0, ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
        ssXX += (i - xMean) ** 2;
        ssXY += (i - xMean) * (values[i] - yMean);
        ssTot += (values[i] - yMean) ** 2;
    }
    const slope = ssXX > 0 ? ssXY / ssXX : 0;
    const intercept = yMean - slope * xMean;
    for (let i = 0; i < n; i++) ssRes += (values[i] - (intercept + slope * i)) ** 2;
    const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    const slopePct = values[0] > 0 ? (slope / values[0]) * 100 : 0;
    return { r2, slopePct };
}

function countHigherLows(candles, lookback = 8) {
    const lows = candles.slice(-lookback).map(c => parseFloat(c[3]));
    let count = 0;
    for (let i = 1; i < lows.length; i++) {
        if (lows[i] > lows[i - 1]) count++;
    }
    return count;
}

function buildSignalProfile({ b15m, b1h, k15m, k30m, k1h, vReversal, volChange, volMul }) {
    const closes15m = k15m.map(c => parseFloat(c[4]));
    const trend15 = regressionStats(closes15m.slice(-20));
    const trend30 = regressionStats(k30m.map(c => parseFloat(c[4])).slice(-20));
    const trend1h = regressionStats(k1h.map(c => parseFloat(c[4])).slice(-20));
    const avgR2 = (trend15.r2 + trend30.r2 + trend1h.r2) / 3;
    const avgSlope = (trend15.slopePct + trend30.slopePct + trend1h.slopePct) / 3;
    const avgHigherLows = (countHigherLows(k15m) + countHigherLows(k30m) + countHigherLows(k1h)) / 3;
    const candidates = [];
    const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

    const momentum15 = clamp(((b15m.pct - 0.9) / 0.2) * 100);
    const momentum1h = clamp(((b1h.pct - 0.8) / 0.2) * 100);
    const volumeStrength = clamp((volChange / 200) * 100);
    const structureStrength = clamp(((avgR2 * 0.6) + (Math.max(0, avgSlope) / 1.5) * 0.3 + (avgHigherLows / 6) * 0.1) * 100);
    const reversalStrength = vReversal
        ? clamp((Math.abs(vReversal.dropPct) / 20) * 25 + (vReversal.reboundPct / 20) * 45 + (vReversal.recoveryRatio * 30))
        : 0;

    if (b15m.pct >= 0.98 && b1h.pct >= 0.9 && volChange > 0) {
        candidates.push({
            type: '布林突破',
            stars: b1h.pct >= 0.98 && volMul > 2 ? 3 : (b1h.pct >= 0.95 ? 2 : 1),
            score: clamp(momentum15 * 0.35 + momentum1h * 0.2 + volumeStrength * 0.25 + structureStrength * 0.2),
            explanation: `15m 接近布林上軌 (${b15m.pct.toFixed(2)})，1h 動能 ${b1h.pct.toFixed(2)}，量能 ${volChange.toFixed(2)}%`,
        });
    }
    if (vReversal) {
        candidates.push({
            type: 'V轉反彈',
            stars: vReversal.reboundPct >= 20 && vReversal.volChange >= 150 ? 3 : (vReversal.reboundPct >= 12 ? 2 : 1),
            score: clamp(reversalStrength * 0.5 + volumeStrength * 0.25 + structureStrength * 0.15 + momentum15 * 0.1),
            explanation: `急跌 ${vReversal.dropPct.toFixed(2)}%，低點反彈 +${vReversal.reboundPct.toFixed(2)}%，收復 ${(vReversal.recoveryRatio * 100).toFixed(0)}%`,
        });
    }
    if (volChange >= 150 && avgSlope > 0) {
        candidates.push({
            type: '量能爆發',
            stars: volChange >= 300 ? 3 : 2,
            score: clamp(volumeStrength * 0.55 + structureStrength * 0.25 + momentum15 * 0.2),
            explanation: `15m 成交量高於前 20 根均量 ${volChange.toFixed(2)}%，價格斜率 ${avgSlope.toFixed(3)}% / bar`,
        });
    }
    if (avgR2 >= 0.75 && avgSlope >= 0.25 && avgHigherLows >= 3) {
        candidates.push({
            type: '穩健斜率',
            stars: avgR2 >= 0.85 && avgSlope >= 0.8 ? 3 : 2,
            score: clamp(structureStrength * 0.6 + momentum15 * 0.2 + volumeStrength * 0.2),
            explanation: `Avg R2 = ${avgR2.toFixed(2)}\nAvg slope: ${avgSlope.toFixed(3)}% / bar\nAvg higher lows: ${avgHigherLows.toFixed(1)}`,
        });
    }

    return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function formatSignalExplanation(explanation) {
    if (Array.isArray(explanation)) return explanation.join('\n');
    return String(explanation)
        .replace(/[，,]/g, '\n')
        .replace(/\n\s+/g, '\n')
        .trim();
}

async function evaluatePendingSignals() {
    const journal = readSignalJournal();
    const now = Date.now();
    let changed = false;

    for (const entry of journal.entries) {
        entry.evaluations = entry.evaluations || {};
        const ageMs = now - entry.timestamp;
        const horizons = [
            { key: '15m', ms: 15 * 60 * 1000 },
            { key: '30m', ms: 30 * 60 * 1000 },
            { key: '1h', ms: 60 * 60 * 1000 },
            { key: '2h', ms: 2 * 60 * 60 * 1000 },
            { key: '4h', ms: 4 * 60 * 60 * 1000 },
        ];
        for (const horizon of horizons) {
            if (entry.evaluations[horizon.key]) continue;
            if (ageMs < horizon.ms) continue;
            const klines = await fetchKlines(entry.symbol.replace('-USDT', ''), horizon.key, 50).catch(() => null);
            if (!klines || klines.length < 2) {
                console.log(`[EVAL] ${entry.symbol} ${horizon.key} fetch failed or too short`);
                continue;
            }
            const latestClose = parseFloat(klines[klines.length - 1][4]);
            if (!latestClose || !entry.entryPrice) continue;
            const pnlPct = ((latestClose - entry.entryPrice) / entry.entryPrice) * 100;
            console.log(`[EVAL] ${entry.symbol} ${horizon.key} success: ${pnlPct.toFixed(2)}%`);
            const threshold = SIGNAL_WIN_THRESHOLDS[horizon.key] || 0;
            entry.evaluations[horizon.key] = {
                pnlPct: Number(pnlPct.toFixed(2)),
                win: pnlPct >= threshold,
                threshold,
                evaluatedAt: now,
            };
            changed = true;
        }
    }

    if (changed) {
        updateSignalSummary(journal);
        writeSignalJournal(journal);
    }
}

async function maybeSendSummary(sendDiscordMessage) {
    if (!sendDiscordMessage || !SUMMARY_WEBHOOK_URL) return;
    const now = Date.now();
    if (now - lastSummarySentAt < SUMMARY_SEND_INTERVAL_MS) return;
    const journal = readSignalJournal();
    const message = formatSummaryMessage(journal);
    await queueDiscordSignal(sendDiscordMessage, message, {
        username: 'gem0507 summary',
        webhookUrl: SUMMARY_WEBHOOK_URL,
        sourceTag: 'summary',
    });
    lastSummarySentAt = now;
}

async function maybeSendJournalReport(sendDiscordMessage) {
    if (!sendDiscordMessage || !DISCORD_JOURNAL_WEBHOOK_URL || !latestScanStats) return;
    const now = Date.now();
    if (now - lastJournalSentAt < JOURNAL_SEND_INTERVAL_MS) return;

    const { total, withSignal, buckets, scannedAt } = latestScanStats;
    const labels = ['0-10 ', '10-20', '20-30', '30-40', '40-50', '50-60', '60-70', '70-80', '80-90', '90-100'];
    const maxCount = Math.max(...buckets, 1);
    const BAR_WIDTH = 12;
    const bucketLines = buckets.map((count, i) => {
        const filled = Math.round((count / maxCount) * BAR_WIDTH);
        const bar = '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
        return `\`${labels[i]}\` ${bar} ${String(count).padStart(3)}`;
    }).join('\n');

    const timeStr = new Date(scannedAt).toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
    const description = [
        `⏱ 掃描時間：${timeStr}`,
        `🔍 掃描幣數：**${total}**`,
        `📶 偵測到訊號：**${withSignal}**`,
        '',
        '**評分分佈（每 10 分一級距）**',
        bucketLines,
    ].join('\n');

    await queueDiscordSignal(sendDiscordMessage, description, {
        username: 'gem-journal',
        webhookUrl: DISCORD_JOURNAL_WEBHOOK_URL,
        sourceTag: 'journal',
        embeds: [{
            title: '📊 掃描報告',
            description,
            color: 0x5865f2,
            timestamp: new Date().toISOString(),
        }],
    });
    lastJournalSentAt = now;
}

/**
 * ?撣????摩
 */
export async function bollingerScan(coins, ctx) {
    const { sendMessage, sendDiscordMessage, botState, openOrder, getPositions, momentum_channel } = ctx;
    const now = Date.now();
    // 本次掃描的評分統計（局部，每次 bollingerScan 獨立計算）
    const scanBuckets = new Array(10).fill(0);
    let scanWithSignal = 0;
    let klineOk = 0;  // 成功抓到 K 線的幣數
    await evaluatePendingSignals();
    await maybeSendSummary(sendDiscordMessage);
    await maybeSendJournalReport(sendDiscordMessage);

    for (let i = 0; i < coins.length; i += 10) {
        const batch = coins.slice(i, i + 10);
        await Promise.all(batch.map(async (t, idx) => {
            try {
                const currentRank = i + idx + 1;
                const getK = async (sym, iv) => {
                    const k = `${sym}_${iv}`;
                    if (klineCache.has(k) && (now - klineCache.get(k).ts < CACHE_TTL_MS)) return klineCache.get(k).data;
                    const d = await fetchKlines(sym.replace('-USDT',''), iv, 100);
                    if (d) klineCache.set(k, { data: d, ts: now });
                    return d;
                };

                const [k15m, k30m, k1h, k4h] = await Promise.all([
                    getK(t.symbol, '15m'), 
                    getK(t.symbol, '30m'),
                    getK(t.symbol, '1h'),
                    getK(t.symbol, '4h')
                ]);

                if (!k15m || !k30m || !k1h || !k4h) return;
                klineOk++;

                const c15m = k15m.map(c => parseFloat(c[4]));
                const c1h = k1h.map(c => parseFloat(c[4]));
                const b15m = bollingerBands(c15m, 20, 2);
                const b1h = bollingerBands(c1h, 20, 2);
                const vReversal = detectVReversal(k15m);

                const hasMomentum = b15m.pct >= 0.98 && (b1h.pct >= 0.9);
                if (false && !hasMomentum && !vReversal) {
                    trackingList.delete(t.symbol);
                    return;
                }

                // 閮???
                const avgV = avgVolume(k15m, 20);
                const curV = parseFloat(k15m[k15m.length - 1][5] || 0);
                const volMul = curV / (avgV || 1);
                const volChange = getVolumeChange(k15m, 20);
                if (false && volChange <= 0) {
                    trackingList.delete(t.symbol);
                    return;
                }
                
                let stars = 1, label = 'Signal';
                if (b1h.pct >= 0.98 && b15m.pct >= 0.98 && volMul > 2.0) { stars = 3; label = 'Momentum'; }
                else if (b1h.pct >= 0.95 && b15m.pct >= 0.98) { stars = 2; label = 'Trend'; }

                // ?瑕?斗
                if (vReversal) {
                    stars = vReversal.reboundPct >= 20 && vReversal.volChange >= 150 ? 3 : (vReversal.reboundPct >= 12 ? 2 : 1);
                    label = 'V-Reversal';
                }

                const signalProfile = buildSignalProfile({ b15m, b1h, k15m, k30m, k1h, vReversal, volChange, volMul });
                if (!signalProfile) {
                    trackingList.delete(t.symbol);
                    return;
                }
                stars = signalProfile.stars;
                label = signalProfile.type;
                // 追蹤評分分佈
                scanWithSignal++;
                scanBuckets[Math.min(9, Math.floor(signalProfile.score / 10))]++;

                let track = trackingList.get(t.symbol);
                let shouldNotify = false;
                let progressReport = "";

                if (!track) {
                    // 嘗試從日誌找最近一小時內的紀錄，看是否要銜接追蹤
                    const journal = readSignalJournal();
                    const lastEntry = journal.entries.slice().reverse().find(e => e.symbol === t.symbol && (now - e.timestamp < 4 * 60 * 60 * 1000));
                    
                    if (lastEntry) {
                        const stageIndex = lastEntry.stageIndex || 0;
                        const firstTimestamp = lastEntry.firstTimestamp || lastEntry.timestamp;
                        const nextStageTime = firstTimestamp + NOTIFY_STAGES[stageIndex + 1] * 60 * 1000;
                        
                        track = { 
                            stageIndex, 
                            nextNotifyAt: stageIndex + 1 < NOTIFY_STAGES.length ? nextStageTime : Infinity, 
                            lastSeenAt: now,
                            entryPrice: lastEntry.entryPrice,
                            firstTimestamp,
                            history: lastEntry.history || [] // 讀取歷史進度
                        };
                    } else {
                        track = { 
                            stageIndex: 0, 
                            nextNotifyAt: now + NOTIFY_STAGES[1] * 60 * 1000, 
                            lastSeenAt: now,
                            entryPrice: t.price,
                            firstTimestamp: now,
                            history: []
                        };
                        shouldNotify = true;
                    }
                    trackingList.set(t.symbol, track);
                } else {
                    track.lastSeenAt = now;
                    if (now >= track.nextNotifyAt) {
                        track.stageIndex++;
                        if (track.stageIndex < NOTIFY_STAGES.length) {
                            const nextIndex = track.stageIndex + 1;
                            track.nextNotifyAt = nextIndex < NOTIFY_STAGES.length 
                                ? track.firstTimestamp + NOTIFY_STAGES[nextIndex] * 60 * 1000 
                                : Infinity;
                            shouldNotify = true;
                            
                            // 計算並記錄目前進度
                            const currentPnl = ((t.price - track.entryPrice) / track.entryPrice) * 100;
                            const stageMin = NOTIFY_STAGES[track.stageIndex];
                            const stageLabel = stageMin < 60 ? `${stageMin}m` : `${stageMin / 60}h`;
                            const reportLine = `${stageLabel.padEnd(4)} 內再次推送｜目前 ${currentPnl > 0 ? '+' : ''}${currentPnl.toFixed(2)}%`;
                            
                            track.history.push(reportLine);
                            
                            progressReport = `\n📊 追蹤表現：\n`;
                            // 顯示包含首次推送在內的所有歷史
                            const firstPnl = ((t.price - track.entryPrice) / track.entryPrice) * 100;
                            progressReport += `15m  內首次推送｜目前 ${firstPnl > 0 ? '+' : ''}${firstPnl.toFixed(2)}%\n`;
                            progressReport += track.history.join('\n') + '\n';
                        }
                    }
                }

                if (shouldNotify) {
                    const prevRank = rankCache.get(t.symbol);
                    const autoWatchTargets = botState.admins?.length ? botState.admins : [momentum_channel || '931709772'];
                    autoAddSignalWatchlist(t, stars, botState, autoWatchTargets, { current: currentRank, previous: prevRank });

                    let rankDesc = `#${currentRank}`;
                    if (prevRank && prevRank !== currentRank) {
                        rankDesc += currentRank < prevRank ? ` (??from #${prevRank})` : ` (??from #${prevRank})`;
                    }
                    rankCache.set(t.symbol, currentRank);

                    const ch30m = getPriceChange(k30m);
                    const ch1h = getPriceChange(k1h);
                    const ch4h = getPriceChange(k4h);
                    
                    // volChange is calculated before signal gating.
                    const signalType = vReversal ? 'V-Reversal' : 'Bollinger Momentum';
                    const vReversalDetail = vReversal
                        ? `?亥? ${vReversal.dropPct.toFixed(2)}% / 雿??? +${vReversal.reboundPct.toFixed(2)}% / ?嗅儔 ${(vReversal.recoveryRatio * 100).toFixed(0)}%`
                        : '';

                    const fmtPct = (value) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
                    const symbolName = t.symbol.replace('-USDT', '');
                    const scoreStr = signalProfile.score.toFixed(1);

                    const cleanDescription = `[綜合分數: ${scoreStr}]\n${symbolName} ${fmtPct(t.change)}  排名 ${rankDesc}\n型態 : ${signalProfile.type}\n\n` +
                        `${formatSignalExplanation(signalProfile.explanation)}\n\n` +
                        `K線變化 30m / 1h / 4h\n` +
                        `${fmtPct(ch30m)} / ${fmtPct(ch1h)} / ${fmtPct(ch4h)}\n\n` +
                        `交易量 : ${fmtPct(volChange)}\n` +
                        `${new Date().toLocaleString('zh-TW', { hour12: true })}`;

                    const discordMsg = `Entry Score: ${scoreStr}\n` +
                        `**${symbolName}** ${fmtPct(t.change)}\n` +
                        `型態：${signalProfile.type}\n` +
                        `說明：\n${formatSignalExplanation(signalProfile.explanation)}\n` +
                        `排名：${rankDesc}\n` +
                        (progressReport || "") + "\n" +
                        `K線變動：30m ${fmtPct(ch30m)} / 1h ${fmtPct(ch1h)} / 4h ${fmtPct(ch4h)}\n` +
                        `交易量：${fmtPct(volChange)}`;

                    const replyMarkup = {
                        inline_keyboard: [[
                            { text: '分析', callback_data: `check_${symbolName}` },
                            { text: '追蹤', callback_data: `trace_${symbolName}` },
                            { text: '加入觀察', callback_data: `watch_add_${t.symbol}_${t.price}_${stars}` }
                        ]]
                    };

                    if (SIGNAL_PUSH_ENABLED && signalProfile.score >= MIN_SIGNAL_SCORE && shouldNotify) {
                        appendSignalJournalEntry({
                            id: `${t.symbol}_${Date.now()}`,
                            symbol: t.symbol,
                            signalType: signalProfile.type,
                            stars,
                            score: Number(signalProfile.score.toFixed(2)),
                            explanation: signalProfile.explanation,
                            entryPrice: track?.entryPrice || t.price,
                            timestamp: Date.now(),
                            firstTimestamp: track?.firstTimestamp || Date.now(),
                            stageIndex: track?.stageIndex || 0,
                            history: track?.history || [],
                            rank: currentRank,
                            evaluations: {},
                        });
                        
                        if (sendDiscordMessage) {
                            const majorCaps = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE', 'TRX', 'AVAX', 'LINK'];
                            const isMajor = majorCaps.some(cap => t.symbol.startsWith(cap));
                            const webhookUrl = isMajor 
                                ? (process.env.DISCORD_WEBHOOK_MAJOR || DISCORD_STAR_WEBHOOKS[stars])
                                : (process.env.DISCORD_WEBHOOK_ALT || DISCORD_STAR_WEBHOOKS[stars]);

                            await queueDiscordSignal(sendDiscordMessage, discordMsg, {
                                username: `Gems-${isMajor ? 'Major' : 'Alt'} ${scoreStr}`,
                                webhookUrl: webhookUrl,
                                sourceTag: `signal-${scoreStr}`,
                                embeds: [{
                                    title: `${isMajor ? '🏛️ 主流幣' : '🚀 小幣'} ${symbolName} 訊號推送`,
                                    description: discordMsg,
                                    color: signalProfile.score >= 80 ? 0x00ff00 : 0xcccccc,
                                    timestamp: new Date().toISOString(),
                                }],
                            });
                        }
                        // Telegram 推送 (格式比照 Discord)
                        const tgMsg = `🚀 *Entry Score: ${scoreStr}*\n` +
                                     `*${symbolName}*  ${fmtPct(t.change)}\n` +
                                     `型態：${signalProfile.type}\n` +
                                     `說明：\n${formatSignalExplanation(signalProfile.explanation)}\n` +
                                     `排名：${rankDesc}\n\n` +
                                     `K線變動：30m ${fmtPct(ch30m)} / 1h ${fmtPct(ch1h)} / 4h ${fmtPct(ch4h)}\n` +
                                     `交易量：${fmtPct(volChange)}`;
                                     
                        await sendMessage(momentum_channel || '931709772', tgMsg, { parse_mode: 'Markdown', omitLabel: true, replyMarkup });
                    }
                }

                // ?芸???(2 ?誑銝?
                if (track.stageIndex === 0 && stars >= 2 && openOrder && getPositions) {
                    try {
                        if (now - lastGlobalOrderTime < GLOBAL_ORDER_INTERVAL_MS) return;
                        if (closedPositionsCache.get(t.symbol) && (now - closedPositionsCache.get(t.symbol) < POST_CLOSE_COOL_DOWN_MS)) return;
                        if (orderLock.get(t.symbol) && (now - orderLock.get(t.symbol) < ORDER_LOCK_MS)) return;

                        const pos = await getPositions(t.symbol);
                        if (!pos.some(p => p.symbol === t.symbol && Math.abs(parseFloat(p.positionAmt)) > 0)) {
                            const cred = loadCredentials();
                            if (cred.apiKey && cred.apiSecret) {
                                lastGlobalOrderTime = now;
                                orderLock.set(t.symbol, now);
                                await openOrder({
                                    symbol: t.symbol, side: 'LONG', entryPrice: t.price,
                                    sl: b15m.mid, tp1: t.price * 1.1, leverage: 10, strength: stars >= 3 ? 'HIGH' : 'MED'
                                });
                            }
                        }
                    } catch (e) {}
                }
            } catch (e) {}
        }));
        // 批次之間稍作延遲，避免打爆 Binance API rate limit
        if (i + 10 < coins.length) await new Promise(r => setTimeout(r, 150));
    }
    // 更新最新掃描統計，供下一次 journal 使用
    latestScanStats = { total: coins.length, withSignal: scanWithSignal, buckets: scanBuckets, scannedAt: Date.now() };
    console.log(`[SCAN] 完成：掃描 ${coins.length} 幣，K線成功 ${klineOk}，有訊號 ${scanWithSignal}，分佈 [${scanBuckets.join(',')}]`);
}

