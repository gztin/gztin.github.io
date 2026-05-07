/**
 * Telegram Bot 設定檔
 * 此檔案已加入 .gitignore，請勿 commit
 * 複製 bot.config.example.js 並修改此檔案
 */

export const BOT_CONFIG = {
    // ── 管理員 ──────────────────────────────────────────────
    admins: ['931709772'],

    // ── 策略過濾層參數 ────────────────────────────────────────
    strategy: {
        adxThreshold: 25,           // ADX 最低趨勢強度
        rsiConfirmThreshold: 0.7,   // RSI 三線融合嚴格度（0.5=寬鬆, 0.7=中等, 0.9=嚴格）
        atrSLMultiplier: 2.5,       // SL 距離上限（ATR 倍數）
        atrVolMultiplier: 2.5,      // K 線實體過濾上限（ATR 倍數）
        entryThresholdDefault: 60,  // 預設進場概率門檻（%）
    },

    // ── 止盈倍數（固定 R 倍數）────────────────────────────────
    tp: {
        tp1R: 1.0,
        tp2R: 1.618,
        tp3R: 2.618,
    },

    // ── 監控週期 ──────────────────────────────────────────────
    intervals: {
        lifecycleMs: 60000,         // checkLifecycle 執行間隔（ms）
        watchdogMs: 60000,          // Watchdog 檢查間隔（ms）
        watchdogTimeoutMs: 180000,  // 無心跳超時門檻（ms）
    },
};
