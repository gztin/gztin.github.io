import fs from 'fs';
import path from 'path';

function getDataDir() {
    return process.env.DATA_DIR || 'data';
}

const DEFAULT_GLOBAL_STATE = {
    admins: [],
    whitelist: [],
    rankSnapshot: {},
    rankBestRank: {},
    scanCooldown: {},
    loopAPending: {},
    loopFPending: {},
    isRankRunning: false,
    lastUpdateId: 0,
};

const DEFAULT_USER_STATE = {
    chatId: '',
    activeStrategies: {},
    history: [],
    subscriptions: {},
    credentials: {
        apiKey: '',
        apiSecret: '',
        paperEnabled: true,
    },
    watchlist: {},
    waitingState: {},
};

function ensureDataDir() {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function defaultGlobalState() {
    return JSON.parse(JSON.stringify(DEFAULT_GLOBAL_STATE));
}

function defaultUserState(chatId = '') {
    const state = JSON.parse(JSON.stringify(DEFAULT_USER_STATE));
    state.chatId = chatId;
    return state;
}

/**
 * 讀取 data/state_global.json，不存在則建立預設值
 */
export function loadGlobalState() {
    ensureDataDir();
    const filePath = path.join(getDataDir(), 'state_global.json');
    try {
        if (!fs.existsSync(filePath)) {
            const state = defaultGlobalState();
            saveGlobalState(state);
            return state;
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error('[StateManager] loadGlobalState 失敗，回傳預設值:', err.message);
        return defaultGlobalState();
    }
}

/**
 * 原子寫入 data/state_global.json（tmp → rename）
 */
export function saveGlobalState(state) {
    ensureDataDir();
    const filePath = path.join(getDataDir(), 'state_global.json');
    const tmpPath = filePath + '.tmp';
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        console.error('[StateManager] saveGlobalState 失敗，保留暫存檔供人工復原:', err.message);
    }
}

/**
 * 讀取 data/state_{chatId}.json，不存在則建立預設值
 * 安全規則：若檔案內的 chatId 與請求的不符，拒絕讀取並回傳預設值
 */
export function loadUserState(chatId) {
    ensureDataDir();
    const filePath = path.join(getDataDir(), `state_${chatId}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            const state = defaultUserState(chatId);
            saveUserState(chatId, state);
            return state;
        }
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 隔離驗證：chatId 不符則拒絕，防止跨用戶資料存取
        if (parsed.chatId && String(parsed.chatId) !== String(chatId)) {
            console.error(`[StateManager] loadUserState 隔離拒絕：請求 ${chatId}，檔案內為 ${parsed.chatId}`);
            return defaultUserState(chatId);
        }
        return parsed;
    } catch (err) {
        console.error(`[StateManager] loadUserState(${chatId}) 失敗，回傳預設值:`, err.message);
        return defaultUserState(chatId);
    }
}

/**
 * 原子寫入 data/state_{chatId}.json（tmp → rename）
 * 安全規則：強制將 state.chatId 設為請求的 chatId，防止跨用戶寫入
 */
export function saveUserState(chatId, state) {
    ensureDataDir();
    // 強制覆蓋 chatId，確保資料歸屬正確
    state.chatId = String(chatId);
    const filePath = path.join(getDataDir(), `state_${chatId}.json`);
    const tmpPath = filePath + '.tmp';
    try {
        fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        console.error(`[StateManager] saveUserState(${chatId}) 失敗，保留暫存檔供人工復原:`, err.message);
    }
}

/**
 * 掃描 data/ 目錄，回傳所有 state_{chatId}.json 的 chatId 陣列
 */
export function getAllUserChatIds() {
    ensureDataDir();
    try {
        const files = fs.readdirSync(getDataDir());
        const chatIds = [];
        for (const file of files) {
            const match = file.match(/^state_(.+)\.json$/);
            if (match && match[1] !== 'global') {
                chatIds.push(match[1]);
            }
        }
        return chatIds;
    } catch (err) {
        console.error('[StateManager] getAllUserChatIds 失敗:', err.message);
        return [];
    }
}

/**
 * 讀取 data/bot_state.json，分拆全域與用戶資料，備份舊檔
 */
export function migrateFromLegacy() {
    ensureDataDir();
    const legacyPath = path.join(getDataDir(), 'bot_state.json');

    if (!fs.existsSync(legacyPath)) {
        console.log('[StateManager] migrateFromLegacy: data/bot_state.json 不存在，跳過遷移');
        return;
    }

    let legacy;
    try {
        const raw = fs.readFileSync(legacyPath, 'utf-8');
        legacy = JSON.parse(raw);
    } catch (err) {
        console.error('[StateManager] migrateFromLegacy 讀取舊檔失敗:', err.message);
        return;
    }

    // 分拆全域欄位
    const globalState = defaultGlobalState();
    if (legacy.admins !== undefined) globalState.admins = legacy.admins;
    if (legacy.whitelist !== undefined) globalState.whitelist = legacy.whitelist;
    if (legacy.rankSnapshot !== undefined) globalState.rankSnapshot = legacy.rankSnapshot;
    if (legacy.rankBestRank !== undefined) globalState.rankBestRank = legacy.rankBestRank;
    if (legacy.scanCooldown !== undefined) globalState.scanCooldown = legacy.scanCooldown;
    if (legacy.lastUpdateId !== undefined) globalState.lastUpdateId = legacy.lastUpdateId;
    if (legacy.isRankRunning !== undefined) globalState.isRankRunning = legacy.isRankRunning;
    saveGlobalState(globalState);

    // 分拆用戶資料（依 chatId 分組 activeStrategies）
    const activeStrategies = legacy.activeStrategies || {};
    const migratedChatIds = new Set();

    for (const [symbol, strategy] of Object.entries(activeStrategies)) {
        const chatId = strategy.chatId || strategy.userId || '';
        if (!chatId) continue;

        const userState = loadUserState(chatId);
        userState.chatId = chatId;
        userState.activeStrategies[symbol] = strategy;
        saveUserState(chatId, userState);
        migratedChatIds.add(chatId);
    }

    // 遷移其他用戶欄位（history、subscriptions、credentials、waitingState）
    const userFields = ['history', 'subscriptions', 'credentials', 'waitingState'];
    const userMap = legacy.users || {};
    for (const [chatId, userData] of Object.entries(userMap)) {
        const userState = loadUserState(chatId);
        userState.chatId = chatId;
        for (const field of userFields) {
            if (userData[field] !== undefined) {
                userState[field] = userData[field];
            }
        }
        saveUserState(chatId, userState);
        migratedChatIds.add(chatId);
    }

    // 備份舊檔
    const backupPath = legacyPath + '.bak';
    try {
        fs.renameSync(legacyPath, backupPath);
        console.log(`[StateManager] migrateFromLegacy 完成，已備份至 ${backupPath}，遷移 chatId: ${[...migratedChatIds].join(', ') || '(無)'}`);
    } catch (err) {
        console.error('[StateManager] migrateFromLegacy 備份舊檔失敗:', err.message);
    }
}
