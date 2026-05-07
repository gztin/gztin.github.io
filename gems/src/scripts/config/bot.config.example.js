/**
 * Telegram Bot 設定範本
 * 複製此檔案為 bot.config.js 並填入實際設定
 */

export const BOT_CONFIG = {
    // ── 管理員 ──────────────────────────────────────────────
    admins: ['YOUR_TELEGRAM_CHAT_ID'],

    // ── 策略過濾層參數 ────────────────────────────────────────
    strategy: {
        adxThreshold: 25,
        rsiConfirmThreshold: 0.7,   // 0.5=寬鬆, 0.7=中等, 0.9=嚴格
        atrSLMultiplier: 2.5,
        atrVolMultiplier: 2.5,
        entryThresholdDefault: 60,
    },

    // ── 止盈倍數（固定 R 倍數）────────────────────────────────
    tp: {
        tp1R: 1.0,
        tp2R: 1.618,
        tp3R: 2.618,
    },

    // ── 監控週期 ──────────────────────────────────────────────
    intervals: {
        lifecycleMs: 60000,
        watchdogMs: 60000,
        watchdogTimeoutMs: 180000,
    },
};
