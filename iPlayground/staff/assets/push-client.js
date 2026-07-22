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

  function endpointHost(subscription) {
    if (!subscription || !subscription.endpoint) return "尚未建立";
    try {
      return new URL(subscription.endpoint).host;
    } catch (error) {
      return "無法辨識";
    }
  }

  async function getRegistration(options) {
    var support = supportStatus();
    if (!support.supported) throw new Error(support.reason);
    var registration = await navigator.serviceWorker.register("./service-worker.js");
    if (!options || options.update !== false) {
      await registration.update().catch(function () {});
    }
    return navigator.serviceWorker.ready;
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
    var ready = await getRegistration();
    var existing = await ready.pushManager.getSubscription();
    if (existing) return existing;
    var remoteConfig = await requestJson("/api/config", { method: "GET", headers: {} });
    return ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(remoteConfig.vapidPublicKey)
    });
  }

  async function getDiagnostics() {
    var support = supportStatus();
    var result = {
      supported: support.supported,
      supportReason: support.reason,
      permission: "Notification" in window ? Notification.permission : "unsupported",
      serviceWorkerState: "尚未註冊",
      serviceWorkerScope: "—",
      endpointHost: "尚未建立",
      notificationCount: 0
    };
    if (!support.supported) return result;

    var registration = await navigator.serviceWorker.getRegistration("./service-worker.js");
    if (!registration) return result;
    await registration.update().catch(function () {});
    var ready = await navigator.serviceWorker.ready;
    var worker = ready.active || ready.waiting || ready.installing;
    var subscription = await ready.pushManager.getSubscription();
    var notifications = await ready.getNotifications();
    result.serviceWorkerState = worker ? worker.state : "狀態未知";
    result.serviceWorkerScope = ready.scope;
    result.endpointHost = endpointHost(subscription);
    result.notificationCount = notifications.length;
    if (worker) worker.postMessage({ type: "IMS_DIAGNOSTIC_PING" });
    return result;
  }

  async function runLocalNotificationTest() {
    var support = supportStatus();
    if (!support.supported) throw new Error(support.reason);
    var permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知權限未開啟");

    var registration = await getRegistration();
    var tag = "ims-local-test-" + Date.now();
    await registration.showNotification("IMS 本機通知測試", {
      body: "若你看到這則通知，代表 Chrome 與 macOS 的通知顯示功能正常。",
      tag: tag,
      renotify: true,
      requireInteraction: true,
      data: { url: window.location.href }
    });
    var notifications = await registration.getNotifications({ tag: tag });
    return {
      permission: permission,
      notificationCount: notifications.length,
      tag: tag
    };
  }

  function onDiagnosticMessage(listener) {
    if (!("serviceWorker" in navigator) || typeof listener !== "function") return function () {};
    function handler(event) {
      var data = event.data || {};
      if (String(data.type || "").indexOf("IMS_") === 0) listener(data);
    }
    navigator.serviceWorker.addEventListener("message", handler);
    return function () { navigator.serviceWorker.removeEventListener("message", handler); };
  }

  async function scheduleTestReminder(taskTitle, startsAt) {
    var subscription = await getSubscription();
    return requestJson("/api/test-reminder", {
      method: "POST",
      body: JSON.stringify({
        subscription: subscription.toJSON(),
        taskTitle: String(taskTitle || "").trim(),
        startsAt: startsAt
      })
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
    getDiagnostics: getDiagnostics,
    runLocalNotificationTest: runLocalNotificationTest,
    onDiagnosticMessage: onDiagnosticMessage,
    scheduleTestReminder: scheduleTestReminder,
    cancelTestReminder: cancelTestReminder
  };
})();
