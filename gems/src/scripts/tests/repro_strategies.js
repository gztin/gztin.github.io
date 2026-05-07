const fs = require('fs');

// Mock dependencies
const botState = {
    subscriptions: { 'user1': ['BTC'] },
    activeStrategies: {},
    lastSignals: {},
    history: [],
    userBindings: {}
};

// Mock Helper functions
const TA = {
    calculateEMA: (v, p) => [100], // Dummy
    calculateRSI: (v, p) => [60], 
    calculateMACD: (v) => ({ hist: 1 })
};

// Mock Analysis result
// Scenario: A valid LONG signal exists. 
// We will simulate a Strategy that is ACTIVE, then EXITS, and see if it Re-enters immediately.
let mockPrice = 50000;
let mockTime = Date.now();

async function getMultiTfAnalysis(symbol) {
    return {
        symbol,
        main: {
            price: mockPrice,
            tp1: 51000, tp2: 52000, tp3: 53000,
            tp1Hit: false, tp2Hit: false, tp3Hit: false,
            // Logic conditions
            price: mockPrice,
            ema50: 40000,
            macd: { hist: 1 },
            rsi6: 60, rsi12: 60, rsi24: 60,
            fibZone: [40000, 45000], fibZoneInv: [48000, 49000] // Entry zone
        },
        allTfs: {
            '5m': { side: 'LONG' },
            '15m': { side: 'LONG' },
            '1h': { side: 'LONG' }
        },
        side: 'LONG',
        strategyType: 'TREND'
    };
}

// Mock other functions
async function fetchOIContext(symbol) { return { slMul: 1, tpMul: 1 }; }
const DB = { updateStrategy: async () => {}, pushStrategy: async () => {} };
async function sendMessage(id, text) { 
    console.log(`[MSG to ${id}] ${text.replace(/\n/g, ' ')}`); 
}
function saveState() { console.log('[State Saved]'); }
function formatReport() { return "Report..."; }

// Extracted logic from checkLifecycle (simplified for repro)
async function checkLifecycle() {
    console.log('\n--- checkLifecycle Run ---');
    console.log(`Active Strategies: ${Object.keys(botState.activeStrategies).join(',')}`);

    // 1. Check Active Strategies
    for (const [symbol, strategy] of Object.entries(botState.activeStrategies)) {
        const analysis = await getMultiTfAnalysis(symbol);
        const price = analysis.main.price;
        let exitReason = null;

        // Simulate Exit Condition: Price hit SL
        // Let's say SL is 49000. Price is 48000.
        if (price <= strategy.sl) exitReason = '止損 (SL)';

        if (exitReason) {
            console.log(`Exiting strategy for ${symbol} due to ${exitReason}`);
            await sendMessage(strategy.chatId, `Exited: ${exitReason}`);
            delete botState.activeStrategies[symbol];
            saveState();
        }
    }

    // 2. Check New Signals
    const allSymbols = ['BTC']; // Simplified
    for (const symbol of allSymbols) {
        if (botState.activeStrategies[symbol]) continue;
        
        const analysis = await getMultiTfAnalysis(symbol);
        if (!analysis || analysis.side === 'NEUTRAL') continue;
        
        const last = botState.lastSignals[symbol];
        // REPRO CONDITION: Last signal was > 4 hours ago
        if (last && last.side === analysis.side && (Date.now() - last.time < 4 * 60 * 60 * 1000)) {
            console.log(`Skipping re-entry: Cooldown active.`);
            continue;
        }

        console.log(`creating new strategy for ${symbol}...`);
        botState.lastSignals[symbol] = { side: analysis.side, time: Date.now() };
        botState.activeStrategies[symbol] = {
            chatId: 'user1', side: analysis.side, 
            entryPrice: analysis.main.price, sl: 49000,
            status: 'ACTIVE'
        };
        await sendMessage('user1', `Entry Reminder`);
        saveState();
    }
}

async function runTest() {
    // Setup: Strategy started 5 hours ago
    botState.lastSignals['BTC'] = { side: 'LONG', time: Date.now() - 5 * 60 * 60 * 1000 };
    botState.activeStrategies['BTC'] = {
        chatId: 'user1', side: 'LONG',
        entryPrice: 50000, sl: 49000,
        status: 'ACTIVE',
        time: Date.now() - 5 * 60 * 60 * 1000
    };

    console.log('Initial State: Strategy Active (Old)');
    
    // Step 1: Run lifecycle with Price = 48000 (Hit SL)
    // Expect: Exit -> Delete -> IMMEDIATE Re-entry (if logic is flawed)
    mockPrice = 48000; 
    
    await checkLifecycle();

    console.log('\nFinal State:');
    if (botState.activeStrategies['BTC']) {
        console.log('FAIL: Strategy was re-created immediately!');
    } else {
        console.log('PASS: Strategy remained closed.');
    }
}

runTest();
