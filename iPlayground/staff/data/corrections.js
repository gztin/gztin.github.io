(function () {
  "use strict";

  var source = window.OFFLINE_SCHEDULE;
  if (!source) return;

  source.schedule.forEach(function (task) {
    if (String(task.person).toLowerCase() === "ethan" && task.role !== "講者") {
      task.person = "ggt";
    }
  });

  var missingTasks = [
    { person: "Minkyung Kim", role: "講者", day: "D1", start: "9:40", end: "10:20", content: "session(40)", speaker: "Minkyung Kim", title: "Designing Adaptive UX Through Learning Theory & AI", row: 5 },
    { person: "李易修", role: "講者", day: "D1", start: "10:30", end: "10:50", content: "session(40)", speaker: "李易修", title: "不見到看得懂：ccxray 與 AI Coding 的可觀測性", row: 7 },
    { person: "鄭宇哲", role: "講者", day: "D1", start: "11:20", end: "11:40", content: "session(20)", speaker: "鄭宇哲", title: "@ContentBuilder Is All You Need", row: 10 },
    { person: "Gyuri Kim", role: "講者", day: "D1", start: "11:40", end: "12:00", content: "session(20)", speaker: "Gyuri Kim", title: "The Bottleneck Was Me: AI-Native Workflows for Large Codebases", row: 11 },
    { person: "13", role: "講者", day: "D1", start: "13:00", end: "13:20", content: "session(20)", speaker: "13", title: "Core People：以人為本，打造更體貼的 App 體驗", row: 14 },
    { person: "范聖佑", role: "講者", day: "D1", start: "13:30", end: "14:10", content: "session(40)", speaker: "范聖佑", title: "從 Swift 到 Kotlin Multiplatform：iOS 開發者的跨平台二刀流", row: 16 },
    { person: "qcl", role: "講者", day: "D1", start: "14:20", end: "14:40", content: "session(20)", speaker: "qcl", title: "Xcode 沒內建我愛用的 Coding Agent？iOS 開發的 Agentic Workflow 策略", row: 18 },
    { person: "Bobson", role: "講者", day: "D1", start: "14:40", end: "15:00", content: "session(20)", speaker: "Bobson", title: "Tweet AI to the Edge", row: 19 },
    { person: "freddi", role: "講者", day: "D1", start: "15:10", end: "15:30", content: "session(20)", speaker: "freddi", title: "Swift 程式碼為什麼能運作？從平台、 Runtime 與編譯器理解 Swift", row: 21 },
    { person: "Dex", role: "講者", day: "D1", start: "15:30", end: "15:50", content: "session(20)", speaker: "Dex", title: "是時候了！將 RxSwift 程式碼全部改寫成 Swift Concurrency 吧！", row: 22 },
    { person: "星野恵瑠", role: "講者", day: "D1", start: "16:00", end: "16:20", content: "session(40)", speaker: "星野恵瑠", title: "為什麼你並不需要 ViewModel", row: 24 },
    { person: "Alex Hu", role: "講者", day: "D1", start: "16:50", end: "17:10", content: "session(20)", speaker: "Alex Hu", title: "把 AI 當資淺工程師帶：一個人用 Agent 把 iOS App 做到上架的工程紀律", row: 27 },
    { person: "Annie", role: "講者", day: "D1", start: "17:10", end: "17:30", content: "session(20)", speaker: "Annie", title: "iOS 工程師 2026 職場生存指南：資深外商獵頭視角", row: 28 },
    { person: "海總理", role: "講者", day: "D1", start: "17:40", end: "18:00", content: "session(20)", speaker: "海總理", title: "把自己抽出迴圈：讓程式獨自升級", row: 30 },
    { person: "Rudrank Riyam", role: "講者", day: "D2", start: "9:35", end: "10:15", content: "session(40)", speaker: "Rudrank Riyam", title: "For Agents, By Agents: Building AI Tools That Maintain Themselves", row: 5 },
    { person: "Hana 花水木", role: "講者", day: "D2", start: "10:25", end: "10:45", content: "session(20)", speaker: "Hana 花水木", title: "App 上架之後呢？用 AI Agent 自動化行銷、客服與產品迭代", row: 7 },
    { person: "Vic", role: "講者", day: "D2", start: "10:45", end: "11:05", content: "session(20)", speaker: "Vic", title: "當觸控失效時，你的 App 還能順利使用嗎？", row: 8 },
    { person: "JungMin Ahn", role: "講者", day: "D2", start: "11:15", end: "11:35", content: "session(40)", speaker: "JungMin Ahn", title: "Lessons from Operating Large-Scale Modular iOS Projects with Tuist", row: 10 },
    { person: "Thiago Komeno", role: "講者", day: "D2", start: "13:00", end: "13:20", content: "session(20)", speaker: "Thiago Komeno", title: "How to Win the Swift Student Challenge", row: 14 },
    { person: "梯口", role: "講者", day: "D2", start: "13:30", end: "14:10", content: "session(40)", speaker: "梯口", title: "不寫 Swift 也能貢獻 Apple Container：一位雲端原生工程師的開源實戰", row: 16 },
    { person: "彼得潘", role: "講者", day: "D2", start: "14:40", end: "15:00", content: "session(20)", speaker: "彼得潘", title: "從 Vibe Coding 學會的 macOS CLI 魔法指令", row: 19 },
    { person: "Denken Chen", role: "講者", day: "D2", start: "15:10", end: "15:30", content: "session(20)", speaker: "Denken Chen", title: "年齡保證框架，兼談數位憑證皮夾", row: 21 },
    { person: "Ervis", role: "講者", day: "D2", start: "15:30", end: "15:50", content: "session(20)", speaker: "Ervis", title: "從一張看不懂的日本收據開始：一人開發者如何用 AI 與回饋系統把 Side Project 長成產品", row: 22 },
    { person: "高見龍", role: "講者", day: "D2", start: "16:00", end: "16:20", content: "session(40)", speaker: "高見龍", title: "SDD 是口號，還是真的可以用？", row: 24 },
    { person: "Yu Takahashi", role: "講者", day: "D2", start: "16:50", end: "16:55", content: "LT(5)", speaker: "Yu Takahashi", title: "為什麼 Swift Macro 無法在 #Preview 中使用？", row: 27 },
    { person: "劉信", role: "講者", day: "D2", start: "16:55", end: "17:00", content: "LT(5)", speaker: "劉信", title: "坑很深：做寫字練習 App 比想像更費工", row: 28 },
    { person: "劉育承", role: "講者", day: "D2", start: "17:10", end: "17:15", content: "LT(5)", speaker: "劉育承", title: "用 SwiftUI 打造 iOS / Android 跨平台 AI 美國選舉雷達：從新聞自動摘要到人工審核的 Mobile AI App 實戰", row: 31 },
    { person: "13", role: "工作坊講者", day: "D2", start: "15:00", end: "15:10", content: "休息(10)", speaker: "", title: "", row: 20 },
    { person: "13", role: "工作坊講者", day: "D2", start: "15:10", end: "15:30", content: "session(20)", speaker: "Denken Chen", title: "年齡保證框架，兼談數位憑證皮夾", row: 21 },
    { person: "13", role: "工作坊講者", day: "D2", start: "15:30", end: "15:50", content: "session(20)", speaker: "Ervis", title: "從一張看不懂的日本收據開始：一人開發者如何用 AI 與回饋系統把 Side Project 長成產品", row: 22 },
    { person: "13", role: "工作坊講者", day: "D2", start: "15:50", end: "16:00", content: "休息(10)", speaker: "", title: "", row: 23 },
    { person: "13", role: "工作坊講者", day: "D2", start: "16:00", end: "16:20", content: "session(40)", speaker: "高見龍", title: "SDD 是口號，還是真的可以用？", row: 24 },
    { person: "13", role: "工作坊講者", day: "D2", start: "16:20", end: "16:40", content: "", speaker: "", title: "", row: 25 }
  ];

  missingTasks.forEach(function (task) {
    var exists = source.schedule.some(function (item) {
      return String(item.person) === task.person && item.role === task.role && item.day === task.day && item.row === task.row;
    });
    if (!exists) source.schedule.push(task);
  });

  var workshopPeople = ["Jeff", "Evelyn", "ggt"];
  var legacyWorkshopRoles = ["組長 ＆ 電腦", "主持   ＆ 驗票", "主持 ＆ 驗票", "計時＋驗票"];
  source.schedule = source.schedule.filter(function (task) {
    return !(
      workshopPeople.includes(String(task.person)) &&
      (task.day === "D1" || task.day === "D2") &&
      legacyWorkshopRoles.includes(task.role) &&
      task.start >= "13:00" &&
      task.start < "16:45"
    );
  });

  var workshopLeaderDuty = "當日 Workshop 組長：負責電腦架設、電視擺設與畫面確認、講者溝通及進場準備；開始前確認主持、驗票與講者皆已就位。";
  var workshopCheckInDuty = "驗票流程：櫃檯放置標有場次與候補順序的號碼牌；持 7/22 事前登記名單先核對錄取者姓名與 badge，並一邊收取、登記當日候補號碼牌，持號碼牌者依序入場。Workshop 開始後若尚未滿場，可免號碼牌，但仍須經驗票員登記後入場；後續依剩餘座位與候補順序辦理。";

  var workshopSessions = [
    {
      day: "D1",
      session: 1,
      start: "13:15",
      end: "14:45",
      speaker: "Harry",
      title: "在 AI 時代尋找真實",
      assignments: { "主持": "Evelyn", "組長": "Jeff", "驗票": "ggt" },
      hostIntro: [
        "第一個 workshop 即將開始，我們很榮幸能再次邀請到 Harry。",
        "Harry 在 Apple、Codex、Cursor 等全球社群中擔任大使角色，長期投入創新實作、跨文化協作，並持續在商業、學術與國際科技社群中創造影響力。",
        "近年來，AI 正以前所未有的速度影響我們的工作與生活。特別是身為軟體工作者，這份改變與衝擊，我們應該都感受得特別深。",
        "接下來，就讓 Harry 帶領我們，一起在 AI 時代尋找真實。"
      ],
      accepted: [
        [1, "211", "Toby", "個人贊助"], [2, "108", "Gonzo", "尊享票"],
        [3, "208", "Bobby", "尊享票"], [4, "10", "Jesse Chen", ""],
        [5, "90", "Luan", ""], [6, "28", "Sunny", ""],
        [7, "53", "嘉偉", ""], [8, "135", "Ethan", ""],
        [9, "50", "Sally", ""], [10, "179", "Eva", ""],
        [11, "214", "Dong", ""], [12, "151", "Yu", ""],
        [13, "204", "Anderson", ""], [14, "187", "陳正穎", ""],
        [15, "59", "資深菜鳥", ""], [16, "23", "Yen Lin", ""],
        [17, "113", "Thiago Komeno", ""], [18, "105", "陳時安", ""],
        [19, "221", "Rocoo", ""], [20, "81", "Squid", ""]
      ],
      waitlist: []
    },
    {
      day: "D1",
      session: 2,
      start: "15:15",
      end: "16:45",
      speaker: "Kevin Chiu",
      title: "Stitch × Antigravity 實戰指南：讓 AI 助你從視覺設計精準落地 iOS App",
      assignments: { "主持": "Evelyn", "組長": "Jeff", "驗票": "ggt" },
      hostIntro: [
        "接下來要帶領大家實作的講者，是 Cloud AI GDE，也是 GDG Taipei Organizer—— Kevin Chiu。",
        "Kevin 長期投入 AI 應用與開發工具的研究，持續探索 AI 如何真正改變開發者的工作流程。",
        "今天，他將帶大家親身體驗新一代 AI 驅動開發的完整流程，從設計草圖開始，結合 AI 設計引擎與開發框架，一步步打造出可實際運行的 iOS App。",
        "如果你也好奇，Stitch × Antigravity 開發方式會是什麼模樣，相信今天這場 Workshop 會帶給你不少驚喜。",
        "讓我們用掌聲歡迎 Kevin Chiu！"
      ],
      accepted: [
        [1, "197", "賴信均", "尊享票"], [2, "78", "Jill Chang", ""],
        [3, "28", "Sunny", ""], [4, "35", "Leslie", ""],
        [5, "144", "Jack Lee", ""], [6, "107", "Rick", ""],
        [7, "159", "Chloe", ""], [8, "180", "jason", ""],
        [9, "199", "Eric", ""], [10, "165", "蔡宜潔", ""],
        [11, "227", "Polin", ""], [12, "186", "陳正穎", ""],
        [13, "158", "Charles", ""], [14, "62", "蛋白・たんぱく", ""],
        [15, "240", "小綠人安豬", ""], [16, "224", "安迪", ""],
        [17, "81", "Squid", ""]
      ],
      waitlist: []
    },
    {
      day: "D2",
      session: 1,
      start: "13:15",
      end: "14:45",
      speaker: "Hedula",
      title: "我不會 Swift，但我做了一個 AI 怪獸對戰遊戲",
      assignments: { "主持": "Evelyn", "組長": "ggt", "驗票": "Jeff" },
      hostIntro: [
        "「不需要精通 Swift，也能在 90 分鐘內做出一個有 AI 的 iOS 遊戲。」",
        "這就是接下來 Hedula 要帶來的 workshop。",
        "Hedula 擁有 20 年設計與數位產品經驗，也是一位視覺全端工程師，長期探索如何結合 AI、設計與開發流程，打造新型態的數位產品體驗。",
        "準備好 Xcode 和 Codex，接下來就讓 Hedula 帶著我們，一起從零打造《Snap Fighter》吧！"
      ],
      accepted: [
        [1, "137", "Vicky Ciou", ""], [2, "144", "Jack Lee", ""],
        [3, "52", "Min", ""], [4, "18", "邱奕傑 Peter Chiou", ""],
        [5, "19", "YJ", ""], [6, "93", "Kevin Liao", ""],
        [7, "33", "Chiawei", ""], [8, "113", "Thiago Komeno", ""],
        [9, "14", "MickyTsai", ""], [10, "62", "蛋白・たんぱく", ""],
        [11, "42", "Kevin Lin", ""]
      ],
      waitlist: []
    },
    {
      day: "D2",
      session: 2,
      start: "15:15",
      end: "16:45",
      speaker: "13",
      title: "Core People：以人為本，打造更體貼的 App 體驗",
      assignments: { "主持": "Evelyn", "組長": "ggt", "驗票": "Jeff" },
      hostIntro: [
        "接下來的工作坊，繼續由 13 帶領大家實作。",
        "昨天他提到，在 AI 時代，人性更加重要。今天，我們將從使用者需求出發，結合 Apple 原生能力與 AI，實際改善 App 的體驗與品質。",
        "讓我們再次歡迎 13！"
      ],
      accepted: [
        [1, "211", "Toby", "個人贊助"], [2, "108", "Gonzo", "尊享票"],
        [3, "197", "賴信均", "尊享票"], [4, "208", "Bobby", "尊享票"],
        [5, "10", "Jesse Chen", ""], [6, "90", "Luan", ""],
        [7, "137", "Vicky Ciou", ""], [8, "35", "Leslie", ""],
        [9, "53", "嘉偉", ""], [10, "180", "jason", ""],
        [11, "135", "Ethan", ""], [12, "51", "KC", ""],
        [13, "52", "Min", ""], [14, "50", "Sally", ""],
        [15, "214", "Dong", ""], [16, "18", "邱奕傑 Peter Chiou", ""],
        [17, "151", "Yu", ""], [18, "19", "YJ", ""],
        [19, "141", "Samuel", ""], [20, "93", "Kevin Liao", ""],
        [21, "165", "蔡宜潔", ""], [22, "227", "Polin", ""],
        [23, "187", "陳正穎", ""], [24, "59", "資深菜鳥", ""],
        [25, "23", "Yen Lin", ""], [26, "221", "Rocoo", ""],
        [27, "237", "李國駿", ""], [28, "14", "MickyTsai", ""],
        [29, "25", "Dan", ""], [30, "240", "小綠人安豬", ""]
      ],
      waitlist: []
    }
  ];

  workshopSessions.forEach(function (session) {
    Object.keys(session.assignments).forEach(function (role) {
      source.schedule.push({
        person: session.assignments[role],
        role: "Workshop｜" + role,
        day: session.day,
        start: session.start,
        end: session.end,
        content: "Workshop",
        speaker: session.speaker,
        title: session.title,
        duty: role === "組長"
          ? workshopLeaderDuty
          : role === "驗票"
            ? workshopCheckInDuty
            : "主持本場 Workshop；開始前請先順過講者介紹，確認講者姓名、職稱與主題，並與組長完成上場銜接。",
        hostIntro: role === "主持" ? session.hostIntro : null,
        registration: role === "驗票" ? {
          accepted: session.accepted,
          waitlist: session.waitlist
        } : null,
        assignment: "工作人員",
        row: "workshop-" + session.day + "-" + session.session + "-" + role
      });
    });
  });

  var supplementalWorkItems = [
    { day: "D1", row: 2, item: "報到桌佈置", start: "8:00", end: "8:30", location: "政大公企中心 2F", detail: "名牌分類、放置周邊小物、搬桌子", workers: ["中原", "柏謙", "承諺", "Henry", "李天"], owner: "DinDin", photos: ["Tank", "大軍"] },
    { day: "D1", row: 3, item: "引導人流", start: "8:30", end: "9:30", location: "政大公企中心正門口(1F)", detail: "引導會眾到電梯／樓梯、手持指示牌", workers: ["YuYu"], owner: "DinDin", photos: ["Tank", "大軍"] },
    { day: "D1", row: 4, item: "櫃檯報到(kktix)", start: "8:30", end: "9:30", location: "會眾報到桌", workers: ["Terry", "Hokila"], photos: ["Tank", "大軍"] },
    { day: "D1", row: 5, item: "發名牌", start: "8:30", end: "9:30", location: "會眾報到桌", detail: "發放名牌", workers: ["MarkFly", "Amy", "李天", "Evelyn", "柏謙", "憲憲"], owner: "Hao", photos: ["Tank", "大軍"] },
    { day: "D1", row: 6, item: "補收據、人工櫃台", start: "8:30", end: "9:30", workers: [], photos: ["Tank", "大軍"] },
    { day: "D1", row: 7, item: "發衣服", start: "8:30", end: "9:30", location: "會眾報到桌", detail: "發會眾衣服", workers: ["Ricky", "以丹", "Shirley", "中原", "Kyle", "承諺"], owner: "Hao", photos: ["Tank", "大軍"] },
    { day: "D1", row: 8, item: "講者桌報到、發周邊", start: "8:30", end: "9:30", location: "講者報到桌", detail: "報到、發放周邊", workers: ["Jess"], photos: ["Tank", "大軍"] },
    { day: "D1", row: 9, item: "講者接待", start: "8:30", end: "9:30", location: "講者報到桌", detail: "講者導覽，發送禮包", workers: ["UJ", "Michelle", "Jeff", "ggt", "Will", "David", "Dawei"], owner: "Joy", photos: [] },
    { day: "D2", row: 2, item: "集合", start: "8:30", end: "9:00", location: "政大公企中心 2F", workers: [], photos: ["Tank", "大軍"] },
    { day: "D2", row: 3, item: "櫃檯報到(kktix)", start: "8:40", end: "9:30", location: "會眾報到桌", detail: "報到", workers: ["Terry"], photos: ["Tank", "大軍"] },
    { day: "D2", row: 4, item: "發名牌／小禮物", start: "8:40", end: "9:30", location: "會眾報到桌", detail: "報到", workers: ["Evelyn"], photos: ["Tank", "大軍"] },
    { day: "D2", row: 5, item: "講者桌報到", start: "8:40", end: "9:30", location: "講者報到桌", detail: "報到、發名牌、周邊", workers: ["以丹"], photos: ["Tank", "大軍"] },
    { day: "D2", row: 6, item: "講者接待", start: "8:30", end: "9:30", location: "講者報到桌", detail: "講者導覽，發送禮包", workers: ["UJ", "Michelle", "Jeff", "ggt", "Will", "David", "Dawei"], owner: "Joy", photos: [] }
  ];

  var vacancyWorkItems = [
    { day: "D1", row: 13, item: "After Party 引導廠商、工作人員動線說明", start: "16:30", end: "18:00", requiredLabel: "待確認", missingLabel: "待確認" },
    { day: "D1", row: 14, item: "After Party 引導", start: "17:45", end: "18:00", location: "2F", detail: "引導人流", requiredLabel: "2 人", missingLabel: "2 人" },
    { day: "D1", row: 15, item: "報到桌交接", start: "17:45", end: "18:00", location: "2F", detail: "搬桌子、整理環境與物資", requiredLabel: "3 人", missingLabel: "3 人" },
    { day: "D1", row: 16, item: "After Party 門口、餐台秩序管制", start: "18:00", end: "18:30", location: "6F", requiredLabel: "待確認", missingLabel: "待確認" }
  ];

  function addSupplementalTask(item, person, assignment) {
    if (!person) return;
    var isPhoto = assignment === "拍照手";
    var duty;
    if (isPhoto) {
      duty = "主要任務：拍照紀錄。拍攝項目：「" + item.item + "」";
      if (item.location) duty += "；拍攝地點：" + item.location;
      if (item.detail) duty += "；被拍攝工作內容：" + item.detail;
      if (item.workers.length) duty += "；現場執行人員：" + item.workers.join("、");
      if (item.owner) duty += "；現場負責人：" + item.owner;
      duty += "。被拍攝工作內容由現場工作人員負責，非攝影人員工作。";
    } else {
      var dutyPrefix = assignment === "負責人" ? "負責現場協調" : "負責執行";
      duty = dutyPrefix + "「" + item.item + "」";
      if (item.location) duty += "，地點：" + item.location;
      if (item.detail) duty += "；工作內容：" + item.detail;
      duty += "。";
    }
    var task = {
      person: person,
      role: isPhoto ? "拍照紀錄" : item.item,
      day: item.day,
      start: item.start,
      end: item.end,
      content: isPhoto ? item.item : [assignment, item.location, item.detail].filter(Boolean).join("｜"),
      duty: duty,
      assignment: assignment,
      speaker: "",
      title: "",
      row: "supplemental-" + item.day + "-" + item.row
    };
    var exists = source.schedule.some(function (current) {
      return String(current.person) === task.person && current.row === task.row && current.assignment === task.assignment;
    });
    if (!exists) source.schedule.push(task);
  }

  supplementalWorkItems.forEach(function (item) {
    item.workers.forEach(function (person) { addSupplementalTask(item, person, "工作人員"); });
    addSupplementalTask(item, item.owner, "負責人");
    (item.photos || []).forEach(function (person) { addSupplementalTask(item, person, "拍照手"); });
  });

  vacancyWorkItems.forEach(function (item) {
    var duty = "此任務尚待補充人力；需求人數：" + item.requiredLabel + "，目前已安排：0 人";
    if (item.missingLabel !== "待確認") duty += "，仍缺：" + item.missingLabel;
    if (item.location) duty += "。地點：" + item.location;
    if (item.detail) duty += "；工作內容：" + item.detail;
    duty += "。";
    var task = {
      person: "Hokila",
      role: "待補充｜" + item.item,
      day: item.day,
      start: item.start,
      end: item.end,
      endPending: Boolean(item.endPending),
      content: ["待補充", "需求人數：" + item.requiredLabel, item.location, item.detail].filter(Boolean).join("｜"),
      duty: duty,
      assignment: "待補充",
      requiredLabel: item.requiredLabel,
      missingLabel: item.missingLabel,
      speaker: "",
      title: "",
      row: "vacancy-" + item.day + "-" + item.row
    };
    var exists = source.schedule.some(function (current) {
      return String(current.person) === task.person && current.row === task.row;
    });
    if (!exists) source.schedule.push(task);
  });

  var setupWorkItems = [
    { area: "大會議室", item: "測試休息時間畫面｜全畫面（A）", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "測試投影組合畫面｜子母畫面（B、C）", detail: "需輸出講桌聲音。", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "測試開場影片", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "測試休息時間影片", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "測試導播室、主持人與講者上台流程", detail: "主持人：Jess、Shirley、Amy。", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "確認燈光與講桌位置", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "確認導播室 layout A4 示意圖放講桌", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "協助講者投放投影片與時間控管", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "確認 iPad 倒數計時器安裝完成", people: ["Michelle", "UJ", "Joy"] },
    { area: "大會議室", item: "協助講者導覽、招呼", people: ["Dawei", "Michelle", "Joy"] },
    { area: "大會議室", item: "製作工作人員保留位置告示牌", detail: "放置於講桌前方第一排。", people: ["Dawei", "Joy"] },
    { area: "大會議室", item: "製作倒數提醒手牌", detail: "20、10、5、時間到。", people: ["Dawei", "Joy"] },
    { area: "場外區", item: "講者衣服禮物打包", people: ["Will", "Joy"] },
    { area: "場外區", item: "切割 workshop 候補號碼牌", people: ["Will", "Joy"] },
    { area: "場外區", item: "切割講者導覽流程手稿", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "切割主持人手稿", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "水籤海報黏磁鐵與相關項目確認", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "非工作人員請勿進入告示黏磁鐵", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "Workshop 相關告示黏磁鐵", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "確認三份名單", detail: "Workshop 報名名單、會眾所有名單、水壺／個人贊助／尊享領取紀錄名單。", people: ["Ethan", "Jeff", "Ricky", "Joy"] },
    { area: "場外區", item: "A1 立牌", people: ["Terry", "Tank", "以丹", "Evelyn", "Hokila"] },
    { area: "場外區", item: "製作動線引導手牌", people: ["Terry", "Tank", "以丹", "Evelyn", "Hokila"] },
    { area: "場外區", item: "桌子排列、鋪桌巾並放好桌牌", people: ["Terry", "Tank", "以丹", "Evelyn", "Hokila"] },
    { area: "場外區", item: "衣服與 badge 分類分箱並鎖起來", detail: "確認 badge 都有綁撲克牌，一個人只會有一張。", people: ["Terry", "Tank", "以丹", "Evelyn", "Hokila"] },
    { area: "場外區", item: "將水壺分三類放置", detail: "分為會眾中籤、工作人員、尊享贊助票／個人贊助；避免現場誤售或其他中籤會眾拿不到。工作人員預計從倉庫拿送講者的水壺。", people: ["Terry", "Tank", "以丹", "Evelyn", "Hokila"] },
    { area: "導播室", item: "測試休息時間畫面｜全畫面（A）", people: ["Andy", "David"] },
    { area: "導播室", item: "測試投影組合畫面｜子母畫面（B、C）", detail: "確認是否可以 preview B／C。", people: ["Andy", "David"] },
    { area: "導播室", item: "測試翻譯字幕輸出", people: ["Andy", "David"] },
    { area: "導播室", item: "測試開場影片", people: ["Andy", "David"] },
    { area: "導播室", item: "測試休息時間影片", people: ["Andy", "David"] },
    { area: "導播室", item: "練習主持人介紹講者上台時追焦的功力", detail: "分鏡：主持人在講台旁介紹時，追焦在主持人身上；等講者走到講台、投放設定完成後，再追焦到講者。", people: ["Andy", "David"] },
    { area: "中庭展廳", item: "排贊助商桌子", people: ["YuYu", "DinDin"] },
    { area: "中庭展廳", item: "協助贊助商場佈", people: ["YuYu", "DinDin"] },
    { area: "其他", item: "X 展架與拍照牆", detail: "廠商執行，Hao 協調確認。", people: ["Hao"] },
    { area: "其他", item: "布簾 × 2、演講桌、麥克風手牌", detail: "廠商執行，Hao 協調確認。", people: ["Hao"] }
  ];

  setupWorkItems.forEach(function (item, index) {
    item.people.forEach(function (person) {
      var task = {
        person: person,
        role: "場佈｜" + item.area,
        day: "D0",
        start: "18:00",
        end: "23:59",
        content: item.item,
        duty: "負責執行「" + item.item + "」，地點：" + item.area + (item.detail ? "；" + item.detail : "") + "。",
        assignment: "工作人員",
        speaker: "",
        title: "",
        row: "setup-D0-" + (index + 1)
      };
      var exists = source.schedule.some(function (current) {
        return String(current.person) === task.person && current.row === task.row;
      });
      if (!exists) source.schedule.push(task);
    });
  });

  source.sideMissions = [
    { person: "DinDin", title: "準備倒數工具", detail: "準備倒數小工具與倒數用途；工具限制 iOS 26 以上，並以原生計時器作為備案。" },
    { person: "ggt", title: "攜帶 iPad 完成演練", detail: "活動前一天記得帶 iPad，進行倒數工具演練並安裝 App。" },
    { person: "Jeff", title: "倒數工具操作 Demo", detail: "向工作人員示範倒數工具的操作方式與注意事項。" },
    { person: "UJ", title: "安排講者投影測試", detail: "7/24 19:00 起篩選可測試的講者並安排排隊；每位每次限時 10 分鐘，逾時需重新排隊。" },
    { person: "UJ", title: "確認講者公用電腦", detail: "確認所有講者投影片已備妥；記得攜帶 Hub，並安裝 PowerPoint、Figma。" },
    { person: "Joy", title: "確認講者公用電腦", detail: "確認所有講者投影片已備妥；記得攜帶 Hub，並安裝 PowerPoint、Figma。" },
    { person: "Joy", title: "協助講者報到", detail: "7/25、7/26 活動日若講者報到時找不到對應窗口，協助接手處理。" },
    { person: "Jeff", title: "寄送講者會後問卷", detail: "活動結束後寄送講者會後問卷。", link: "https://drive.google.com/drive/folders/14FNCirZ8PChlCcLSfR6ww8xqXTDcoy61?usp=share_link" },
    { person: "Kyle", title: "攤位｜學生活動", detail: "擔任學生活動負責人；原始攤位表未指定日期與時間，請依現場安排執行。" },
    { person: "Dawei", title: "攤位｜大偉技術解題", detail: "擔任大偉技術解題攤位負責人；原始攤位表未指定日期與時間，請依現場安排執行。" },
    { person: "Hokila", title: "攤位｜報到＆服務總站", detail: "擔任報到＆服務總站負責人；原始攤位表未指定日期與時間，請依現場安排執行。" },
    { person: "Terry", title: "攤位｜周邊商品販賣", detail: "擔任周邊商品販賣攤位負責人；原始攤位表未指定日期與時間，請依現場安排執行。" },
    { person: "MarkFly", title: "攤位｜水籤 ＆ 抽獎", detail: "擔任水籤與抽獎攤位負責人；原始攤位表未指定日期與時間，請依現場安排執行。" }
  ];
})();
