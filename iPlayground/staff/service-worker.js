"use strict";

var SERVICE_WORKER_VERSION = "2026-07-22.1";

function reportToClients(message) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage(Object.assign({ serviceWorkerVersion: SERVICE_WORKER_VERSION }, message));
    });
  });
}

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "IMS_DIAGNOSTIC_PING") return;
  if (event.source) {
    event.source.postMessage({
      type: "IMS_DIAGNOSTIC_PONG",
      serviceWorkerVersion: SERVICE_WORKER_VERSION,
      timestamp: new Date().toISOString()
    });
  }
});

self.addEventListener("push", function (event) {
  var receivedAt = new Date().toISOString();
  var fallback = {
    title: "IMS 任務提醒",
    body: "你的工作任務即將開始，請回到任務站確認。",
    url: "./"
  };
  var data = fallback;

  if (event.data) {
    try {
      data = Object.assign({}, fallback, event.data.json());
    } catch (error) {
      data = Object.assign({}, fallback, { body: event.data.text() });
    }
  }

  var notificationOptions = {
    body: data.body,
    icon: "assets/app-icon.svg",
    badge: "assets/app-icon.svg",
    tag: data.tag || "ims-task-reminder",
    renotify: true,
    data: { url: data.url || "./" }
  };

  var displayNotification = reportToClients({
    type: "IMS_PUSH_RECEIVED",
    receivedAt: receivedAt,
    title: data.title
  }).then(function () {
    return self.registration.showNotification(data.title, notificationOptions);
  }).then(function () {
    return self.registration.getNotifications({ tag: notificationOptions.tag });
  }).then(function (notifications) {
    return reportToClients({
      type: "IMS_NOTIFICATION_DISPLAYED",
      receivedAt: receivedAt,
      notificationCount: notifications.length
    });
  }).catch(function (error) {
    return reportToClients({
      type: "IMS_NOTIFICATION_ERROR",
      receivedAt: receivedAt,
      error: String(error && error.message || error || "未知錯誤")
    }).then(function () { throw error; });
  });

  event.waitUntil(displayNotification);
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL(event.notification.data.url || "./", self.location.href).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    var matchingClient = clients.find(function (client) { return client.url === target; });
    if (matchingClient) return matchingClient.focus();
    return self.clients.openWindow(target);
  }));
});
