(function () {
  "use strict";

  var source = window.OFFLINE_SCHEDULE;
  if (!window.Vue || !source) {
    document.body.innerHTML = "<p style='padding:24px;font-family:sans-serif'>離線檔案不完整，請確認 vendor 與 data 資料夾仍與 index.html 放在一起。</p>";
    return;
  }

  function minutes(time) {
    var parts = time.split(":").map(Number);
    return parts[0] * 60 + parts[1];
  }

  var REMINDER_LEAD_MINUTES = 2;
  var EVENT_DATES = { D0: "2026-07-24", D1: "2026-07-25", D2: "2026-07-26" };
  var REMINDER_STORAGE_KEY = "ims-task-reminders-v1";

  function taskKey(task) {
    return [task.person || "", task.day, task.start, task.end, task.role, task.row || ""].join("::");
  }

  function taskStartsAt(task) {
    var date = EVENT_DATES[task.day];
    if (!date || !/^\d{1,2}:\d{2}$/.test(task.start || "")) return null;
    var time = task.start.split(":").map(Number);
    return new Date(date + "T" + String(time[0]).padStart(2, "0") + ":" + String(time[1]).padStart(2, "0") + ":00+08:00");
  }

  function reminderAt(task) {
    var startsAt = taskStartsAt(task);
    return startsAt ? new Date(startsAt.getTime() - REMINDER_LEAD_MINUTES * 60 * 1000) : null;
  }

  function notificationTimeLabel(date) {
    if (!date) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function loadReminderState() {
    try {
      var value = JSON.parse(window.localStorage.getItem(REMINDER_STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (error) {
      return {};
    }
  }

  function defaultDayForTaipei(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date || new Date());
    var month = Number(parts.find(function (part) { return part.type === "month"; }).value);
    var day = Number(parts.find(function (part) { return part.type === "day"; }).value);
    var monthDay = month * 100 + day;
    if (monthDay <= 724) return "D0";
    if (monthDay === 725) return "D1";
    return "D2";
  }

  function agendaLabel(task) {
    if (task.title) return task.speaker ? task.speaker + "｜" + task.title : task.title;
    return task.content;
  }

  function excludedTaskContent(task) {
    var content = String(task.content || "").trim();
    return content === "休息(10)" || content === "午餐(30)" || content === "午餐(35)";
  }

  function mergeTasks(tasks) {
    return tasks.filter(function (task) {
      return !excludedTaskContent(task);
    }).map(function (task) {
      return Object.assign({}, task, { agenda: [agendaLabel(task)] });
    }).sort(function (a, b) {
      return a.day.localeCompare(b.day) || minutes(a.start) - minutes(b.start) || a.role.localeCompare(b.role, "zh-Hant");
    });
  }

  function personType(tasks, person) {
    if ((person === "Joy" || person === "Jess") && tasks.some(function (task) { return task.role !== "講者" && task.role !== "工作坊講者"; })) return "staff";
    if (tasks.some(function (task) { return task.role === "工作坊講者"; })) return "workshop";
    if (tasks.some(function (task) { return task.role === "講者"; })) return "session";
    return "staff";
  }

  function roleCategory(role) {
    if (role === "講者" || role === "工作坊講者") return "";
    if (role.startsWith("待補充｜")) return "";
    if (role.includes("攝影")) return "攝影";
    if (role.startsWith("便當組")) return "便當組";
    if (role === "講者便當") return "講者便當";
    if (role === "計時＋舉牌") return "計時／舉牌";
    if (role === "計時＋驗票" || role.includes("工作坊主持") || role.includes("工作坊組長")) return "工作坊場務";
    if (role.startsWith("中控室") || role.startsWith("中控3") || role.startsWith("中控(實習）")) return "中控室";
    if (role.includes("櫃檯") || role.includes("販售") || role.includes("抽獎") || role.includes("補水")) return "櫃檯";
    if (role.includes("採訪")) return "採訪";
    if (role === "技術活動" || role === "學生活動") return "活動支援";
    return role.trim();
  }

  function mergePartnerTimeGroups(groups) {
    var grouped = new Map();
    groups.forEach(function (group) {
      var key = group.day + "::" + group.category + "::" + group.partners.join("::");
      if (!grouped.has(key)) grouped.set(key, { day: group.day, category: group.category, partners: group.partners, ranges: [] });
      grouped.get(key).ranges.push({ start: group.start, end: group.end });
    });
    return Array.from(grouped.values()).map(function (group) {
      group.ranges.sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
      var merged = [];
      group.ranges.forEach(function (range) {
        var previous = merged[merged.length - 1];
        if (previous && minutes(range.start) <= minutes(previous.end)) {
          if (minutes(range.end) > minutes(previous.end)) previous.end = range.end;
        } else {
          merged.push({ start: range.start, end: range.end });
        }
      });
      return {
        day: group.day,
        category: group.category,
        times: merged.map(function (range) { return range.start + "–" + range.end; }),
        partners: group.partners
      };
    }).sort(function (a, b) {
      return a.day.localeCompare(b.day) || minutes(a.times[0].split("–")[0]) - minutes(b.times[0].split("–")[0]) || a.category.localeCompare(b.category, "zh-Hant");
    });
  }

  var people = Array.from(new Set(source.schedule.map(function (task) { return String(task.person); })))
    .sort(function (a, b) { return a.localeCompare(b, "zh-Hant", { numeric: false }); });

  var directory = people.map(function (person) {
    var tasks = source.schedule.filter(function (task) { return task.person === person; });
    var missions = (source.sideMissions || []).filter(function (mission) { return mission.person === person; });
    var roles = Array.from(new Set(tasks.map(function (task) { return task.role; })));
    return {
      person: person,
      type: personType(tasks, person),
      missions: missions,
      merged: mergeTasks(tasks),
      roles: roles,
      rolePreview: roles.slice(0, 2).join(" · ") + (roles.length > 2 ? " ＋" + (roles.length - 2) : "")
    };
  });

  directory.forEach(function (staff) {
    var ownPairs = new Map();
    source.schedule.forEach(function (task) {
      if (String(task.person) !== staff.person) return;
      var partnerCategory = roleCategory(task.role);
      if (partnerCategory) ownPairs.set(task.day + "::" + task.start + "::" + task.end + "::" + partnerCategory, {
        day: task.day,
        start: task.start,
        end: task.end,
        category: partnerCategory === "櫃檯" ? task.role : partnerCategory,
        partnerCategory: partnerCategory
      });
    });
    var partnerTimeGroups = Array.from(ownPairs.values()).map(function (pair) {
      var partners = Array.from(new Set(source.schedule.filter(function (task) {
        return String(task.person) !== staff.person && task.day === pair.day && task.start === pair.start && task.end === pair.end && roleCategory(task.role) === pair.partnerCategory;
      }).map(function (task) { return String(task.person); }))).sort(function (a, b) {
        return a.localeCompare(b, "zh-Hant", { numeric: false });
      });
      return { day: pair.day, category: pair.category, start: pair.start, end: pair.end, partners: partners };
    }).filter(function (group) { return group.partners.length; });
    staff.partnerGroups = mergePartnerTimeGroups(partnerTimeGroups);
  });

  Vue.createApp({
    data: function () {
      return {
        query: "", selected: "", day: defaultDayForTaipei(), highlighted: 0, showScrollTop: false,
        people: people, staffDirectory: directory, taskReminders: loadReminderState(), reminderBusyKeys: {}, reminderErrors: {}
      };
    },
    computed: {
      suggestions: function () {
        var normalized = this.query.trim().toLocaleLowerCase("zh-Hant");
        var staffPeople = this.staffDirectory.filter(function (person) { return person.type === "staff"; }).map(function (person) { return person.person; });
        if (!normalized) return staffPeople.slice(0, 8);
        return staffPeople.filter(function (name) { return name.toLocaleLowerCase("zh-Hant").includes(normalized); }).slice(0, 8);
      },
      activeName: function () {
        if (this.selected) return this.selected;
        var query = this.query.trim().toLocaleLowerCase("zh-Hant");
        var staffPeople = this.staffDirectory.filter(function (person) { return person.type === "staff"; }).map(function (person) { return person.person; });
        return staffPeople.find(function (name) { return name.toLocaleLowerCase("zh-Hant") === query; }) || "";
      },
      activeStaff: function () {
        var name = this.activeName;
        return this.staffDirectory.find(function (staff) { return staff.person === name; });
      },
      filteredDirectory: function () {
        return this.staffDirectory.filter(function (person) { return person.type === "staff"; });
      },
      visibleTasks: function () {
        var self = this;
        if (!this.activeStaff) return [];
        return this.activeStaff.merged.filter(function (task) { return self.day === "ALL" || task.day === self.day; });
      },
      durationLabel: function () {
        var rangesByDay = new Map();
        this.visibleTasks.forEach(function (task) {
          if (!rangesByDay.has(task.day)) rangesByDay.set(task.day, []);
          rangesByDay.get(task.day).push({ start: minutes(task.start), end: minutes(task.end) });
        });
        var total = 0;
        rangesByDay.forEach(function (ranges) {
          ranges.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
          var merged = [];
          ranges.forEach(function (range) {
            var previous = merged[merged.length - 1];
            if (previous && range.start <= previous.end) {
              if (range.end > previous.end) previous.end = range.end;
            } else {
              merged.push({ start: range.start, end: range.end });
            }
          });
          total += merged.reduce(function (sum, range) { return sum + range.end - range.start; }, 0);
        });
        return Math.floor(total / 60) + "h " + (total % 60) + "m";
      },
      roleLabel: function () {
        var assignedRoles = Array.from(new Set(this.visibleTasks.filter(function (task) { return task.assignment !== "待補充"; }).map(function (task) { return task.role; })));
        var vacancyCount = this.visibleTasks.filter(function (task) { return task.assignment === "待補充"; }).length;
        if (vacancyCount) assignedRoles.push("待補充 " + vacancyCount + " 項");
        return assignedRoles.join("、") || "—";
      }
    },
    methods: {
      choose: function (name) { this.selected = name; this.query = name; this.day = defaultDayForTaipei(); this.highlighted = 0; },
      clearSearch: function () { this.query = ""; this.selected = ""; this.day = defaultDayForTaipei(); this.highlighted = 0; },
      scrollToTop: function () { window.scrollTo({ top: 0, behavior: "smooth" }); },
      updateScrollState: function () { this.showScrollTop = window.scrollY >= 360; },
      moveSuggestion: function (step) {
        if (!this.suggestions.length) return;
        this.highlighted = (this.highlighted + step + this.suggestions.length) % this.suggestions.length;
      },
      chooseHighlighted: function () { if (this.suggestions[this.highlighted]) this.choose(this.suggestions[this.highlighted]); },
      dayLabel: function (value) { return value === "D0" ? "7/24" : value === "D1" ? "7/25" : value === "D2" ? "7/26" : value; },
      taskPartners: function (task) {
        var self = this;
        var category = roleCategory(task.role);
        if (!category || !this.activeStaff) return [];
        return Array.from(new Set(source.schedule.filter(function (item) {
          return String(item.person) !== self.activeStaff.person && item.day === task.day && item.start === task.start && item.end === task.end && roleCategory(item.role) === category;
        }).map(function (item) { return String(item.person); }))).sort(function (a, b) {
          return a.localeCompare(b, "zh-Hant", { numeric: false });
        });
      },
      taskDuration: function (task) { return minutes(task.end) - minutes(task.start); },
      reminderEnabled: function (task) { return Boolean(this.taskReminders[taskKey(task)]) && !this.reminderExpired(task); },
      reminderBusy: function (task) { return Boolean(this.reminderBusyKeys[taskKey(task)]); },
      reminderExpired: function (task) {
        var at = reminderAt(task);
        return !at || at.getTime() <= Date.now();
      },
      reminderError: function (task) { return Boolean(this.reminderErrors[taskKey(task)]); },
      reminderMessage: function (task) {
        var key = taskKey(task);
        if (this.reminderErrors[key]) return this.reminderErrors[key];
        if (this.reminderBusyKeys[key]) return "正在設定通知…";
        if (this.reminderExpired(task)) return "通知時間已過";
        if (this.taskReminders[key]) return "預計通知：" + notificationTimeLabel(reminderAt(task));
        return "";
      },
      saveReminderState: function () {
        window.localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(this.taskReminders));
      },
      toggleTaskReminder: async function (task, event) {
        var key = taskKey(task);
        var enabled = Boolean(event.target.checked);
        this.reminderErrors[key] = "";
        this.reminderBusyKeys[key] = true;
        try {
          if (!window.PushReminder || !window.PushReminder.isConfigured()) throw new Error("通知服務尚未設定");
          if (enabled) {
            var startsAt = taskStartsAt(task);
            if (!startsAt || reminderAt(task).getTime() <= Date.now()) throw new Error("通知時間已過");
            await window.PushReminder.scheduleTaskReminder({
              taskId: key,
              taskTitle: task.role,
              startsAt: startsAt.toISOString(),
              targetUrl: window.location.href.split("#")[0]
            });
            this.taskReminders[key] = { startsAt: startsAt.toISOString() };
          } else {
            await window.PushReminder.cancelTaskReminder(key);
            delete this.taskReminders[key];
          }
          this.taskReminders = Object.assign({}, this.taskReminders);
          this.saveReminderState();
        } catch (error) {
          event.target.checked = !enabled;
          this.reminderErrors[key] = "通知設定失敗：" + error.message;
        } finally {
          this.reminderBusyKeys[key] = false;
          this.reminderBusyKeys = Object.assign({}, this.reminderBusyKeys);
          this.reminderErrors = Object.assign({}, this.reminderErrors);
        }
      }
    },
    mounted: function () {
      this.updateScrollState();
      window.addEventListener("scroll", this.updateScrollState, { passive: true });
    },
    beforeUnmount: function () {
      window.removeEventListener("scroll", this.updateScrollState);
    }
  }).mount("#app");
})();
