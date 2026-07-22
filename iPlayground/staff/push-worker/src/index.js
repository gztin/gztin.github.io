import webpush from "web-push";

const REMINDER_LEAD_MS = 2 * 60 * 1000;
const MAX_TEST_START_DELAY_MS = 30 * 60 * 1000;
const TEST_TARGET_URL = "https://gztin.github.io/iPlayground/staff/reminder-test.html";

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, extraHeaders || {})
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function validBrowserRequest(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || origin === env.ALLOWED_ORIGIN;
}

async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function validateSubscription(subscription) {
  return subscription &&
    typeof subscription.endpoint === "string" &&
    subscription.endpoint.startsWith("https://") &&
    subscription.keys &&
    typeof subscription.keys.p256dh === "string" &&
    typeof subscription.keys.auth === "string";
}

function normalizeTaskTitle(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 60);
}

async function saveTestReminder(request, env) {
  const input = await request.json().catch(() => null);
  if (!input || !validateSubscription(input.subscription)) {
    return { errorResponse: json({ error: "訂閱資料格式不正確" }, 400) };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const startsAtMs = Date.parse(input.startsAt);
  if (!Number.isFinite(startsAtMs)) {
    return { errorResponse: json({ error: "任務開始時間格式不正確" }, 400) };
  }
  const sendAtMs = startsAtMs - REMINDER_LEAD_MS;
  if (sendAtMs <= now.getTime()) {
    return { errorResponse: json({ error: "提醒時間已過，請重新整理頁面" }, 400) };
  }
  if (startsAtMs > now.getTime() + MAX_TEST_START_DELAY_MS) {
    return { errorResponse: json({ error: "測試任務開始時間超出允許範圍" }, 400) };
  }
  const sendAt = new Date(sendAtMs).toISOString();
  const startsAt = new Date(startsAtMs).toISOString();
  const subscription = input.subscription;
  const taskTitle = normalizeTaskTitle(input.taskTitle);
  const notificationBody = taskTitle
    ? `${taskTitle}工作即將在兩分鐘後開始`
    : "任務即將於兩分鐘後開始";
  const id = await subscriptionId(subscription.endpoint);

  await env.REMINDERS.prepare(`
    INSERT INTO subscriptions (id, endpoint, p256dh, auth, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = excluded.updated_at
  `).bind(id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, nowIso, nowIso).run();

  await env.REMINDERS.prepare(
    "DELETE FROM reminders WHERE subscription_id = ? AND kind = 'test' AND status = 'pending'"
  ).bind(id).run();

  const reminderId = crypto.randomUUID();

  await env.REMINDERS.prepare(`
    INSERT INTO reminders (id, subscription_id, kind, send_at, title, body, target_url, status, created_at)
    VALUES (?, ?, 'test', ?, ?, ?, ?, 'pending', ?)
  `).bind(
    reminderId,
    id,
    sendAt,
    "iPlayground 任務通知",
    notificationBody,
    TEST_TARGET_URL,
    nowIso
  ).run();

  return { reminderId, sendAt, startsAt };
}

async function cancelTestReminder(request, env) {
  const input = await request.json().catch(() => null);
  if (!input || typeof input.endpoint !== "string") return json({ error: "缺少訂閱 endpoint" }, 400);
  const id = await subscriptionId(input.endpoint);
  await env.REMINDERS.prepare(
    "DELETE FROM reminders WHERE subscription_id = ? AND kind = 'test' AND status = 'pending'"
  ).bind(id).run();
  return json({ ok: true });
}

async function claimAndSendReminder(env, reminderId) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  const claimed = await env.REMINDERS.prepare(`
    UPDATE reminders
    SET status = 'sending', error = NULL
    WHERE id = ? AND status = 'pending'
  `).bind(reminderId).run();

  if (!claimed.success || claimed.meta?.changes !== 1) return false;

  const reminder = await env.REMINDERS.prepare(`
    SELECT reminders.*, subscriptions.endpoint, subscriptions.p256dh, subscriptions.auth
    FROM reminders
    JOIN subscriptions ON subscriptions.id = reminders.subscription_id
    WHERE reminders.id = ? AND reminders.status = 'sending'
  `).bind(reminderId).first();

  if (!reminder) return false;

  const subscription = {
    endpoint: reminder.endpoint,
    keys: { p256dh: reminder.p256dh, auth: reminder.auth }
  };
  const payload = JSON.stringify({
    title: reminder.title,
    body: reminder.body,
    url: reminder.target_url,
    tag: "ims-" + reminder.id
  });

  try {
    await webpush.sendNotification(subscription, payload, { TTL: 300, urgency: "high" });
    await env.REMINDERS.prepare(
      "UPDATE reminders SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?"
    ).bind(new Date().toISOString(), reminder.id).run();
  } catch (error) {
    const expired = error && (error.statusCode === 404 || error.statusCode === 410);
    await env.REMINDERS.prepare(
      "UPDATE reminders SET status = 'failed', error = ? WHERE id = ?"
    ).bind(String(error && error.message || "Push delivery failed").slice(0, 500), reminder.id).run();
    if (expired) {
      await env.REMINDERS.prepare("DELETE FROM subscriptions WHERE id = ?").bind(reminder.subscription_id).run();
    }
    throw error;
  }

  return true;
}

async function sendDueReminders(env) {
  const due = await env.REMINDERS.prepare(`
    SELECT id
    FROM reminders
    WHERE status = 'pending' AND send_at <= ?
    ORDER BY send_at
    LIMIT 50
  `).bind(new Date().toISOString()).all();

  for (const reminder of due.results || []) {
    try {
      await claimAndSendReminder(env, reminder.id);
    } catch (error) {
      console.error("Push delivery failed", reminder.id, error);
    }
  }

  await env.REMINDERS.prepare(
    "DELETE FROM reminders WHERE status != 'pending' AND created_at < ?"
  ).bind(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).run();
}

export default {
  async fetch(request, env, ctx) {
    if (!validBrowserRequest(request, env)) return json({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, env);

    const url = new URL(request.url);
    let response;
    if (request.method === "GET" && url.pathname === "/api/health") {
      response = json({ ok: true, service: "iplayground-reminders" });
    } else if (request.method === "GET" && url.pathname === "/api/config") {
      response = json({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
    } else if (request.method === "POST" && url.pathname === "/api/test-reminder") {
      const scheduled = await saveTestReminder(request, env);
      if (scheduled.errorResponse) {
        response = scheduled.errorResponse;
      } else {
        response = json({ ok: true, sendAt: scheduled.sendAt, startsAt: scheduled.startsAt });
      }
    } else if (request.method === "DELETE" && url.pathname === "/api/test-reminder") {
      response = await cancelTestReminder(request, env);
    } else {
      response = json({ error: "Not found" }, 404);
    }
    return withCors(response, request, env);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
  }
};
