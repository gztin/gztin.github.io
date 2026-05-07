import fs from 'fs';
import path from 'path';
import { generateCandleChart } from '../chart_generator.js';

// Mock Analysis Data (Partial)
const mockAnalysis = {
    allTfs: {
        '15m': {
            ema50: 60000,
            ema200: 59000
        }
    }
};

// Mock Candles: [timestamp, open, high, low, close, volume]
const now = Date.now();
const mockCandles = [];
for (let i = 0; i < 100; i++) {
    const time = now - (99 - i) * 15 * 60 * 1000;
    const open = 60000 + Math.random() * 1000;
    const close = 60000 + Math.random() * 1000;
    const high = Math.max(open, close) + Math.random() * 100;
    const low = Math.min(open, close) - Math.random() * 100;
    mockCandles.push([time, open, high, low, close, 100]);
}

async function runTest() {
    console.log('Starting chart generation test...');
    try {
        const buffer = await generateCandleChart('BTC', '15m', mockCandles, mockAnalysis);
        console.log('Chart buffer generated, size:', buffer.length);
        fs.writeFileSync('test_chart.png', buffer);
        console.log('Chart saved to test_chart.png');
    } catch (error) {
        console.error('Error generating chart:', error);
    }
}

runTest();
