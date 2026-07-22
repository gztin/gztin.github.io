(function () {
  "use strict";

  var config = window.IPLAYGROUND_PUSH_CONFIG || {};

  function normalizedApiBase() {
    return String(config.apiBase || "").trim().replace(/\/$/, "");
  }

  function urlBase64ToUint8Array(value) {
    var padding = "=".repeat((4 - value.length % 4) % 4);
    var base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(base64);
    return Uint8Array.from(raw, function (character) { return character.charCodeAt(0); });
  }

  function supportStatus() {
    var isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS && !navigator.standalone) {
      return { supported: false, reason: "請先用 Safari 將網站加入主畫面，再從主畫面開啟 IMS" };
    }
    if (!("serviceWorker" in navigator)) return { supported: false, reason: "此瀏覽器不支援 Service Worker" };
    if (!("PushManager" in window)) return { supported: false, reason: "此瀏覽器不支援 Web Push" };
    if (!("Notification" in window)) return { supported: false, reason: "此瀏覽器不支援系統通知" };
    return { supported: true, reason: "" };
  }

  async function requestJson(path, options) {
    var apiBase = normalizedApiBase();
    if (!apiBase) throw new Error("尚未設定 Cloudflare Worker 網址");
    var response = await fetch(apiBase + path, Object.assign({
      headers: { "Content-Type": "application/json" }
    }, options || {}));
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.error || "推播服務暫時無法使用");
    return payload;
  }

  async function getSubscription() {
    var support = supportStatus();
    if (!support.supported) throw new Error(support.reason);
    var permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知權限未開啟");
    await navigator.serviceWorker.register("./service-worker.js");
    var ready = await navigator.serviceWorker.ready;
    var existing = await ready.pushManager.getSubscription();
    if (existing) return existing;
    var remoteConfig = await requestJson("/api/config", { method: "GET", headers: {} });
    return ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(remoteConfig.vapidPublicKey)
    });
  }

  async function scheduleTestReminder() {
    var subscription = await getSubscription();
    return requestJson("/api/test-reminder", {
      method: "POST",
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
  }

  async function cancelTestReminder() {
    var support = supportStatus();
    if (!support.supported || !normalizedApiBase()) return;
    var registration = await navigator.serviceWorker.getRegistration("./service-worker.js");
    if (!registration) return;
    var subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await requestJson("/api/test-reminder", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
  }

  window.PushReminder = {
    isConfigured: function () { return Boolean(normalizedApiBase()); },
    supportStatus: supportStatus,
    scheduleTestReminder: scheduleTestReminder,
    cancelTestReminder: cancelTestReminder
  };
})();
