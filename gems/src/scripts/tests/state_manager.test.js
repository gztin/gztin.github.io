import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import once — DATA_DIR is read at call time via process.env.DATA_DIR
import {
    loadGlobalState,
    saveGlobalState,
    loadUserState,
    saveUserState,
    getAllUserChatIds,
    migrateFromLegacy,
} from '../state_manager.js';

let tmpDir;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm_test_'));
    process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
});

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('StateManager - Unit Tests', () => {
    describe('loadGlobalState', () => {
        it('檔案不存在時回傳預設值（需求 1.2）', () => {
            const state = loadGlobalState();
            expect(state.admins).toEqual([]);
            expect(state.whitelist).toEqual([]);
            expect(state.rankSnapshot).toEqual({});
            expect(state.rankBestRank).toEqual({});
            expect(state.scanCooldown).toEqual({});
            expect(state.isRankRunning).toBe(false);
            expect(state.lastUpdateId).toBe(0);
        });

        it('損壞 JSON 時不拋出例外，回傳預設值（需求 1.3）', () => {
            fs.writeFileSync(path.join(tmpDir, 'state_global.json'), 'NOT_VALID_JSON', 'utf-8');
            expect(() => loadGlobalState()).not.toThrow();
            const state = loadGlobalState();
            expect(state.admins).toEqual([]);
        });
    });

    describe('loadUserState', () => {
        it('檔案不存在時回傳預設值（需求 2.2）', () => {
            const state = loadUserState('user123');
            expect(state.chatId).toBe('user123');
            expect(state.activeStrategies).toEqual({});
            expect(state.history).toEqual([]);
            expect(state.subscriptions).toEqual({});
            expect(state.credentials.apiKey).toBe('');
            expect(state.credentials.apiSecret).toBe('');
            expect(state.credentials.paperEnabled).toBe(false);
            expect(state.waitingState).toEqual({});
        });

        it('損壞 JSON 時不拋出例外，回傳預設值（需求 2.3）', () => {
            fs.writeFileSync(path.join(tmpDir, 'state_user999.json'), '{broken json', 'utf-8');
            expect(() => loadUserState('user999')).not.toThrow();
            const state = loadUserState('user999');
            expect(state.chatId).toBe('user999');
        });
    });

    describe('migrateFromLegacy', () => {
        it('bot_state.json 不存在時不拋出例外（需求 4.5）', () => {
            expect(() => migrateFromLegacy()).not.toThrow();
        });

        it('遷移完成後 bot_state.json.bak 存在（需求 4.4）', () => {
            const legacyData = {
                admins: ['admin1'],
                whitelist: [],
                rankSnapshot: {},
                rankBestRank: {},
                scanCooldown: {},
                lastUpdateId: 5,
                isRankRunning: false,
                activeStrategies: {},
            };
            fs.writeFileSync(path.join(tmpDir, 'bot_state.json'), JSON.stringify(legacyData), 'utf-8');
            migrateFromLegacy();
            expect(fs.existsSync(path.join(tmpDir, 'bot_state.json.bak'))).toBe(true);
            expect(fs.existsSync(path.join(tmpDir, 'bot_state.json'))).toBe(false);
        });
    });
});

// ─── Property-Based Tests ─────────────────────────────────────────────────────

describe('StateManager - Property Tests', () => {
    // Feature: user-data-separation, Property 1: 全域狀態 round-trip
    // Validates: Requirements 1.1, 1.4, 1.5
    it('Property 1: saveGlobalState → loadGlobalState 應回傳深度相等的物件', () => {
        // Use integer-based floats to avoid JSON serialization edge cases (-0, Infinity, -Infinity)
        const safeFloatArb = fc.integer({ min: -1000000, max: 1000000 }).map(n => n / 100);
        const globalStateArb = fc.record({
            admins: fc.array(fc.string()),
            whitelist: fc.array(fc.string()),
            rankSnapshot: fc.dictionary(fc.string(), fc.record({
                rank: fc.integer(),
                change: safeFloatArb,
                price: safeFloatArb,
            })),
            rankBestRank: fc.dictionary(fc.string(), fc.integer()),
            scanCooldown: fc.dictionary(fc.string(), fc.integer()),
            isRankRunning: fc.boolean(),
            lastUpdateId: fc.integer({ min: 0 }),
        });

        fc.assert(
            fc.property(globalStateArb, (state) => {
                saveGlobalState(state);
                const loaded = loadGlobalState();
                expect(loaded).toEqual(state);
            }),
            { numRuns: 100 }
        );
    });

    // Feature: user-data-separation, Property 2: 用戶狀態 round-trip
    // Validates: Requirements 2.1, 2.4, 2.5
    it('Property 2: saveUserState → loadUserState 應回傳深度相等的物件', () => {
        const chatIdArb = fc.string({ minLength: 1, maxLength: 20 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s));
        const credentialsArb = fc.record({
            apiKey: fc.string(),
            apiSecret: fc.string(),
            paperEnabled: fc.boolean(),
        });
        // Use integer-based floats to avoid JSON serialization edge cases (-0, Infinity, -Infinity)
        const safeFloatArb = fc.integer({ min: -1000000, max: 1000000 }).map(n => n / 100);
        const userStateArb = (chatId) => fc.record({
            chatId: fc.constant(chatId),
            activeStrategies: fc.dictionary(
                fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s)),
                fc.record({ symbol: fc.string() })
            ),
            history: fc.array(fc.record({
                symbol: fc.string(),
                exitPrice: safeFloatArb,
            })),
            subscriptions: fc.dictionary(fc.string(), fc.boolean()),
            credentials: credentialsArb,
            waitingState: fc.dictionary(fc.string(), fc.string()),
        });

        fc.assert(
            fc.property(chatIdArb, (chatId) => {
                fc.assert(
                    fc.property(userStateArb(chatId), (state) => {
                        saveUserState(chatId, state);
                        const loaded = loadUserState(chatId);
                        expect(loaded).toEqual(state);
                    }),
                    { numRuns: 10 }
                );
            }),
            { numRuns: 10 }
        );
    });

    // Feature: user-data-separation, Property 3: getAllUserChatIds 包含所有已儲存用戶
    // Validates: Requirements 2.6
    it('Property 3: 對每個 chatId 呼叫 saveUserState 後，getAllUserChatIds 應包含所有 chatId', () => {
        // Use lowercase-only chatIds to avoid case-insensitive filesystem collisions on Windows
        const chatIdArb = fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-z0-9]+$/.test(s));

        fc.assert(
            fc.property(fc.uniqueArray(chatIdArb, { minLength: 1, maxLength: 5 }), (chatIds) => {
                // Clean up state files from previous iteration
                for (const f of fs.readdirSync(tmpDir)) {
                    if (f.startsWith('state_')) fs.unlinkSync(path.join(tmpDir, f));
                }

                const baseState = {
                    activeStrategies: {},
                    history: [],
                    subscriptions: {},
                    credentials: { apiKey: '', apiSecret: '', paperEnabled: false },
                    waitingState: {},
                };
                for (const chatId of chatIds) {
                    saveUserState(chatId, { ...baseState, chatId });
                }
                const ids = getAllUserChatIds();
                for (const chatId of chatIds) {
                    expect(ids).toContain(chatId);
                }
            }),
            { numRuns: 100 }
        );
    });

    // Feature: user-data-separation, Property 4: 原子寫入後無暫存檔殘留
    // Validates: Requirements 3.1, 3.2
    it('Property 4: saveUserState / saveGlobalState 完成後 .tmp 暫存檔不應存在', () => {
        const chatIdArb = fc.string({ minLength: 1, maxLength: 15 }).filter(s => /^[a-zA-Z0-9]+$/.test(s));

        fc.assert(
            fc.property(chatIdArb, (chatId) => {
                const state = {
                    chatId,
                    activeStrategies: {},
                    history: [],
                    subscriptions: {},
                    credentials: { apiKey: '', apiSecret: '', paperEnabled: false },
                    waitingState: {},
                };
                saveUserState(chatId, state);
                expect(fs.existsSync(path.join(tmpDir, `state_${chatId}.json.tmp`))).toBe(false);

                const globalState = {
                    admins: [],
                    whitelist: [],
                    rankSnapshot: {},
                    rankBestRank: {},
                    scanCooldown: {},
                    isRankRunning: false,
                    lastUpdateId: 0,
                };
                saveGlobalState(globalState);
                expect(fs.existsSync(path.join(tmpDir, 'state_global.json.tmp'))).toBe(false);
            }),
            { numRuns: 100 }
        );
    });

    // Feature: user-data-separation, Property 5: 遷移完整性
    // Validates: Requirements 4.2, 4.3, 4.6
    it('Property 5: migrateFromLegacy 後每個 chatId 的 activeStrategies 應與舊檔相同', () => {
        const chatIdArb = fc.string({ minLength: 1, maxLength: 10 }).filter(s => /^[a-zA-Z0-9]+$/.test(s));
        const symbolArb = fc.string({ minLength: 1, maxLength: 8 }).filter(s => /^[A-Z0-9]+$/.test(s));

        fc.assert(
            fc.property(
                fc.uniqueArray(chatIdArb, { minLength: 1, maxLength: 3 }),
                fc.uniqueArray(symbolArb, { minLength: 1, maxLength: 3 }),
                (chatIds, symbols) => {
                    // Clean up all state files
                    for (const f of fs.readdirSync(tmpDir)) {
                        fs.unlinkSync(path.join(tmpDir, f));
                    }

                    // Build legacy activeStrategies: assign symbols round-robin to chatIds
                    const activeStrategies = {};
                    symbols.forEach((symbol, i) => {
                        const chatId = chatIds[i % chatIds.length];
                        activeStrategies[symbol] = { symbol, chatId, isPaper: false };
                    });

                    const legacyData = {
                        admins: [],
                        whitelist: [],
                        rankSnapshot: {},
                        rankBestRank: {},
                        scanCooldown: {},
                        lastUpdateId: 0,
                        isRankRunning: false,
                        activeStrategies,
                    };
                    fs.writeFileSync(path.join(tmpDir, 'bot_state.json'), JSON.stringify(legacyData), 'utf-8');

                    migrateFromLegacy();

                    // Verify each chatId has the correct strategies
                    for (const [symbol, strategy] of Object.entries(activeStrategies)) {
                        const chatId = strategy.chatId;
                        const userState = loadUserState(chatId);
                        expect(userState.activeStrategies[symbol]).toEqual(strategy);
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});
