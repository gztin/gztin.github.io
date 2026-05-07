
// chart_generator.js - QuickChart.io Version (Chart.js v4)
// Uses QuickChart API with explicit v4 version to ensure compatibility.

export async function generateCandleChart(symbol, timeframe, candles, analysis) {
    // candles: [[time, open, high, low, close, volume], ...]

    // Chart.js v4 Financial data format: { x: timestamp, o, h, l, c }
    const ohlcData = candles.map(c => ({
        x: c[0], // timestamp in ms works with 'time' scale in v4
        o: parseFloat(c[1]),
        h: parseFloat(c[2]),
        l: parseFloat(c[3]),
        c: parseFloat(c[4])
    }));

    const closes = candles.map(c => parseFloat(c[4]));
    const timestamps = candles.map(c => c[0]);

    // Simple EMA calculation for visualization
    const calculateEMA = (v, p) => {
        if (v.length < p) return Array(v.length).fill(null);
        const k = 2 / (p + 1);
        const r = new Array(v.length).fill(null);
        let sema = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
        r[p - 1] = sema;
        for (let i = p; i < v.length; i++) {
            sema = v[i] * k + sema * (1 - k);
            r[i] = sema;
        }
        return r;
    };

    // Calculate BB for visualization
    const calculateBB = (v, p = 20, d = 2) => {
        const r = new Array(v.length).fill(null);
        for (let i = p - 1; i < v.length; i++) {
            const slice = v.slice(i - p + 1, i + 1);
            const sma = slice.reduce((a, b) => a + b) / p;
            const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / p;
            const std = Math.sqrt(variance);
            r[i] = { upper: sma + d * std, lower: sma - d * std };
        }
        return r;
    };

    const ema50Data = calculateEMA(closes, 50).map((v, i) => ({ x: timestamps[i], y: v }));
    const ema200Data = calculateEMA(closes, 200).map((v, i) => ({ x: timestamps[i], y: v }));
    const bbData = calculateBB(closes);
    const bbUpper = bbData.map((v, i) => ({ x: timestamps[i], y: v ? v.upper : null }));
    const bbLower = bbData.map((v, i) => ({ x: timestamps[i], y: v ? v.lower : null }));

    // Construct Chart Configuration (v4 Syntax)
    const chartConfig = {
        type: 'candlestick',
        data: {
            datasets: [
                {
                    label: `${symbol} ${timeframe}`,
                    data: ohlcData,
                    // v4 financial plugin styling
                    color: {
                        up: '#26a69a',
                        down: '#ef5350',
                        unchanged: '#999'
                    },
                    borderColor: {
                        up: '#26a69a',
                        down: '#ef5350',
                        unchanged: '#999'
                    },
                    yAxisID: 'y'
                },
                {
                    label: 'EMA 50',
                    data: ema50Data,
                    type: 'line',
                    borderColor: '#ffeb3b',
                    borderWidth: 1,
                    pointRadius: 0,
                    yAxisID: 'y'
                },
                {
                    label: 'EMA 200',
                    data: ema200Data,
                    type: 'line',
                    borderColor: '#9c27b0',
                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y'
                },
                {
                    label: 'BB Upper',
                    data: bbUpper,
                    type: 'line',
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    borderWidth: 1,
                    pointRadius: 0,
                    borderDash: [5, 5],
                    fill: false,
                    yAxisID: 'y'
                },
                {
                    label: 'BB Lower',
                    data: bbLower,
                    type: 'line',
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    borderWidth: 1,
                    pointRadius: 0,
                    borderDash: [5, 5],
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: false,
            animation: false,
            plugins: {
                legend: {
                    labels: { color: '#ccc' }
                },
                title: {
                    display: true,
                    text: `${symbol}/USDT (${timeframe}) Technical Analysis`,
                    color: '#fff',
                    font: { size: 18 }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'minute',
                        tooltipFormat: 'PP pp'
                    },
                    ticks: {
                        color: '#999',
                        maxTicksLimit: 10
                    },
                    grid: {
                        color: '#333'
                    }
                },
                y: {
                    position: 'right',
                    ticks: {
                        color: '#ddd'
                    },
                    grid: {
                        color: '#333'
                    }
                }
            }
        }
    };


    // QuickChart API Payload
    const postData = {
        version: '4', // Explicitly request Chart.js v4
        backgroundColor: '#131722',
        width: 800,
        height: 500,
        format: 'png',
        chart: chartConfig
    };

    console.log(`[DEBUG] Requesting QuickChart short URL for ${symbol}...`);

    try {
        const response = await fetch('https://quickchart.io/chart/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(postData)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`QuickChart API Error (${response.status}): ${errText}`);
            throw new Error(`QuickChart API Error: ${response.status} ${errText}`);
        }

        const result = await response.json();
        if (!result.success || !result.url) {
            throw new Error('QuickChart did not return a valid URL');
        }
        console.log(`[DEBUG] QuickChart URL: ${result.url}`);
        return result.url;
    } catch (error) {
        console.error('Error generating chart via QuickChart:', error);
        throw error;
    }
}
