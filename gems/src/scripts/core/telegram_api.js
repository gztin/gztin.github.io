/**
 * Telegram API 工具層
 * curl, sendMessage, sendDocument, sendPhoto, editMessage, deleteMessage
 */

import fs from 'fs';
import { execSync } from 'child_process';

// TOKEN 從外部傳入或從 env 讀取
// API_BASE is computed lazily so that loadEnv() in the main file runs first
export function getApiBase() { return `https://api.telegram.org/bot${process.env.TG_TOKEN || ''}`; }
// Convenience export that resolves to string in template literals
export const API_BASE = { toString() { return getApiBase(); }, valueOf() { return getApiBase(); } };

export const curlState = {
    lastStatus: null,
    lastStatusText: '',
    lastUrl: '',
};

export async function curl(url, options = {}) {
    const method = options.method || 'GET';
    const init = { method, headers: { 'User-Agent': 'Bot' } };
    if (options.body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = options.body;
    }
    // Long polling timeout: 30s (Telegram) + 15s (buffer) = 45s
    const maxTime = options.timeout || (url.includes('timeout=30') ? 45000 : 15000);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), maxTime);
    init.signal = controller.signal;

    // Retry logic for transient failures
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            curlState.lastStatus = null;
            curlState.lastStatusText = '';
            curlState.lastUrl = url;
            const res = await fetch(url, init);
            clearTimeout(id);
            if (!res.ok) {
                curlState.lastStatus = res.status;
                curlState.lastStatusText = res.statusText;
                console.error(`[CURL HTTP ERROR] ${res.status} ${res.statusText} on ${url}`);
                return null;
            }
            const text = await res.text();
            return text ? JSON.parse(text) : null;
        } catch (e) {
            clearTimeout(id);
            if (attempt < maxRetries) {
                console.warn(`[CURL RETRY] Attempt ${attempt + 1}/${maxRetries + 1} failed: ${e.message}. Retrying...`);
                // Wait a bit before retrying
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                // Reset the abort controller for the next attempt
                const newController = new AbortController();
                const newId = setTimeout(() => newController.abort(), maxTime);
                init.signal = newController.signal;
            } else {
                console.error(`[CURL EXCEPTION] ${e.name} - ${e.message} on ${url}`);
                return null;
            }
        }
    }
}

export async function sendMessage(id, text, options = {}) {
    const { replyMarkup = null, message_thread_id = null, parseMode = 'Markdown' } = options;
    const taggedText = text;
    console.log(`[SYS] Sending message to ${id}: ${text.substring(0, 50)}...`);
    try {
        const body = { chat_id: id, text: taggedText };
        if (parseMode) body.parse_mode = parseMode;
        if (replyMarkup) body.reply_markup = replyMarkup;
        if (message_thread_id) body.message_thread_id = message_thread_id;
        const res = await curl(`${API_BASE}/sendMessage`, { method: 'POST', body: JSON.stringify(body) });
        if (res?.ok) {
            console.log(`[SYS] Message sent successfully to ${id}`);
            return res;
        } else {
            console.error(`[SYS] Message sending failed to ${id}: ${JSON.stringify(res)}`);
            return null;
        }
    } catch (e) {
        console.error(`[SYS] Message sending exception to ${id}: ${e.message}`);
        return null;
    }
}

function markdownToDiscord(text = '') {
    return String(text)
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '**$1**')
        .replace(/\*([^*]+)\*/g, '**$1**');
}

export async function sendDiscordMessage(text, options = {}) {
    const webhookUrl = options.webhookUrl || process.env.DISCORD_WEBHOOK_URL || '';
    if (!webhookUrl) {
        console.warn('[DISCORD] DISCORD_WEBHOOK_URL is not set; skipping message.');
        return null;
    }

    const content = markdownToDiscord(text);
    const body = options.embeds
        ? { content: options.content || '', embeds: options.embeds }
        : { content: content.length > 2000 ? `${content.slice(0, 1990)}...` : content };
    if (options.username || process.env.DISCORD_USERNAME) {
        body.username = options.username || process.env.DISCORD_USERNAME;
    }
    const maskedWebhook = webhookUrl ? `${webhookUrl.slice(0, 36)}...${webhookUrl.slice(-8)}` : 'N/A';
    const sourceTag = options.sourceTag || 'unspecified';
    const preview = String(text || '').replace(/\s+/g, ' ').slice(0, 80);
    console.log(`[DISCORD] sending source=${sourceTag} webhook=${maskedWebhook} preview="${preview}"`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Bot' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
            console.error(`[DISCORD] Message failed: ${res.status} ${res.statusText}`);
            return null;
        }
        console.log('[DISCORD] Message sent successfully');
        return { ok: true };
    } catch (e) {
        clearTimeout(timeoutId);
        const reason = e.name === 'AbortError' ? 'timeout (10s)' : e.message;
        console.error(`[DISCORD] Message exception: ${reason}`);
        return null;
    }
}

import FormData from 'form-data';

export async function sendDocument(id, filePath, caption) {
    if (!fs.existsSync(filePath)) {
        console.error(`[SYS] File not found: ${filePath}`);
        return null;
    }

    console.log(`[SYS] Sending document ${filePath} to Telegram...`);
    const url = `${API_BASE}/sendDocument`;
    
    return new Promise((resolve) => {
        const form = new FormData();
        form.append('chat_id', id);
        form.append('document', fs.createReadStream(filePath));
        form.append('caption', caption || '');
        form.append('parse_mode', 'Markdown');

        form.submit(url, (err, res) => {
            if (err) {
                console.error(`[SYS] Error submitting form:`, err.message);
                resolve(null);
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.ok) {
                        console.log(`[SYS] Document sent successfully`);
                    } else {
                        console.error(`[SYS] Telegram API error:`, json);
                    }
                    resolve(json);
                } catch (e) {
                    console.error(`[SYS] Error parsing Telegram response:`, e.message);
                    resolve(null);
                }
            });
        });
    });
}

export async function sendPhoto(id, photoUrl, caption, options = {}) {
    const taggedCaption = caption;
    console.log(`[SYS] Sending photo URL to Telegram...`);
    return await curl(`${API_BASE}/sendPhoto`, {
        method: 'POST',
        body: JSON.stringify({ chat_id: id, photo: photoUrl, caption: taggedCaption, parse_mode: 'Markdown' })
    });
}

export async function editMessage(id, messageId, text) {
    // Don't add ENV_LABEL when editing - it was already added in the original message
    return await curl(`${API_BASE}/editMessageText`, { method: 'POST', body: JSON.stringify({ chat_id: id, message_id: messageId, text: text, parse_mode: 'Markdown' }) });
}

export async function deleteMessage(id, messageId) {
    return await curl(`${API_BASE}/deleteMessage`, { method: 'POST', body: JSON.stringify({ chat_id: id, message_id: messageId }) });
}
