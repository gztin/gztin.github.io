/**
 * Loop A：統一監控循環 (主流標的 + 排行榜)
 * 核心策略：多時框布林貼軌爆發
 */

import { fetchBingxTickers } from '../trading/scanner.js';
import { bollingerScan } from '../core/bollinger_strategy.js';

const MAJOR_SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'NCCOGOLD2USD-USDT', 'NCCOOILWTI2USD-USDT'];

let isLoopRunning = false;
let lastScanAt = 0;
const SCAN_INTERVAL_MS = 10 * 1000; 

const CHANNELS = {
    momentum_channel: '931709772',
};

export async function runLoopMajor(ctx) {
    const now = Date.now();

    if (now - lastScanAt < SCAN_INTERVAL_MS) return;
    if (isLoopRunning) return;
    isLoopRunning = true;

    try {
        lastScanAt = now;
        console.log('[LOOP-A] 開始統一布林掃描 (主流幣 + 排行榜 Top 100)...');

        const allTickers = await fetchBingxTickers();
        if (!allTickers || !allTickers.length) return;

        // 1. 取得主流標的
        const majors = allTickers.filter(t => MAJOR_SYMBOLS.includes(t.symbol));

        // 2. 取得排行榜前 100 名
        const top100 = allTickers
            .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
            .slice(0, 100)
            .filter(t => !MAJOR_SYMBOLS.includes(t.symbol));

        const scanList = [...majors, ...top100];

        // 將 momentum_channel 傳入 bollingerScan 以便獨立推播
        await bollingerScan(scanList, { ...ctx, momentum_channel: CHANNELS.momentum_channel });

    } catch (e) {
        console.error('[LOOP-A] 主流程異常:', e.message);
    } finally {
        isLoopRunning = false;
    }
}
