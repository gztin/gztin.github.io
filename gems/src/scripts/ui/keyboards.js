/**
 * Telegram 鍵盤定義
 *
 * 層級結構：
 *   MAIN → TOOLS → SIMTRADE
 *                → ADMIN（管理員）
 */

export const KEYBOARDS = {

    // ── 第一層：主選單 ────────────────────────────────────────
    // 所有用戶可見；管理員額外顯示「進階操作」
    MAIN: (isAdmin) => {
        const buttons = [
            [{ text: '📊 幣種分析' },  { text: '🔭 幣種追蹤' }],
            [{ text: '📋 追蹤列表' },  { text: '📈 排行榜' }],
            [{ text: '❌ 取消追蹤' },  { text: '📜 版本資訊' }],
        ];
        if (isAdmin) {
            buttons.push([{ text: '⚙️ 進階操作' }]);
        }
        return { keyboard: buttons, resize_keyboard: true, persistent: true };
    },

    MAIN_INLINE: (isAdmin) => {
        const rows = [
            [
                { text: '📊 幣種分析', callback_data: 'menu_check' },
                { text: '🔭 幣種追蹤', callback_data: 'menu_trace' },
            ],
            [
                { text: '📋 追蹤列表', callback_data: 'menu_list' },
                { text: '📈 排行榜', callback_data: 'menu_rank' },
            ],
            [
                { text: '❌ 取消追蹤', callback_data: 'menu_clean' },
                { text: '📜 版本資訊', callback_data: 'menu_version' },
            ],
        ];
        if (isAdmin) rows.push([{ text: '⚙️ 進階操作', callback_data: 'menu_tools' }]);
        return { inline_keyboard: rows };
    },

    // ── 第二層：工具選單 ──────────────────────────────────────
    // 管理員點擊「進階操作」後進入
    TOOLS: (isAdmin) => ({
        keyboard: [
            [{ text: '🎮 模擬交易' }],
            [{ text: '🛡️ 管理者功能' }],
            [{ text: '⬅️ 返回主選單' }],
        ],
        resize_keyboard: true,
        persistent: true,
    }),

    TOOLS_INLINE: () => ({
        inline_keyboard: [
            [{ text: '🎮 模擬交易', callback_data: 'tools_simtrade' }],
            [{ text: '🛡️ 管理者功能', callback_data: 'tools_admin' }],
            [{ text: '⬅️ 返回主選單', callback_data: 'tools_back_main' }],
        ],
    }),

    // ── 第三層：模擬交易選單 ──────────────────────────────────
    // 顯示 API 連線狀態、模擬倉狀態、資料操作
    // hasApiKey: BingX API 是否已設定
    // hasPaperConn: 模擬倉是否已連線
    SIMTRADE: (hasApiKey, hasPaperConn) => {
        const apiLabel    = hasApiKey
            ? '🟢 串接 API（運作中）'
            : '🔴 串接 API（無資料）';
        const paperLabel  = hasPaperConn
            ? '🟢 模擬倉（已連線）'
            : '🔴 連結模擬倉';

        return {
            keyboard: [
                [{ text: apiLabel }, { text: paperLabel }],
                [{ text: '📶 API 額度查詢' }],
                [{ text: '📤 數據匯出' },  { text: '📊 持倉資訊' }],
                [{ text: '⬅️ 返回工具選單' }, { text: '🧹 清除紀錄' }],
            ],
            resize_keyboard: true,
            persistent: true,
        };
    },

    SIMTRADE_INLINE: (hasApiKey, hasPaperConn) => {
        return {
            inline_keyboard: [
                [{ text: '📶 API 額度查詢', callback_data: 'simtrade_quota' }],
                [
                    { text: '📤 數據匯出', callback_data: 'simtrade_export' },
                    { text: '📊 持倉資訊', callback_data: 'simtrade_positions' },
                ],
                [
                    { text: '⬅️ 返回工具選單', callback_data: 'simtrade_back_tools' },
                    { text: '🧹 清除紀錄', callback_data: 'simtrade_prune' },
                ],
            ],
        };
    },

    // ── 第三層：管理員選單 ────────────────────────────────────
    ADMIN: () => ({
        keyboard: [
            [{ text: '🤖 設定BOT資料' }],
            [{ text: '⬅️ 返回工具選單' }],
        ],
        resize_keyboard: true,
        persistent: true,
    }),

    ADMIN_INLINE: () => ({
        inline_keyboard: [
            [{ text: '🤖 設定BOT資料', callback_data: 'admin_bot_settings' }],
            [{ text: '⬅️ 返回工具選單', callback_data: 'admin_back_tools' }],
        ],
    }),

    BOT_SETTINGS: (hasApiKey, hasPaperConn, hasPositionConn) => {
        const channelLabel = '🆔 設定 Channel ID';
        const paperLabel = hasPaperConn ? '🟢 串接模擬倉（已連線）' : '🔴 串接模擬倉（未連線）';
        const apiLabel = hasApiKey ? '🟢 串接API（已設定）' : '🔴 串接API（未設定）';
        const positionLabel = hasPositionConn ? '🟢 連線倉位（開啟）' : '⚪ 連線倉位（關閉）';
        return {
            keyboard: [
                [{ text: channelLabel }],
                [{ text: paperLabel }],
                [{ text: apiLabel }],
                [{ text: positionLabel }],
                [{ text: '⬅️ 返回管理者功能' }],
            ],
            resize_keyboard: true,
            persistent: true,
        };
    },

    BOT_SETTINGS_INLINE: (hasApiKey, hasPaperConn, hasPositionConn) => {
        const channelLabel = '🆔 設定 Channel ID';
        const paperLabel = hasPaperConn ? '🟢 串接模擬倉（已連線）' : '🔴 串接模擬倉（未連線）';
        const apiLabel = hasApiKey ? '🟢 串接API（已設定）' : '🔴 串接API（未設定）';
        const positionLabel = hasPositionConn ? '🟢 連線倉位（開啟）' : '⚪ 連線倉位（關閉）';
        return {
            inline_keyboard: [
                [{ text: channelLabel, callback_data: 'bot_settings_channel' }],
                [{ text: paperLabel, callback_data: hasPaperConn ? 'bot_settings_paper_off' : 'bot_settings_paper_on' }],
                [{ text: apiLabel, callback_data: 'bot_settings_api' }],
                [{ text: positionLabel, callback_data: hasPositionConn ? 'bot_settings_position_off' : 'bot_settings_position_on' }],
                [{ text: '⬅️ 返回管理者功能', callback_data: 'bot_settings_back' }],
            ],
        };
    },

    // ── Inline：分析完幣種後出現 ──────────────────────────────
    SYMBOL_ACTIONS: (symbol) => ({
        inline_keyboard: [
            [{ text: `🔭 立即追蹤 ${symbol}`, callback_data: `trace_${symbol}` }],
            [{ text: '🔄 重新分析', callback_data: `check_${symbol}` }],
        ],
    }),
};
