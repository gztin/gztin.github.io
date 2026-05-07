import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const PARAMS_PATH = path.join(DATA_DIR, 'strategy_params.json');
const EVENTS_PATH = path.join(DATA_DIR, 'tuning_events.json');

export const DEFAULT_STRATEGY_PARAMS = {
    loopA: {
        stage1Threshold: 6,
        rsi4hLongMin: 56,
        rsi4hShortMax: 45,
        rsi1hLongMin: 52,
        rsi1hShortMax: 48,
        volumeMultiplier: 1.4,
        slMaxPct: 4,
    },
    risk: {
        attentionLossRoe: -15,
        forceCloseLossRoe: -25,
        timeoutLossPct: 9,
    },
    meta: {
        version: 1,
        updatedAt: null,
        updatedBy: 'system',
        reason: 'default guarded runtime parameters',
    },
};

export const TUNING_POLICY = {
    loopA: {
        stage1Threshold: { min: 5, max: 8, step: 1, cooldownMs: 6 * 60 * 60 * 1000 },
        rsi4hLongMin: { min: 52, max: 62, step: 1, cooldownMs: 6 * 60 * 60 * 1000 },
        rsi4hShortMax: { min: 38, max: 48, step: 1, cooldownMs: 6 * 60 * 60 * 1000 },
        rsi1hLongMin: { min: 50, max: 58, step: 1, cooldownMs: 6 * 60 * 60 * 1000 },
        rsi1hShortMax: { min: 42, max: 50, step: 1, cooldownMs: 6 * 60 * 60 * 1000 },
        volumeMultiplier: { min: 1.2, max: 2.0, step: 0.1, cooldownMs: 6 * 60 * 60 * 1000 },
        slMaxPct: { min: 2.5, max: 5, step: 0.5, cooldownMs: 6 * 60 * 60 * 1000 },
    },
    risk: {
        attentionLossRoe: { min: -20, max: -10, step: 1, cooldownMs: 24 * 60 * 60 * 1000, manualApproval: true },
        forceCloseLossRoe: { min: -30, max: -20, step: 1, cooldownMs: 24 * 60 * 60 * 1000, manualApproval: true },
        timeoutLossPct: { min: 5, max: 12, step: 1, cooldownMs: 24 * 60 * 60 * 1000, manualApproval: true },
    },
};

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function mergeDefaults(params) {
    return {
        loopA: { ...DEFAULT_STRATEGY_PARAMS.loopA, ...(params.loopA || {}) },
        risk: { ...DEFAULT_STRATEGY_PARAMS.risk, ...(params.risk || {}) },
        meta: { ...DEFAULT_STRATEGY_PARAMS.meta, ...(params.meta || {}) },
    };
}

export function loadStrategyParams() {
    ensureDataDir();
    if (!fs.existsSync(PARAMS_PATH)) {
        saveStrategyParams(DEFAULT_STRATEGY_PARAMS);
        return structuredClone(DEFAULT_STRATEGY_PARAMS);
    }

    try {
        return mergeDefaults(JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8')));
    } catch (e) {
        console.error(`[StrategyParams] 讀取失敗，使用預設值: ${e.message}`);
        return structuredClone(DEFAULT_STRATEGY_PARAMS);
    }
}

export function saveStrategyParams(params) {
    ensureDataDir();
    fs.writeFileSync(PARAMS_PATH, JSON.stringify(mergeDefaults(params), null, 2), 'utf8');
}

export function getStrategyParam(section, key) {
    const params = loadStrategyParams();
    return params?.[section]?.[key] ?? DEFAULT_STRATEGY_PARAMS?.[section]?.[key];
}

function readTuningEvents() {
    ensureDataDir();
    if (!fs.existsSync(EVENTS_PATH)) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeTuningEvents(events) {
    ensureDataDir();
    fs.writeFileSync(EVENTS_PATH, JSON.stringify(events.slice(-200), null, 2), 'utf8');
}

function roundToStep(value, step) {
    const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
    return Number((Math.round(value / step) * step).toFixed(decimals));
}

function validateChange(section, key, current, next, events, now) {
    const policy = TUNING_POLICY?.[section]?.[key];
    if (!policy) return { ok: false, reason: 'not in tuning policy' };
    if (policy.manualApproval) return { ok: false, reason: 'manual approval required' };
    if (next < policy.min || next > policy.max) return { ok: false, reason: `outside range ${policy.min}-${policy.max}` };
    const delta = Math.abs(next - current);
    if (delta <= 0) return { ok: false, reason: 'no effective change' };
    if (delta > policy.step + Number.EPSILON) return { ok: false, reason: `step too large, max ${policy.step}` };

    const last = [...events].reverse().find(e => e.section === section && e.param === key && e.status === 'applied');
    if (last && now - new Date(last.changedAt).getTime() < policy.cooldownMs) {
        return { ok: false, reason: 'cooldown active' };
    }

    return { ok: true };
}

export function applyTuningChanges({ targetLoop = 'loopA', paramChanges = {}, summary = '', source = 'engineer' }) {
    const params = loadStrategyParams();
    const events = readTuningEvents();
    const now = Date.now();
    const changedAt = new Date(now).toISOString();
    const applied = [];
    const rejected = [];

    if (!TUNING_POLICY[targetLoop]) {
        return {
            applied,
            rejected: Object.entries(paramChanges || {}).map(([key, change]) => ({
                section: targetLoop,
                param: key,
                requested: change?.to,
                reason: 'target loop is not tunable',
            })),
            paramsPath: PARAMS_PATH,
            eventsPath: EVENTS_PATH,
        };
    }

    for (const [key, change] of Object.entries(paramChanges || {})) {
        const section = targetLoop;
        const policy = TUNING_POLICY?.[section]?.[key];
        if (!policy) {
            rejected.push({ section, param: key, requested: change?.to, reason: 'not in tuning policy' });
            continue;
        }

        const current = Number(params[section][key]);
        const requested = Number(change.to);
        const next = roundToStep(requested, policy.step);
        const check = validateChange(section, key, current, next, events, now);
        if (!check.ok) {
            rejected.push({ section, param: key, from: current, requested, reason: check.reason });
            continue;
        }

        params[section][key] = next;
        applied.push({ section, param: key, from: current, to: next });
    }

    if (applied.length > 0) {
        params.meta = {
            ...(params.meta || {}),
            updatedAt: changedAt,
            updatedBy: source,
            reason: summary,
        };
        saveStrategyParams(params);
    }

    const newEvents = [
        ...events,
        ...applied.map(change => ({
            id: `${changedAt}_${change.section}_${change.param}`,
            changedAt,
            status: 'applied',
            source,
            summary,
            before: null,
            after: null,
            ...change,
        })),
        ...rejected.filter(change => change.reason !== 'no effective change').map(change => ({
            id: `${changedAt}_${change.section}_${change.param}_rejected`,
            changedAt,
            status: 'rejected',
            source,
            summary,
            ...change,
        })),
    ];
    writeTuningEvents(newEvents);

    return { applied, rejected, paramsPath: PARAMS_PATH, eventsPath: EVENTS_PATH };
}
