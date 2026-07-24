"use strict";

var SERVICE_WORKER_VERSION = "2026-07-24.1";

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
    title: "夏令營任務通知",
    body: "任務即將於兩分鐘後開始",
    url: "./app.html"
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
    icon: "assets/icon-192.png?v=20260722-2",
    badge: "assets/icon-192.png?v=20260722-2",
    tag: data.tag || "ims-task-reminder",
    renotify: true,
    data: { url: data.url || "./app.html" }
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
  var target = new URL(event.notification.data.url || "./app.html", self.location.href).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    var matchingClient = clients.find(function (client) { return client.url === target; });
    if (matchingClient) return matchingClient.focus();
    return self.clients.openWindow(target);
  }));
});
