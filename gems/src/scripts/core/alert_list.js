import fs from 'fs';
import path from 'path';

const ALERT_FILE = path.join(process.cwd(), 'data', 'alert_list.json');

/**
 * å–å¾—ç›®å‰çš„æ³¨æ„æ¸…å–®
 */
export function getAlertList() {
    if (!fs.existsSync(ALERT_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8'));
    } catch (e) {
        console.error('[ALERT] Read error:', e.message);
        return {};
    }
}

/**
 * æ›´æ–°æ³¨æ„æ¸…å–®
 */
export function saveAlertList(list) {
    try {
        const dir = path.dirname(ALERT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ALERT_FILE, JSON.stringify(list, null, 2));
    } catch (e) {
        console.error('[ALERT] Save error:', e.message);
    }
}

/**
 * å°‡å¹£ç¨®åŠ å…¥æ³¨æ„æ¸…å–®
 */
export function addToAlert(chatId, symbol, side, pnl) {
    const list = getAlertList();
    const key = `${chatId}_${symbol}_${side}`;
    if (!list[key]) {
        list[key] = { chatId, symbol, side, pnl, time: Date.now() };
        saveAlertList(list);
        return true;
    }
    return false;
}

/**
 * å¾æ³¨æ„æ¸…å–®ç§»é™¤
 */
export function removeFromAlert(chatId, symbol, side) {
    const list = getAlertList();
    const key = `${chatId}_${symbol}_${side}`;
    if (list[key]) {
        delete list[key];
        saveAlertList(list);
        return true;
    }
    return false;
}

/**
 * æª¢æŸ¥æ˜¯å¦åœ¨æ³¨æ„æ¸…å–®ä¸­
 */
export function isInAlert(chatId, symbol, side) {
    const list = getAlertList();
    const key = `${chatId}_${symbol}_${side}`;
    return !!list[key];
}

/**
 * ¦P¨B²M²z¡G²¾°£©Ò¦³¤£¦A¬¡ÅD«ù­Ü¤¤ªºÄµ§i (¨¾¤îíL«Í¼Æ¾Ú)
 */
export function syncAlertList(activeKeys) {
    const list = getAlertList();
    let changed = false;
    for (const key of Object.keys(list)) {
        if (!activeKeys.has(key)) {
            delete list[key];
            changed = true;
        }
    }
    if (changed) saveAlertList(list);
}
