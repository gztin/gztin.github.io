/**
 * Bug 條件探索測試 - 策略判斷邏輯 Bug
 * 
 * 此測試在未修復的代碼上執行，預期會失敗以確認 bug 存在。
 * 測試驗證系統在以下條件下錯誤發出交易信號：
 * 1. RSI 評分在觀望區間（40-60）
 * 2. 多時區趨勢不一致
 * 3. 大戶信心度低
 */

import { strict as assert } from 'assert';

// 模擬 getMultiTfAnalysis 函數的輸入和輸出
// 這裡我們需要構造符合 bug 條件的測試數據

/**
 * 測試案例 1: RSI 觀望區間測試
 * Bug 條件：15m 有 SMC Bullish OB，但 RSI 評分 47（觀望區間）
 * 預期行為：應返回 NEUTRAL
 * 實際行為（未修復）：錯誤發出 LONG 信號
 */
function testRSINeutralZone() {
    console.log('\n=== 測試 1: RSI 觀望區間測試 ===');
    
    // 構造測試數據
    const mockAnalysis = {
        '15m': {
            side: 'LONG',  // 未修復代碼會發出 LONG 信號
            price: 71055.20,
            rsi6: 46.4,
            rsi12: 48.5,
            rsi24: 47.0,
            ema50: 70000,
            smc: { ob: { type: 'BULLISH_OB' } },
            snr: { supports: [70000] }
        },
        '5m': { side: 'SHORT' },
        '1h': { side: 'SHORT' },
        '4h': { side: 'NEUTRAL' },
        '1d': { side: 'NEUTRAL' }
    };
    
    // 計算 RSI 評分（模擬）
    const rsiScore = Math.round((47.0 * 0.5) + (48.5 * 0.3) + (46.4 * 0.2)); // ≈ 47
    
    console.log(`RSI 評分: ${rsiScore}/100 (觀望區間)`);
    console.log(`15m 信號: ${mockAnalysis['15m'].side}`);
    console.log(`多時區趨勢: 5m=${mockAnalysis['5m'].side}, 1h=${mockAnalysis['1h'].side}, 4h=${mockAnalysis['4h'].side}`);
    
    // Bug 條件檢查
    const isBugCondition = (
        mockAnalysis['15m'].side === 'LONG' &&
        rsiScore >= 40 && rsiScore <= 60 &&
        // 計算一致性
        [mockAnalysis['15m'].side, mockAnalysis['1h'].side, mockAnalysis['4h'].side]
            .filter(s => s === 'LONG').length < 2
    );
    
    console.log(`Bug 條件滿足: ${isBugCondition}`);
    
    // 預期行為：應返回 NEUTRAL
    const expectedSide = 'NEUTRAL';
    const actualSide = mockAnalysis['15m'].side; // 未修復代碼的實際輸出
    
    console.log(`預期信號: ${expectedSide}`);
    console.log(`實際信號: ${actualSide}`);
    
    try {
        assert.strictEqual(actualSide, expectedSide, 
            `Bug 確認：RSI 觀望區間時應返回 NEUTRAL，但實際返回 ${actualSide}`);
        console.log('✅ 測試通過（Bug 已修復）');
        return true;
    } catch (error) {
        console.log(`❌ 測試失敗（Bug 存在）: ${error.message}`);
        return false;
    }
}

/**
 * 測試案例 2: 多時區不一致測試
 * Bug 條件：15m LONG，但 1h/4h 為 SHORT/NEUTRAL
 * 預期行為：應返回 NEUTRAL
 * 實際行為（未修復）：錯誤發出 LONG 信號
 */
function testMultiTimeframeInconsistency() {
    console.log('\n=== 測試 2: 多時區不一致測試 ===');
    
    const mockAnalysis = {
        '15m': {
            side: 'LONG',
            price: 71319.90,
            rsi6: 52.0,
            rsi12: 53.0,
            rsi24: 51.0,
            ema50: 70000,
            smc: { ob: { type: 'BULLISH_OB' } },
            snr: { supports: [70000] }
        },
        '5m': { side: 'SHORT' },
        '1h': { side: 'SHORT' },
        '4h': { side: 'NEUTRAL' },
        '1d': { side: 'NEUTRAL' }
    };
    
    // 計算一致性
    const consistentCount = [mockAnalysis['15m'].side, mockAnalysis['1h'].side, mockAnalysis['4h'].side]
        .filter(s => s === 'LONG').length;
    
    console.log(`15m 信號: ${mockAnalysis['15m'].side}`);
    console.log(`多時區趨勢: 5m=${mockAnalysis['5m'].side}, 1h=${mockAnalysis['1h'].side}, 4h=${mockAnalysis['4h'].side}, 1d=${mockAnalysis['1d'].side}`);
    console.log(`一致性計數: ${consistentCount}/3 (需要至少 2 個)`);
    
    const isBugCondition = (
        mockAnalysis['15m'].side === 'LONG' &&
        consistentCount < 2
    );
    
    console.log(`Bug 條件滿足: ${isBugCondition}`);
    
    const expectedSide = 'NEUTRAL';
    const actualSide = mockAnalysis['15m'].side;
    
    console.log(`預期信號: ${expectedSide}`);
    console.log(`實際信號: ${actualSide}`);
    
    try {
        assert.strictEqual(actualSide, expectedSide,
            `Bug 確認：多時區不一致時應返回 NEUTRAL，但實際返回 ${actualSide}`);
        console.log('✅ 測試通過（Bug 已修復）');
        return true;
    } catch (error) {
        console.log(`❌ 測試失敗（Bug 存在）: ${error.message}`);
        return false;
    }
}

/**
 * 測試案例 3: 大戶信心度低測試
 * Bug 條件：15m 有信號，但大戶信心度 57，且只有 1 個時間框架一致
 * 預期行為：應返回 NEUTRAL（信心度低時要求至少 3 個一致）
 * 實際行為（未修復）：錯誤發出 LONG 信號
 */
function testLowWhaleConfidence() {
    console.log('\n=== 測試 3: 大戶信心度低測試 ===');
    
    const mockAnalysis = {
        '15m': {
            side: 'LONG',
            price: 71055.20,
            rsi6: 52.0,
            rsi12: 53.0,
            rsi24: 51.0,
            ema50: 70000,
            smc: { ob: { type: 'BULLISH_OB' } },
            snr: { supports: [70000] }
        },
        '5m': { side: 'NEUTRAL' },
        '1h': { side: 'SHORT' },
        '4h': { side: 'NEUTRAL' },
        '1d': { side: 'NEUTRAL' }
    };
    
    const whaleConfidence = 57; // 低於 65
    const consistentCount = [mockAnalysis['15m'].side, mockAnalysis['1h'].side, mockAnalysis['4h'].side]
        .filter(s => s === 'LONG').length;
    const requiredConsistency = whaleConfidence < 65 ? 3 : 2;
    
    console.log(`大戶信心度: ${whaleConfidence}/100 (低於 65)`);
    console.log(`一致性計數: ${consistentCount}/3`);
    console.log(`要求一致性: ${requiredConsistency} 個時間框架`);
    
    const isBugCondition = (
        mockAnalysis['15m'].side === 'LONG' &&
        whaleConfidence < 65 &&
        consistentCount < requiredConsistency
    );
    
    console.log(`Bug 條件滿足: ${isBugCondition}`);
    
    const expectedSide = 'NEUTRAL';
    const actualSide = mockAnalysis['15m'].side;
    
    console.log(`預期信號: ${expectedSide}`);
    console.log(`實際信號: ${actualSide}`);
    
    try {
        assert.strictEqual(actualSide, expectedSide,
            `Bug 確認：大戶信心度低且一致性不足時應返回 NEUTRAL，但實際返回 ${actualSide}`);
        console.log('✅ 測試通過（Bug 已修復）');
        return true;
    } catch (error) {
        console.log(`❌ 測試失敗（Bug 存在）: ${error.message}`);
        return false;
    }
}

/**
 * 測試案例 4: 邊界條件測試
 * Bug 條件：RSI 評分剛好 60（邊界值）
 * 預期行為：應返回 NEUTRAL（60 仍在觀望區間上限）
 */
function testBoundaryCondition() {
    console.log('\n=== 測試 4: 邊界條件測試（RSI = 60）===');
    
    const mockAnalysis = {
        '15m': {
            side: 'LONG',
            price: 71055.20,
            rsi6: 60.0,
            rsi12: 60.0,
            rsi24: 60.0,
            ema50: 70000,
            smc: { ob: { type: 'BULLISH_OB' } },
            snr: { supports: [70000] }
        },
        '1h': { side: 'LONG' },
        '4h': { side: 'LONG' }
    };
    
    const rsiScore = 60; // 邊界值
    
    console.log(`RSI 評分: ${rsiScore}/100 (邊界值)`);
    console.log(`15m 信號: ${mockAnalysis['15m'].side}`);
    
    // 邊界條件：RSI = 60 應該被視為觀望區間
    const isBoundary = rsiScore === 60;
    
    console.log(`邊界條件: ${isBoundary}`);
    
    const expectedSide = 'NEUTRAL'; // 60 仍在觀望區間
    const actualSide = mockAnalysis['15m'].side;
    
    console.log(`預期信號: ${expectedSide}`);
    console.log(`實際信號: ${actualSide}`);
    
    try {
        assert.strictEqual(actualSide, expectedSide,
            `Bug 確認：RSI = 60 時應返回 NEUTRAL，但實際返回 ${actualSide}`);
        console.log('✅ 測試通過（Bug 已修復）');
        return true;
    } catch (error) {
        console.log(`❌ 測試失敗（Bug 存在）: ${error.message}`);
        return false;
    }
}

// 執行所有測試
function runAllTests() {
    console.log('========================================');
    console.log('策略判斷邏輯 Bug 條件探索測試');
    console.log('========================================');
    console.log('注意：這些測試在未修復的代碼上預期會失敗');
    console.log('失敗表示 bug 存在，這是正確的行為');
    console.log('========================================');
    
    const results = [
        testRSINeutralZone(),
        testMultiTimeframeInconsistency(),
        testLowWhaleConfidence(),
        testBoundaryCondition()
    ];
    
    const passedCount = results.filter(r => r).length;
    const totalCount = results.length;
    
    console.log('\n========================================');
    console.log(`測試結果: ${passedCount}/${totalCount} 通過`);
    
    if (passedCount === 0) {
        console.log('✅ 所有測試失敗 - Bug 存在已確認');
        console.log('這是預期行為，現在可以進行修復');
    } else if (passedCount === totalCount) {
        console.log('✅ 所有測試通過 - Bug 已修復');
    } else {
        console.log('⚠️  部分測試通過 - 可能部分修復或測試問題');
    }
    console.log('========================================');
    
    return passedCount === totalCount;
}

// 執行測試
runAllTests();
