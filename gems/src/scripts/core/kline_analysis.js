// src/scripts/core/kline_analysis.js
// Utility module for fetching K‑line data and performing lightweight analysis.
// It re‑uses the existing fetchKlines helper from scanner.js and provides
// functions to compute price change, slope, volatility and a simple trend.

import { fetchKlines } from '../trading/scanner.js';

/**
 * Compute linear regression slope (price per minute) between first and last candle.
 * For simplicity we use (lastClose - firstClose) / (lastTime - firstTime) * 1000 * 60
 * to express slope in % per minute.
 */
function computeSlope(klines) {
  if (!klines || klines.length < 2) return 0;
  const first = klines[0];
  const last = klines[klines.length - 1];
  const firstTime = Number(first[0]); // timestamp in ms
  const lastTime = Number(last[0]);
  const firstClose = Number(first[4]);
  const lastClose = Number(last[4]);
  if (lastTime === firstTime) return 0;
  const pctChange = ((lastClose - firstClose) / firstClose) * 100;
  // slope expressed as % per minute
  const minutes = (lastTime - firstTime) / 60000;
  return minutes ? pctChange / minutes : 0;
}

/**
 * Compute volatility as standard deviation of minute‑to‑minute percentage changes.
 */
function computeVolatility(klines) {
  if (!klines || klines.length < 2) return 0;
  const changes = [];
  for (let i = 1; i < klines.length; i++) {
    const prev = Number(klines[i - 1][4]);
    const cur = Number(klines[i][4]);
    if (prev === 0) continue;
    changes.push(((cur - prev) / prev) * 100);
  }
  const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
  const variance = changes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / changes.length;
  return Math.sqrt(variance);
}

/**
 * Analyse a set of klines and return a summary object.
 *   change   – overall % change from first to last candle
 *   slope    – % change per minute (linear approximation)
 *   volatility – std‑dev of intra‑candle % changes
 *   trend    – "↑" if change > 0, "↓" if < 0, "→" otherwise
 */
export function analyzeKlines(klines) {
  if (!klines || klines.length === 0) return null;
  const firstClose = Number(klines[0][4]);
  const lastClose = Number(klines[klines.length - 1][4]);
  const change = ((lastClose - firstClose) / firstClose) * 100;
  const slope = computeSlope(klines);
  const volatility = computeVolatility(klines);
  const trend = change > 0.1 ? '↑' : change < -0.1 ? '↓' : '→';
  return { change, slope, volatility, trend };
}

/**
 * Helper to fetch K‑lines for a given symbol and interval, then analyse them.
 * Returns the analysis object defined above.
 */
export async function fetchAndAnalyse(symbol, interval, limit = 60) {
  const klines = await fetchKlines(symbol, interval, limit).catch(() => null);
  if (!klines) return null;
  return analyzeKlines(klines);
}
