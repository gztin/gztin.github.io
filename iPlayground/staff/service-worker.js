"use strict";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
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

  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: "assets/app-icon.svg",
    badge: "assets/app-icon.svg",
    tag: data.tag || "ims-task-reminder",
    renotify: true,
    data: { url: data.url || "./" }
  }));
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
