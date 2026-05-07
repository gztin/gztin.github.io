import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { runLoopExit } from '../loops/loopC_exit.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePaperStrategy(overrides = {}) {
    return {
        symbol: 'BTC-USDT',
        side: 'LONG',
        entryPrice: 100,
        sl: 90,
        tp1: 110,
        tp2: 120,
        tp3: 130,
        chatId: 'user1',
        bingxQty: 0,
        isPaper: true,
        leverage: 10,
        principal: 3,
        time: Date.now() - 1000,
        ...overrides,
    };
}

function makeCtx(overrides = {}) {
    return {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        closeOrder: vi.fn().mockResolvedValue(undefined),
        getPositions: vi.fn().mockResolvedValue([]),
        formatPrice: (p) => String(p),
        monitorPosition: vi.fn().mockResolvedValue({ price: 105, pnlPct: '5.00' }),
        getAllUserChatIds: vi.fn().mockReturnValue([]),
        loadUserState: vi.fn(),
        saveUserState: vi.fn(),
        ...overrides,
    };
}

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('runLoopExit - 用戶隔離', () => {
    it('讀取用戶狀態失敗時 continue，不中斷其他用戶（需求 8.4）', async () => {
        const user1State = {
            activeStrategies: {
                'BTC-USDT': makePaperStrategy({ chatId: 'user1', sl: 200 }), // sl 不會觸發
            },
            history: [],
        };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['bad_user', 'user1']),
            loadUserState: vi.fn((chatId) => {
                if (chatId === 'bad_user') throw new Error('讀取失敗');
                return user1State;
            }),
        });

        // 不應拋出例外
        await expect(runLoopExit(ctx)).resolves.not.toThrow();
        // user1 的 monitorPosition 應被呼叫（代表 user1 有被處理）
        expect(ctx.monitorPosition).toHaveBeenCalled();
    });

    it('出場後呼叫 saveUserState 而非 saveState（需求 8.3）', async () => {
        const strategy = makePaperStrategy({ sl: 90, entryPrice: 100 }); // price=105 不觸發 SL（sl=90 < price=105）
        // 讓超時觸發出場
        strategy.time = Date.now() - 49 * 60 * 60 * 1000;

        const userState = { activeStrategies: { 'BTC-USDT': strategy }, history: [] };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['user1']),
            loadUserState: vi.fn().mockReturnValue(userState),
        });

        await runLoopExit(ctx);

        expect(ctx.saveUserState).toHaveBeenCalledWith('user1', expect.objectContaining({
            history: expect.arrayContaining([expect.objectContaining({ reason: expect.stringContaining('超時') })]),
        }));
    });

    it('出場後 history 包含出場記錄（需求 8.3）', async () => {
        const strategy = makePaperStrategy({ time: Date.now() - 49 * 60 * 60 * 1000 });
        const userState = { activeStrategies: { 'BTC-USDT': strategy }, history: [] };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['user1']),
            loadUserState: vi.fn().mockReturnValue(userState),
        });

        await runLoopExit(ctx);

        expect(userState.history.length).toBeGreaterThan(0);
        expect(userState.history[0]).toMatchObject({
            symbol: 'BTC',
            side: 'LONG',
            chatId: 'user1',
        });
    });

    it('出場後從 activeStrategies 移除策略', async () => {
        const strategy = makePaperStrategy({ time: Date.now() - 49 * 60 * 60 * 1000 });
        const userState = { activeStrategies: { 'BTC-USDT': strategy }, history: [] };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['user1']),
            loadUserState: vi.fn().mockReturnValue(userState),
        });

        await runLoopExit(ctx);

        expect(userState.activeStrategies['BTC-USDT']).toBeUndefined();
    });

    it('無持倉用戶不呼叫 saveUserState', async () => {
        const userState = { activeStrategies: {}, history: [] };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['user1']),
            loadUserState: vi.fn().mockReturnValue(userState),
        });

        await runLoopExit(ctx);

        expect(ctx.saveUserState).not.toHaveBeenCalled();
    });

    it('多用戶各自獨立處理，互不影響', async () => {
        const makeExpiredStrategy = (chatId) => makePaperStrategy({
            chatId,
            time: Date.now() - 49 * 60 * 60 * 1000,
        });

        const states = {
            user1: { activeStrategies: { 'BTC-USDT': makeExpiredStrategy('user1') }, history: [] },
            user2: { activeStrategies: { 'ETH-USDT': { ...makeExpiredStrategy('user2'), symbol: 'ETH-USDT' } }, history: [] },
        };

        const ctx = makeCtx({
            getAllUserChatIds: vi.fn().mockReturnValue(['user1', 'user2']),
            loadUserState: vi.fn((chatId) => states[chatId]),
        });

        await runLoopExit(ctx);

        expect(ctx.saveUserState).toHaveBeenCalledWith('user1', expect.anything());
        expect(ctx.saveUserState).toHaveBeenCalledWith('user2', expect.anything());
    });
});

// ─── Property-Based Tests ─────────────────────────────────────────────────────

// Feature: user-data-separation, Property 10: Loop C 出場記錄 round-trip
describe('Property 10: Loop C 出場記錄 round-trip', () => {
    /**
     * Validates: Requirements 8.2, 8.3
     *
     * For any 用戶的模擬倉出場事件，出場後呼叫 loadUserState(chatId).history，
     * 應包含該出場記錄（含 symbol、exitPrice、reason 等欄位）
     */
    it('出場後 history 包含完整出場記錄', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.record({
                    chatId: fc.stringMatching(/^[a-z0-9]{3,10}$/),
                    symbol: fc.constantFrom('BTC-USDT', 'ETH-USDT', 'SOL-USDT'),
                    entryPrice: fc.integer({ min: 10, max: 10000 }),
                    leverage: fc.integer({ min: 1, max: 20 }),
                    principal: fc.integer({ min: 1, max: 10 }),
                }),
                async ({ chatId, symbol, entryPrice, leverage, principal }) => {
                    const base = symbol.replace('-USDT', '');
                    const exitPrice = entryPrice * 1.05; // 5% 上漲

                    const strategy = {
                        symbol,
                        side: 'LONG',
                        entryPrice,
                        sl: entryPrice * 0.9,
                        tp1: entryPrice * 1.1,
                        tp2: entryPrice * 1.2,
                        tp3: entryPrice * 1.3,
                        chatId,
                        bingxQty: 0,
                        isPaper: true,
                        leverage,
                        principal,
                        // 超時觸發出場
                        time: Date.now() - 49 * 60 * 60 * 1000,
                    };

                    const userState = {
                        activeStrategies: { [symbol]: strategy },
                        history: [],
                    };

                    const ctx = makeCtx({
                        getAllUserChatIds: vi.fn().mockReturnValue([chatId]),
                        loadUserState: vi.fn().mockReturnValue(userState),
                        monitorPosition: vi.fn().mockResolvedValue({
                            price: exitPrice,
                            pnlPct: '5.00',
                        }),
                    });

                    await runLoopExit(ctx);

                    // history 應包含出場記錄
                    expect(userState.history.length).toBeGreaterThan(0);
                    const record = userState.history[0];
                    expect(record.symbol).toBe(base);
                    expect(record.side).toBe('LONG');
                    expect(record.entryPrice).toBe(entryPrice);
                    expect(record.exitPrice).toBe(exitPrice);
                    expect(record.chatId).toBe(chatId);
                    expect(record.reason).toBeTruthy();

                    // saveUserState 應被呼叫
                    expect(ctx.saveUserState).toHaveBeenCalledWith(
                        chatId,
                        expect.objectContaining({ history: expect.arrayContaining([record]) })
                    );
                }
            ),
            { numRuns: 50 }
        );
    });
});
