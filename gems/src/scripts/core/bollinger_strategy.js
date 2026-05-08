/**
 * Loop G：布林帶突破與量能監控引擎 (15m + 1h)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchKlines, getMaxLeverage } from '../trading/scanner.js';
import { bollingerBands, avgVolume } from '../core/indicators.js';
import { loadCredentials } from '../trading/bingx_trader.js';
import { loadUserState, saveUserState } from '../core/state_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 全局狀態與配置 ---
const trackingList = new Map();
const rankCache = new Map();
const orderLock = new Map();
const ORDER_LOCK_MS = 60 * 1000; 
let lastGlobalOrderTime = 0;
const GLOBAL_ORDER_INTERVAL_MS = 30 * 1000;
export const closedPositionsCache = new Map();
const POST_CLOSE_COOL_DOWN_MS = 15 * 60 * 1000;
const NOTIFY_STAGES = [0, 15, 30, 60, 240]; 
const PERSISTENT_TRACKING = true;
const SIGNAL_PUSH_ENABLED = true;
const DISCORD_STAR_WEBHOOKS = {
    1: process.env.DISCORD_WEBHOOK_URL_STAR_1 || '',
    2: process.env.DISCORD_WEBHOOK_URL_STAR_2 || '',
    3: process.env.DISCORD_WEBHOOK_URL_STAR_3 || '',
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
let lastJournalSentAt = 0;
let latestScanStats = null;

const DISCORD_JOURNAL_WEBHOOK_URL = process.env.DISCORD_JOURNAL_WEBHOOK_URL || '';
const JOURNAL_SEND_INTERVAL_MS = 5 * 60 * 1000;

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

const journalPath = path.join(getDataDir(), SIGNAL_JOURNAL_FILE);

function readSignalJournal() {
    try {
        if (!fs.existsSync(journalPath)) return { entries: [], summary: {}, updatedAt: Date.now() };
        return JSON.parse(fs.readFileSync(journalPath, 'utf-8'));
    } catch {
        return { entries: [], summary: {}, updatedAt: Date.now() };
    }
}

function writeSignalJournal(journal) {
    const dir = path.dirname(journalPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(journalPath, JSON.stringify({ ...journal, updatedAt: Date.now() }, null, 2), 'utf-8');
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
        const state60m = !r1h || typeof r1h.win !== 'boolean' ? 'pending' : (r1h.win ? 'pass' : 'fail');
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
    sections.push('', `更新時間: ${new Date().toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' })}`);
    return sections.join('\n');
}

function appendSignalJournalEntry(payload) {
    const journal = readSignalJournal();
    journal.entries.push(payload);
    if (journal.entries.length > 2000) {
        journal.entries.splice(0, journal.entries.length - 2000);
    }
    updateSignalSummary(journal);
    writeSignalJournal(journal);
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
    }
    journal.summary = { byScoreBracket };
}

function queueDiscordSignal(sendDiscordMessage, message, options) {
    discordSendQueue = discordSendQueue
        .then(async () => {
            await sendDiscordMessage(message, options);
            await new Promise(resolve => setTimeout(resolve, DISCORD_SEND_GAP_MS));
        })
        .catch(err => {
            console.error('[DISCORD] queued send failed:', err.message);
            discordSendQueue = Promise.resolve();
        });
    return discordSendQueue;
}

const rankCache = new Map();
const klineCache = new Map();
const CACHE_TTL_MS = 3 * 60 * 1000;

function getPriceChange(candles) {
    if (!candles || candles.length < 2) return 0;
    const cur = parseFloat(candles[candles.length - 1][4]);
    const prev = parseFloat(candles[candles.length - 2][4]);
    return ((cur - prev) / prev) * 100;
}

function getVolumeChange(candles, lookback = 20) {
    if (!candles || candles.length < lookback + 1) return 0;
    const currentVolume = parseFloat(candles[candles.length - 1][5] || 0);
    const prevVolumes = candles.slice(-(lookback + 1), -1).map(c => parseFloat(c[5] || 0));
    const avgPrevVolume = prevVolumes.reduce((sum, value) => sum + value, 0) / (prevVolumes.length || 1);
    return avgPrevVolume > 0 ? ((currentVolume - avgPrevVolume) / avgPrevVolume * 100) : 0;
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

function buildSignalProfile({ b15m, b1h, k15m, k30m, k1h, volChange, volMul, velocity = 1, rank = 0 }) {
    const closes15m = k15m.map(c => parseFloat(c[4]));
    const trend15 = regressionStats(closes15m.slice(-20));
    const candidates = [];
    const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

    const momentum15 = clamp(((b15m.pct - 0.9) / 0.2) * 100);
    const momentum1h = clamp(((b1h.pct - 0.8) / 0.2) * 100);
    const volumeStrength = clamp((volChange / 200) * 100);
    
    if (b15m.pct >= 0.98 && b1h.pct >= 0.9) {
        candidates.push({
            type: '布林突破',
            stars: b1h.pct >= 0.98 && volMul > 2 ? 3 : (b1h.pct >= 0.95 ? 2 : 1),
            score: clamp(momentum15 * 0.4 + momentum1h * 0.3 + volumeStrength * 0.3),
            explanation: `15m 接近布林上軌 (${b15m.pct.toFixed(2)})，1h 動能 ${b1h.pct.toFixed(2)}，量能速度 ${velocity.toFixed(1)}x`,
        });
    }
    if (volChange >= 150) {
        candidates.push({
            type: '量能爆發',
            stars: volChange >= 300 ? 3 : 2,
            score: clamp(volumeStrength * 0.6 + momentum15 * 0.4),
            explanation: `15m 成交量高於均量 ${volChange.toFixed(2)}%，速度 ${velocity.toFixed(1)}x`,
        });
    }

    const winner = candidates.sort((a, b) => b.score - a.score)[0];
    if (winner) {
        winner.velocity = velocity;
        winner.rank = rank;
        const entryPrice = parseFloat(k15m[k15m.length - 1][4]);
        winner.tp1 = entryPrice * (1 + (velocity * 0.005));
        winner.tp2 = entryPrice * (1 + (velocity * 0.015));
    }
    return winner;
}

function formatSignalExplanation(explanation) {
    return String(explanation).replace(/[，,]/g, '\n').trim();
}

async function evaluatePendingSignals() {
    const journal = readSignalJournal();
    const now = Date.now();
    let changed = false;
    for (const entry of journal.entries) {
        entry.evaluations = entry.evaluations || {};
        const ageMs = now - entry.timestamp;
        if (ageMs < 15 * 60 * 1000) continue;
        if (!entry.evaluations['15m']) {
            const klines = await fetchKlines(entry.symbol.replace('-USDT', ''), '15m', 5).catch(() => null);
            if (klines && klines.length > 0) {
                const lastClose = parseFloat(klines[klines.length - 1][4]);
                const pnl = ((lastClose - entry.entryPrice) / entry.entryPrice) * 100;
                entry.evaluations['15m'] = { pnlPct: Number(pnl.toFixed(3)), win: pnl >= 0.8 };
                changed = true;
            }
        }
    }
    if (changed) writeSignalJournal(journal);
}

async function maybeSendJournalReport(sendDiscordMessage) {
    if (!sendDiscordMessage || !DISCORD_JOURNAL_WEBHOOK_URL || !latestScanStats) return;
    const now = Date.now();
    if (now - lastJournalSentAt < JOURNAL_SEND_INTERVAL_MS) return;

    const { total, seedCount, seedList, scannedAt } = latestScanStats;
    const seedDetailLines = seedList && seedList.length > 0
        ? seedList.map(s => `- **${s.symbol}**: 推送 ${s.count} 次 (${s.change > 0 ? '+' : ''}${s.change.toFixed(2)}%)`).join('\n')
        : '_暫無符合的資料_';

    const timeStr = new Date(scannedAt).toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
    const description = [
        `⏱ 掃描時間：${timeStr}`,
        `🔍 掃描幣數：**${total}**`,
        `🌱 偵測到種子幣：**${seedCount || 0}**`,
        '',
        '**🌱 種子幣清單：**',
        seedDetailLines,
    ].join('\n');

    await queueDiscordSignal(sendDiscordMessage, description, {
        username: 'gem-journal',
        webhookUrl: DISCORD_JOURNAL_WEBHOOK_URL,
        embeds: [{
            title: '📊 深度掃描報告 (黑馬搜尋)',
            description,
            color: 0x2ecc71,
            timestamp: new Date().toISOString(),
        }],
    });
    lastJournalSentAt = now;
}

export async function bollingerScan(coins, ctx) {
    const { sendMessage, sendDiscordMessage, botState, momentum_channel } = ctx;
    const now = Date.now();
    const scanBuckets = new Array(10).fill(0);
    let scanSeedCount = 0;
    const scanSeedList = [];

    // --- 全市場量能雷達 ---
    const velocityMap = new Map();
    try {
        const res = await fetch('https://open-api.bingx.com/openApi/swap/v2/quote/ticker');
        const data = await res.json();
        if (data?.code === 0 && Array.isArray(data.data)) {
            const currentSnapshot = new Map();
            for (const tk of data.data) {
                const curVol = parseFloat(tk.quoteVolume);
                currentSnapshot.set(tk.symbol, curVol);
                const prevVol = global.lastMarketSnapshot?.get(tk.symbol);
                if (prevVol && curVol >= prevVol) {
                    const avgVolPerMin = curVol / (24 * 60);
                    velocityMap.set(tk.symbol, (curVol - prevVol) / (avgVolPerMin || 1));
                }
            }
            global.lastMarketSnapshot = currentSnapshot;
        }
    } catch (e) {}

    await evaluatePendingSignals();
    await maybeSendJournalReport(sendDiscordMessage);

    for (let i = 0; i < coins.length; i += 10) {
        const batch = coins.slice(i, i + 10);
        await Promise.all(batch.map(async (t, idx) => {
            try {
                const currentRank = i + idx + 1;
                const k15m = await fetchKlines(t.symbol.replace('-USDT',''), '15m', 60).catch(() => null);
                const k1h = await fetchKlines(t.symbol.replace('-USDT',''), '1h', 60).catch(() => null);
                if (!k15m || !k1h) return;

                const c15m = k15m.map(c => parseFloat(c[4]));
                const c1h = k1h.map(c => parseFloat(c[4]));
                const b15m = bollingerBands(c15m, 20, 2);
                const b1h = bollingerBands(c1h, 20, 2);

                const volChange = getVolumeChange(k15m, 20);
                const velocity = velocityMap.get(t.symbol) || 1.0;
                
                const signalProfile = buildSignalProfile({ 
                    b15m, b1h, k15m, k30m: k15m, k1h, volChange, volMul: volChange/100 + 1,
                    velocity, rank: currentRank
                });

                if (!signalProfile) return;

                // --- 嚴格過濾：不追漲 ---
                const isMajor = ['BTC-USDT', 'ETH-USDT'].includes(t.symbol);
                if (t.change > 4.0 || (!isMajor && currentRank < 100)) return;

                // --- GEMS GOLDEN FILTER V2 ---
                let gemStatus = '📶';
                const isLowPosition = t.change < 4.0 && t.change > -5.0;
                const isAccumulating = velocity >= 1.0 && volChange > 120;
                
                if (currentRank >= 100 && currentRank <= 500 && signalProfile.score >= 60 && isLowPosition && isAccumulating) {
                    gemStatus = 'SEED';
                } else if (currentRank < 150 && signalProfile.score >= 75 && velocity > 2.0) {
                    gemStatus = 'EXPLOSIVE';
                } else if (signalProfile.score >= 75) {
                    gemStatus = 'CONFIRMED';
                }

                if (gemStatus === '📶' && signalProfile.score < 65) return;
                signalProfile.gemStatus = gemStatus;

                if (gemStatus === 'SEED') {
                    scanSeedCount++;
                    scanSeedList.push({ symbol: t.symbol.replace('-USDT', ''), count: 1, change: t.change });
                }

                let track = trackingList.get(t.symbol);
                let shouldNotify = false;
                let progressReport = "";

                if (!track) {
                    track = { stageIndex: 0, nextNotifyAt: now + NOTIFY_STAGES[1] * 60 * 1000, lastSeenAt: now, entryPrice: t.price, firstTimestamp: now, lastVelocity: velocity, lastVolChange: volChange, history: [] };
                    shouldNotify = true;
                    trackingList.set(t.symbol, track);
                } else if (now >= track.nextNotifyAt && track.stageIndex < NOTIFY_STAGES.length - 1) {
                    track.stageIndex++;
                    shouldNotify = true;
                    track.nextNotifyAt = track.firstTimestamp + NOTIFY_STAGES[track.stageIndex + 1] * 60 * 1000;
                    const pnl = ((t.price - track.entryPrice) / track.entryPrice) * 100;
                    progressReport = `\n📊 追蹤表現：目前 ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}%\n`;
                }

                if (shouldNotify) {
                    const prevVel = track.lastVelocity || 1.0;
                    const prevVol = track.lastVolChange || 0;
                    let accelerationText = velocity > prevVel * 1.1 ? `\n🔥 *量能加速：${prevVel.toFixed(1)}x ➔ ${velocity.toFixed(1)}x*` : "";
                    let volGrowthText = (prevVol > 0 && volChange > prevVol) ? ` (▲ ${((volChange - prevVol) / prevVol * 100).toFixed(1)}%)` : "";
                    
                    track.lastVelocity = velocity;
                    track.lastVolChange = volChange;

                    const statusDesc = gemStatus === 'SEED' ? '潛力種子埋伏中' : (gemStatus === 'EXPLOSIVE' ? '主升段噴發中' : '量能穩定追蹤中');
                    const tgMsg = `${gemStatus === 'EXPLOSIVE' ? '🚀' : gemStatus === 'SEED' ? '🌱' : '📶'} *[${gemStatus}] Score: ${signalProfile.score.toFixed(1)}*\n` +
                                 `*${t.symbol.replace('-USDT','')}*  ${t.change > 0 ? '+' : ''}${t.change.toFixed(2)}%\n` +
                                 `狀態：${statusDesc}\n` +
                                 `⚡ 量能加速度：${velocity.toFixed(1)}x${accelerationText}\n` +
                                 `說明：\n${formatSignalExplanation(signalProfile.explanation)}\n` +
                                 `排名：#${currentRank}\n\n` +
                                 ` 🎯 *預估目標位：*\n` +
                                 ` └ TP1: \`${signalProfile.tp1.toFixed(6)}\`\n` +
                                 ` └ TP2: \`${signalProfile.tp2.toFixed(6)}\`\n\n` +
                                 `📈 交易量：+${volChange.toFixed(1)}%${volGrowthText}\n` +
                                 progressReport;
                                 
                    await sendMessage(momentum_channel || '931709772', tgMsg, { parse_mode: 'Markdown', omitLabel: true });
                    
                    if (sendDiscordMessage) {
                        const webhookUrl = ['BTC-USDT', 'ETH-USDT'].includes(t.symbol) ? (process.env.DISCORD_WEBHOOK_MAJOR || DISCORD_STAR_WEBHOOKS[signalProfile.stars]) : (process.env.DISCORD_WEBHOOK_ALT || DISCORD_STAR_WEBHOOKS[signalProfile.stars]);
                        await queueDiscordSignal(sendDiscordMessage, tgMsg, {
                            username: `Gems-${gemStatus}`,
                            webhookUrl,
                            embeds: [{ title: `${t.symbol.replace('-USDT','')} 訊號推送`, description: tgMsg, color: gemStatus === 'SEED' ? 0x2ecc71 : 0x3498db, timestamp: new Date().toISOString() }]
                        });
                    }
                }
            } catch (e) { console.error(e); }
        }));
        if (i + 10 < coins.length) await new Promise(r => setTimeout(r, 150));
    }
    latestScanStats = { total: coins.length, seedCount: scanSeedCount, seedList: scanSeedList, scannedAt: Date.now() };
}
