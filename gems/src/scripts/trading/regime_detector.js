/**
 * 市場狀態偵測（Market Regime Detection）
 *
 * 輸入：4h K線
 * 輸出：{ regime, confidence, r2, slopePct, direction, emaAligned }
 *
 * Regime 定義：
 *   TRENDING   → R² > 0.75 且 |slopePct| > 0.3%/根（強趨勢）
 *   WEAK_TREND → R² 0.45~0.75（弱趨勢，混合工具）
 *   RANGING    → R² < 0.45（橫盤，型態偵測主導）
 *
 * 設計原則：
 *   - 不另外打 API，接受外部傳入的已取得 K線（避免重複 fetch）
 *   - Regime 決定 scanCoin 走哪條路徑，工具不再固定
 */

import { ema } from '../core/indicators.js';

/**
 * @param {Array}  candles4h - 4h K線陣列（至少 50 根）
 * @param {number} period    - 回歸視窗（預設 24 根 = 4天）
 * @returns {{
 *   regime:     'TRENDING' | 'WEAK_TREND' | 'RANGING',
 *   confidence: 'HIGH' | 'MED' | 'LOW',
 *   r2:         number,
 *   slopePct:   number,
 *   direction:  'UP' | 'DOWN' | 'FLAT',
 *   emaAligned: boolean,
 * }}
 */
export function detectRegime(candles4h, period = 24) {
    const fallback = { regime: 'WEAK_TREND', confidence: 'LOW', r2: 0, slopePct: 0, direction: 'FLAT', emaAligned: false };
    if (!candles4h || candles4h.length < period) return fallback;

    const slice  = candles4h.slice(-period);
    const closes = slice.map(c => parseFloat(c[4]));
    const n      = closes.length;

    // ── 線性回歸（R² + slope）────────────────────────────────
    const xMean = (n - 1) / 2;
    const yMean = closes.reduce((a, b) => a + b, 0) / n;
    let ssXY = 0, ssXX = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
        ssXY  += (i - xMean) * (closes[i] - yMean);
        ssXX  += (i - xMean) ** 2;
        ssTot += (closes[i] - yMean) ** 2;
    }
    const slope     = ssXX > 0 ? ssXY / ssXX : 0;
    const intercept = yMean - slope * xMean;
    let ssRes = 0;
    for (let i = 0; i < n; i++) ssRes += (closes[i] - (intercept + slope * i)) ** 2;
    const r2       = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
    const slopePct = (slope / closes[0]) * 100;

    // ── EMA 排列確認 ──────────────────────────────────────────
    const allCloses = candles4h.map(c => parseFloat(c[4]));
    const ema20v    = ema(allCloses, 20);
    const ema50v    = ema(allCloses, Math.min(50, allCloses.length));
    const emaAligned =
        (slopePct > 0 && ema20v > ema50v) ||
        (slopePct < 0 && ema20v < ema50v);

    // ── Regime 分類 ───────────────────────────────────────────
    let regime, confidence;

    if (r2 > 0.75 && Math.abs(slopePct) > 0.3) {
        regime     = 'TRENDING';
        confidence = (r2 > 0.88 && emaAligned) ? 'HIGH' : 'MED';
    } else if (r2 < 0.45) {
        regime     = 'RANGING';
        confidence = r2 < 0.25 ? 'HIGH' : 'MED';
    } else {
        regime     = 'WEAK_TREND';
        confidence = 'MED';
    }

    const direction = slopePct > 0.1 ? 'UP' : slopePct < -0.1 ? 'DOWN' : 'FLAT';

    return { regime, confidence, r2, slopePct, direction, emaAligned };
}
