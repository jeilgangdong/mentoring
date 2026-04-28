const SPREADSHEET_ID = "1CvJq8NTV0aCGPq9qHPBL6adUYUfDvHq2RTlOG-gD9eI";
let SPREADSHEET_CACHE = null;

const SHEETS = {
  mentors: "멘토관리",
  deletedMentors: "삭제멘토",
  children: "아동관리",
  tasks: "작성대상",
  observations: "관찰일지_취합",
  settings: "설정",
  dates: "특정일자설정",
  logs: "알림로그"
};

const HEADERS = {
  [SHEETS.mentors]: ["멘토명", "PIN", "이메일", "사용여부"],
  [SHEETS.deletedMentors]: ["멘토명", "PIN", "이메일", "사용여부", "삭제일시", "삭제자"],
  [SHEETS.children]: ["아동ID", "아동명", "그룹", "기본담당멘토", "사용여부", "과목", "활동요일"],
  [SHEETS.tasks]: ["작성ID", "제출날짜", "아동ID", "아동명", "원담당멘토", "작성상태", "실제작성자", "작성구분", "추가사유", "마감시간"],
  [SHEETS.observations]: ["작성ID", "버전", "현재사용여부", "제출날짜", "제출시간", "제출자", "아동ID", "아동명", "원담당멘토", "실제작성자", "작성구분", "추가사유", "문제집명/페이지", "학습태도 및 특이사항", "담당 사회복지사 전달사항", "수정상태", "최초제출시간", "최종수정시간", "수정자", "수정사유"],
  [SHEETS.settings]: ["항목", "값", "비고"],
  [SHEETS.dates]: ["날짜", "요일", "운영구분", "마감시간", "알림여부", "비고"],
  [SHEETS.logs]: ["발송일자", "일시", "알림유형", "수신자", "관련 아동", "채널", "결과", "비고"]
};

function doPost(e) {
  return handleRequest_(e);
}

function doGet(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    ensureSheetsReady_();
    const payload = parsePayload_(e);
    const action = payload.action;
    if (!action || typeof API[action] !== "function") throw new Error("지원하지 않는 action입니다.");
    return json_({ ok: true, ...API[action](payload) });
  } catch (error) {
    return json_({ ok: false, message: error.message || String(error) });
  }
}

const API = {
  loginMentor,
  getMentorTasks,
  submitObservation,
  updateObservation,
  getMentorHistory,
  adminLogin,
  getAdminDashboard,
  getChildrenList,
  getChildRecords,
  getObservationDetail,
  getSettings,
  saveSettings,
  saveSpecificDateSetting,
  deleteSpecificDateSetting,
  getNotificationLogs,
  sendMissingNotifications,
  getMentorManagement,
  saveMentor,
  deleteMentor,
  saveMentorAssignment
};

function setupSheets() {
  const ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const headers = HEADERS[name];
    const range = sheet.getRange(1, 1, 1, headers.length);
    const current = range.getValues()[0];
    const needsHeader = current.join("") === "" || headers.some((header, index) => current[index] !== header);
    if (needsHeader) {
      range.setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
  seedDefaultSettings_();
  PropertiesService.getScriptProperties().setProperty("SHEETS_READY", "Y");
  return {};
}

function ensureSheetsReady_() {
  if (PropertiesService.getScriptProperties().getProperty("SHEETS_READY") === "Y") return;
  setupSheets();
}

function seedDefaultSettings_() {
  const rows = readRows_(SHEETS.settings);
  const defaults = [
    ["DEFAULT_DEADLINE_TIME", "18:00", "기본 마감시간"],
    ["GLOBAL_NOTIFICATION", "ON", "전체 알림 ON/OFF"],
    ["ADMIN_PIN", "9999", "관리자 PIN"],
    ["ADMIN_EMAIL", "", "관리자 미작성 요약 수신 이메일"]
  ];
  defaults.forEach(row => {
    if (!rows.some(item => item["항목"] === row[0])) appendRow_(SHEETS.settings, row);
  });
}

function loginMentor(payload) {
  const name = clean_(payload.name);
  const pin = clean_(payload.pin);
  const mentor = readRows_(SHEETS.mentors).find(row => row["멘토명"] === name && String(row["PIN"]) === pin && row["사용여부"] === "Y");
  if (!mentor) throw new Error("멘토 이름 또는 PIN이 올바르지 않거나 사용 중지된 계정입니다.");
  return {
    mentor: { name, token: createToken_("mentor", name) },
    taskState: buildMentorTaskState_(name, today_())
  };
}

function getMentorTasks(payload) {
  const auth = requireMentor_(payload.token);
  const date = payload.date || today_();
  return buildMentorTaskState_(auth.name, date);
}

function submitObservation(payload) {
  const auth = requireMentor_(payload.token);
  const date = payload.date || today_();
  const rule = getDateRule_(date);
  if (!rule.isWorkday) throw new Error("작성 대상 날짜가 아닙니다. 관리자에게 예외작성 설정을 요청해 주세요.");
  ensureDailyTasks_(date);

  const child = getActiveChildren_().find(row => row["아동ID"] === payload.childId);
  if (!child) throw new Error("사용 가능한 아동이 아닙니다.");
  if (currentObservationByDateChild_(date, payload.childId)) throw new Error("이미 해당 날짜에 해당 아동의 관찰일지가 작성되었습니다.");

  const writingId = `${date}_${payload.childId}`;
  const originalMentor = child["기본담당멘토"];
  const extraReason = clean_(payload.extraReason) || "해당 없음";
  const writingType = auth.name === originalMentor ? "담당" : (extraReason === "대체 지도" ? "대체" : "추가");
  if (auth.name !== originalMentor && extraReason === "해당 없음") throw new Error("다른 아동 추가 작성 시 추가사유가 필요합니다.");

  const task = findTask_(writingId);
  if (!task) {
    appendRow_(SHEETS.tasks, [writingId, date, child["아동ID"], child["아동명"], originalMentor, "미작성", "", "담당", "해당 없음", rule.deadlineTime]);
  }

  const books = validateBooks_(payload.books);
  const now = nowTime_();
  appendRow_(SHEETS.observations, [
    writingId,
    1,
    "Y",
    date,
    now,
    auth.name,
    child["아동ID"],
    child["아동명"],
    originalMentor,
    auth.name,
    writingType,
    extraReason,
    formatBooks_(books),
    clean_(payload.learningNote),
    clean_(payload.socialWorkerNote),
    "최초작성",
    now,
    "",
    "",
    ""
  ]);

  updateTask_(writingId, {
    "작성상태": "작성완료",
    "실제작성자": auth.name,
    "작성구분": writingType,
    "추가사유": extraReason,
    "마감시간": rule.deadlineTime
  });
  return { taskState: buildMentorTaskState_(auth.name, date) };
}

function updateObservation(payload) {
  const auth = requireMentor_(payload.token);
  const writingId = clean_(payload.writingId);
  const current = getCurrentObservation_(writingId);
  if (!current) throw new Error("수정할 관찰일지를 찾을 수 없습니다.");
  if (current["실제작성자"] !== auth.name) throw new Error("본인이 작성한 관찰일지만 수정할 수 있습니다.");
  if (toDate_(current["제출날짜"]) !== today_()) throw new Error("제출 당일에만 수정할 수 있습니다. 관리자에게 수정 요청해 주세요.");

  const editReason = clean_(payload.editReason);
  if (!editReason) throw new Error("수정사유가 필요합니다.");
  const books = validateBooks_(payload.books);
  const now = nowTime_();
  setCurrentObservationFlag_(writingId, "N");

  appendRow_(SHEETS.observations, [
    writingId,
    Number(current["버전"] || 1) + 1,
    "Y",
    toDate_(current["제출날짜"]),
    current["제출시간"],
    current["제출자"],
    current["아동ID"],
    current["아동명"],
    current["원담당멘토"],
    current["실제작성자"],
    current["작성구분"],
    current["추가사유"],
    formatBooks_(books),
    clean_(payload.learningNote),
    clean_(payload.socialWorkerNote),
    "수정",
    current["최초제출시간"] || current["제출시간"],
    now,
    auth.name,
    editReason
  ]);
  return { taskState: buildMentorTaskState_(auth.name, toDate_(current["제출날짜"])) };
}

function getMentorHistory(payload) {
  const auth = requireMentor_(payload.token);
  const allPeriod = payload.allPeriod === true || payload.allPeriod === "true";
  const date = clean_(payload.date);
  const childId = clean_(payload.childId);
  const records = readRows_(SHEETS.observations)
    .filter(row => row["현재사용여부"] === "Y" && row["실제작성자"] === auth.name)
    .filter(row => allPeriod || !date || toDate_(row["제출날짜"]) === date)
    .filter(row => !childId || row["아동ID"] === childId)
    .sort((a, b) => String(b["제출날짜"]).localeCompare(String(a["제출날짜"])) || String(b["제출시간"]).localeCompare(String(a["제출시간"])))
    .map(observationDto_);
  const children = uniqueBy_(readRows_(SHEETS.observations)
    .filter(row => row["현재사용여부"] === "Y" && row["실제작성자"] === auth.name)
    .map(row => ({ childId: row["아동ID"], childName: row["아동명"] })), "childId");
  return { records, children };
}

function adminLogin(payload) {
  const pin = clean_(payload.pin);
  if (pin !== getSetting_("ADMIN_PIN", "9999")) throw new Error("관리자 PIN이 올바르지 않습니다.");
  return { admin: { token: createToken_("admin", "admin") } };
}

function getAdminDashboard(payload) {
  requireAdmin_(payload.token);
  const date = payload.date || today_();
  const rule = getDateRule_(date);
  if (rule.isWorkday) ensureDailyTasks_(date);

  const childrenById = childrenById_();
  const tasks = rule.isWorkday ? readRows_(SHEETS.tasks)
    .filter(row => toDate_(row["제출날짜"]) === date)
    .filter(row => childrenById[row["아동ID"]] && isChildScheduledOnDate_(childrenById[row["아동ID"]], date)) : [];
  const observations = rule.isWorkday ? readRows_(SHEETS.observations).filter(row => row["현재사용여부"] === "Y" && toDate_(row["제출날짜"]) === date) : [];
  const mentors = readRows_(SHEETS.mentors).filter(row => row["사용여부"] === "Y").map(row => row["멘토명"]);

  const mentorStatus = mentors.map(mentorName => {
    const assigned = tasks.filter(row => row["원담당멘토"] === mentorName);
    const mentorWritten = assigned.filter(task => observations.some(obs => obs["아동ID"] === task["아동ID"] && obs["실제작성자"] === mentorName)).length;
    const proxyWritten = assigned.filter(task => observations.some(obs => obs["아동ID"] === task["아동ID"] && obs["실제작성자"] && obs["실제작성자"] !== mentorName)).length;
    const missing = assigned.length - mentorWritten - proxyWritten;
    const completionRate = assigned.length ? Math.round(((mentorWritten + proxyWritten) / assigned.length) * 1000) / 10 : 0;
    return { mentorName, targetCount: assigned.length, mentorWritten, proxyWritten, missing, completionRate };
  });

  const missing = tasks
    .filter(task => !observations.some(obs => obs["아동ID"] === task["아동ID"]))
    .map(row => ({ childId: row["아동ID"], childName: row["아동명"], originalMentor: row["원담당멘토"], deadlineTime: normalizeTime_(row["마감시간"], rule.deadlineTime) }));

  return {
    deadlineTime: normalizeTime_(rule.deadlineTime, "--:--"),
    notificationEnabled: isNotificationEnabled_(date),
    operationText: rule.operationText,
    mentorStatus,
    missing
  };
}

function getChildrenList(payload) {
  requireAdmin_(payload.token);
  const observations = readRows_(SHEETS.observations).filter(row => row["현재사용여부"] === "Y");
  const children = getActiveChildren_().map(row => {
    const records = observations.filter(obs => obs["아동ID"] === row["아동ID"]);
    records.sort((a, b) => String(b["제출날짜"]).localeCompare(String(a["제출날짜"])));
    return {
      childId: row["아동ID"],
      childName: row["아동명"],
      group: row["그룹"],
      originalMentor: row["기본담당멘토"],
      latestDate: records.length ? toDate_(records[0]["제출날짜"]) : "",
      recordCount: records.length
    };
  });
  return { children };
}

function getChildRecords(payload) {
  requireAdmin_(payload.token);
  const childId = clean_(payload.childId);
  const records = readRows_(SHEETS.observations)
    .filter(row => row["현재사용여부"] === "Y" && row["아동ID"] === childId)
    .sort((a, b) => String(b["제출날짜"]).localeCompare(String(a["제출날짜"])))
    .map(observationDto_);
  return { records };
}

function getObservationDetail(payload) {
  requireAdmin_(payload.token);
  const record = getCurrentObservation_(payload.writingId);
  if (!record) throw new Error("관찰일지를 찾을 수 없습니다.");
  return { record: observationDto_(record) };
}

function getSettings(payload) {
  requireAdmin_(payload.token);
  return {
    settings: {
      defaultDeadlineTime: normalizeTime_(getSetting_("DEFAULT_DEADLINE_TIME", "18:00"), "18:00"),
      globalNotification: getSetting_("GLOBAL_NOTIFICATION", "ON"),
      specificDates: readRows_(SHEETS.dates).map(dateSettingDto_).sort((a, b) => b.date.localeCompare(a.date))
    }
  };
}

function getMentorManagement(payload) {
  requireAdmin_(payload.token);
  const mentors = readRows_(SHEETS.mentors).map(row => ({
    name: row["멘토명"],
    pin: row["PIN"],
    email: row["이메일"],
    active: row["사용여부"] || "Y"
  }));
  const children = getActiveChildren_().map(row => ({
    childId: row["아동ID"],
    childName: row["아동명"],
    group: row["그룹"],
    originalMentor: row["기본담당멘토"],
    subject: row["과목"] || "",
    activityDays: row["활동요일"] || ""
  }));
  return { mentors, children };
}

function saveMentor(payload) {
  requireAdmin_(payload.token);
  const mentor = payload.mentor || {};
  const name = clean_(mentor.name);
  const pin = clean_(mentor.pin);
  const email = clean_(mentor.email);
  const active = clean_(mentor.active) === "N" ? "N" : "Y";
  if (!name || !pin || !email) throw new Error("멘토명, PIN, 이메일은 필수입니다.");
  const row = findRowIndex_(SHEETS.mentors, "멘토명", name);
  if (row > 1) {
    getSheet_(SHEETS.mentors).getRange(row, 1, 1, 4).setValues([[name, pin, email, active]]);
  } else {
    appendRow_(SHEETS.mentors, [name, pin, email, active]);
  }
  return {};
}

function deleteMentor(payload) {
  requireAdmin_(payload.token);
  const name = clean_(payload.name);
  if (!name) throw new Error("삭제할 멘토명이 필요합니다.");

  const rowIndex = findRowIndex_(SHEETS.mentors, "멘토명", name);
  if (rowIndex < 2) throw new Error("삭제할 멘토를 찾을 수 없습니다.");

  const sheet = getSheet_(SHEETS.mentors);
  const values = sheet.getRange(rowIndex, 1, 1, HEADERS[SHEETS.mentors].length).getValues()[0];
  appendRow_(SHEETS.deletedMentors, [...values, nowDateTime_(), "관리자"]);
  sheet.deleteRow(rowIndex);
  return {};
}

function saveMentorAssignment(payload) {
  requireAdmin_(payload.token);
  const assignment = payload.assignment || {};
  const mentorName = clean_(assignment.mentorName);
  const childId = clean_(assignment.childId);
  const subject = clean_(assignment.subject);
  const activityDays = clean_(assignment.activityDays);
  if (!mentorName || !childId || !subject || !activityDays) throw new Error("멘토, 아동, 과목, 활동 요일을 모두 설정해 주세요.");
  const mentor = readRows_(SHEETS.mentors).find(row => row["멘토명"] === mentorName && row["사용여부"] === "Y");
  if (!mentor) throw new Error("사용 중인 멘토를 찾을 수 없습니다.");
  updateByKey_(SHEETS.children, "아동ID", childId, {
    "기본담당멘토": mentorName,
    "과목": subject,
    "활동요일": activityDays
  });
  return {};
}

function saveSettings(payload) {
  requireAdmin_(payload.token);
  setSetting_("DEFAULT_DEADLINE_TIME", normalizeTime_(payload.defaultDeadlineTime, "18:00"));
  setSetting_("GLOBAL_NOTIFICATION", clean_(payload.globalNotification) === "OFF" ? "OFF" : "ON");
  return {};
}

function saveSpecificDateSetting(payload) {
  requireAdmin_(payload.token);
  const setting = payload.setting || {};
  const date = clean_(setting.date);
  if (!date) throw new Error("날짜가 필요합니다.");
  const operationType = clean_(setting.operationType) || "작성";
  const row = [
    date,
    clean_(setting.weekday) || weekdayKo_(date),
    operationType,
    operationType === "작성제외" ? "--:--" : normalizeTime_(setting.deadlineTime, normalizeTime_(getSetting_("DEFAULT_DEADLINE_TIME", "18:00"), "18:00")),
    operationType === "작성제외" ? "OFF" : (clean_(setting.notification) === "OFF" ? "OFF" : "ON"),
    clean_(setting.memo)
  ];
  const found = findRowIndex_(SHEETS.dates, "날짜", date);
  if (found > 1) getSheet_(SHEETS.dates).getRange(found, 1, 1, row.length).setValues([row]);
  else appendRow_(SHEETS.dates, row);
  return {};
}

function deleteSpecificDateSetting(payload) {
  requireAdmin_(payload.token);
  const row = findRowIndex_(SHEETS.dates, "날짜", clean_(payload.date));
  if (row > 1) getSheet_(SHEETS.dates).deleteRow(row);
  return {};
}

function getNotificationLogs(payload) {
  requireAdmin_(payload.token);
  const date = clean_(payload.date);
  const logs = readRows_(SHEETS.logs)
    .filter(row => !date || toDate_(row["발송일자"]) === date)
    .reverse()
    .map(row => ({
      sentDate: toDate_(row["발송일자"]),
      sentAt: row["일시"],
      type: row["알림유형"],
      recipient: row["수신자"],
      children: row["관련 아동"],
      channel: row["채널"],
      result: row["결과"],
      memo: row["비고"]
    }));
  return { logs };
}

function sendMissingNotifications(payload) {
  requireAdmin_(payload.token);
  const date = payload.date || today_();
  const rule = getDateRule_(date);
  if (!rule.isWorkday) return { message: "작성/알림 대상일이 아니므로 발송하지 않았습니다." };
  if (!isNotificationEnabled_(date)) return { message: "알림 OFF 상태이므로 발송하지 않았습니다." };
  ensureDailyTasks_(date);

  const childrenById = childrenById_();
  const tasks = readRows_(SHEETS.tasks)
    .filter(row => toDate_(row["제출날짜"]) === date)
    .filter(row => childrenById[row["아동ID"]] && isChildScheduledOnDate_(childrenById[row["아동ID"]], date));
  const observations = readRows_(SHEETS.observations).filter(row => row["현재사용여부"] === "Y" && toDate_(row["제출날짜"]) === date);
  const mentors = readRows_(SHEETS.mentors).filter(row => row["사용여부"] === "Y");
  const missing = tasks.filter(task => !observations.some(obs => obs["아동ID"] === task["아동ID"]));
  let sent = 0;
  let skipped = 0;

  missing.forEach(task => {
    const type = "미작성 알림";
    if (hasSuccessLog_(date, task["아동명"], type)) {
      skipped++;
      return;
    }
    const mentor = mentors.find(row => row["멘토명"] === task["원담당멘토"]);
    const email = mentor && mentor["이메일"];
    if (!email) {
      appendLog_(date, type, task["원담당멘토"], task["아동명"], "Gmail", "실패", "멘토 이메일 없음");
      return;
    }
    try {
      MailApp.sendEmail({
        to: email,
        subject: `[관찰일지] ${date} ${task["아동명"]} 미작성 알림`,
        body: `${task["원담당멘토"]}님,\n\n${date} ${task["아동명"]} 관찰일지가 아직 작성되지 않았습니다.\n마감시간: ${normalizeTime_(task["마감시간"], rule.deadlineTime)}\n\n이미 다른 멘토가 대신 작성한 경우에는 이 알림이 발송되지 않습니다.`
      });
      appendLog_(date, type, task["원담당멘토"], task["아동명"], "Gmail", "성공", "");
      sent++;
    } catch (error) {
      appendLog_(date, type, task["원담당멘토"], task["아동명"], "Gmail", "실패", error.message);
    }
  });

  const adminEmail = getSetting_("ADMIN_EMAIL", "");
  if (adminEmail && missing.length && !hasSuccessLog_(date, "관리자 요약", "관리자 요약")) {
    MailApp.sendEmail({
      to: adminEmail,
      subject: `[관찰일지] ${date} 미작성 요약`,
      body: missing.map(task => `${task["아동명"]} / ${task["원담당멘토"]}`).join("\n")
    });
    appendLog_(date, "관리자 요약", "관리자", "관리자 요약", "Gmail", "성공", `${missing.length}건`);
  }

  return { message: `알림 처리 완료: 발송 ${sent}건, 중복 제외 ${skipped}건` };
}

function ensureDailyTasks_(date) {
  const rule = getDateRule_(date);
  if (!rule.isWorkday) return;

  const sheet = getSheet_(SHEETS.tasks);
  const existingIds = {};
  readRows_(SHEETS.tasks)
    .filter(row => toDate_(row["제출날짜"]) === date)
    .forEach(row => existingIds[row["작성ID"]] = true);

  const newRows = getActiveChildren_()
    .filter(child => isChildScheduledOnDate_(child, date))
    .map(child => {
      const writingId = `${date}_${child["아동ID"]}`;
      if (existingIds[writingId]) return null;
      existingIds[writingId] = true;
      return [writingId, date, child["아동ID"], child["아동명"], child["기본담당멘토"], "미작성", "", "담당", "해당 없음", rule.deadlineTime];
    })
    .filter(Boolean);

  if (newRows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS[SHEETS.tasks].length).setValues(newRows);
  }
}

function buildMentorTaskState_(mentorName, date) {
  const rule = getDateRule_(date);
  if (rule.isWorkday) ensureDailyTasks_(date);
  const children = getActiveChildren_();
  const childrenById = {};
  children.forEach(child => childrenById[child["아동ID"]] = child);
  const tasks = rule.isWorkday
    ? readRows_(SHEETS.tasks)
      .filter(row => toDate_(row["제출날짜"]) === date && row["원담당멘토"] === mentorName)
      .filter(row => childrenById[row["아동ID"]] && isChildScheduledOnDate_(childrenById[row["아동ID"]], date))
      .map(taskDto_)
    : [];
  return {
    date,
    isWorkday: rule.isWorkday,
    deadlineTime: rule.deadlineTime,
    tasks,
    children: children.map(childDto_)
  };
}

function getDateRule_(date) {
  const specific = readRows_(SHEETS.dates).find(row => toDate_(row["날짜"]) === date);
  if (specific) {
    const operation = specific["운영구분"];
    const excluded = operation === "작성제외";
    return {
      isWorkday: operation === "작성" || operation === "예외작성",
      deadlineTime: excluded ? "--:--" : normalizeTime_(specific["마감시간"], normalizeTime_(getSetting_("DEFAULT_DEADLINE_TIME", "18:00"), "18:00")),
      notification: excluded ? "OFF" : (specific["알림여부"] || "ON"),
      operationText: `특정일자 설정 적용: ${operation}`
    };
  }
  const isWeekday = weekdayNumber_(date) >= 1 && weekdayNumber_(date) <= 5;
  return {
    isWorkday: isWeekday,
    deadlineTime: normalizeTime_(getSetting_("DEFAULT_DEADLINE_TIME", "18:00"), "18:00"),
    notification: "ON",
    operationText: isWeekday ? "평일 기본 적용" : "주말 기본 제외"
  };
}

function isNotificationEnabled_(date) {
  if (getSetting_("GLOBAL_NOTIFICATION", "ON") === "OFF") return false;
  const rule = getDateRule_(date);
  return rule.isWorkday && rule.notification !== "OFF";
}

function getActiveChildren_() {
  return readRows_(SHEETS.children).filter(row => row["사용여부"] === "Y");
}

function childrenById_() {
  const map = {};
  getActiveChildren_().forEach(child => map[child["아동ID"]] = child);
  return map;
}

function isChildScheduledOnDate_(child, date) {
  const daysText = clean_(child["활동요일"]);
  if (!daysText) return true;
  const days = daysText.split(",").map(day => day.trim()).filter(Boolean);
  return days.includes(weekdayKo_(date));
}

function findTask_(writingId) {
  return readRows_(SHEETS.tasks).find(row => row["작성ID"] === writingId);
}

function updateTask_(writingId, changes) {
  updateByKey_(SHEETS.tasks, "작성ID", writingId, changes);
}

function currentObservationByDateChild_(date, childId) {
  return readRows_(SHEETS.observations).find(row => row["현재사용여부"] === "Y" && toDate_(row["제출날짜"]) === date && row["아동ID"] === childId);
}

function getCurrentObservation_(writingId) {
  return readRows_(SHEETS.observations).find(row => row["작성ID"] === writingId && row["현재사용여부"] === "Y");
}

function setCurrentObservationFlag_(writingId, flag) {
  const sheet = getSheet_(SHEETS.observations);
  const rows = readRows_(SHEETS.observations);
  const headers = HEADERS[SHEETS.observations];
  rows.forEach((row, index) => {
    if (row["작성ID"] === writingId && row["현재사용여부"] === "Y") {
      sheet.getRange(index + 2, headers.indexOf("현재사용여부") + 1).setValue(flag);
    }
  });
}

function validateBooks_(books) {
  if (!Array.isArray(books)) throw new Error("문제집명/페이지 형식이 올바르지 않습니다.");
  const cleaned = books.map(item => clean_(item).replace(/\s*\n+\s*/g, " ")).filter(Boolean);
  if (!cleaned.length || cleaned.length !== books.length) throw new Error("문제집명/페이지는 1개 이상 필수이며 빈 항목은 저장할 수 없습니다.");
  return cleaned;
}

function formatBooks_(books) {
  return books.map((book, index) => `${index + 1}) ${book}`).join("\n");
}

function observationDto_(row) {
  return {
    writingId: row["작성ID"],
    version: Number(row["버전"] || 1),
    isCurrent: row["현재사용여부"],
    date: toDate_(row["제출날짜"]),
    weekday: weekdayKo_(toDate_(row["제출날짜"])),
    submittedTime: row["제출시간"],
    submitter: row["제출자"],
    childId: row["아동ID"],
    childName: row["아동명"],
    originalMentor: row["원담당멘토"],
    actualWriter: row["실제작성자"],
    writingType: normalizeWritingType_(row["작성구분"]),
    extraReason: row["추가사유"],
    bookPages: row["문제집명/페이지"],
    books: String(row["문제집명/페이지"] || "").split(/\n+/).map(line => line.replace(/^\d+\)\s*/, "").trim()).filter(Boolean),
    learningNote: row["학습태도 및 특이사항"],
    socialWorkerNote: row["담당 사회복지사 전달사항"],
    editStatus: row["수정상태"],
    firstSubmittedTime: row["최초제출시간"],
    lastModifiedTime: row["최종수정시간"],
    editor: row["수정자"],
    editReason: row["수정사유"]
  };
}

function taskDto_(row) {
  return {
    writingId: row["작성ID"],
    date: toDate_(row["제출날짜"]),
    childId: row["아동ID"],
    childName: row["아동명"],
    originalMentor: row["원담당멘토"],
    status: row["작성상태"],
    actualWriter: row["실제작성자"],
    writingType: normalizeWritingType_(row["작성구분"]),
    extraReason: row["추가사유"],
    deadlineTime: normalizeTime_(row["마감시간"], "")
  };
}

function childDto_(row) {
  return {
    childId: row["아동ID"],
    childName: row["아동명"],
    group: row["그룹"],
    originalMentor: row["기본담당멘토"],
    subject: row["과목"] || "",
    activityDays: row["활동요일"] || ""
  };
}

function dateSettingDto_(row) {
  return {
    date: toDate_(row["날짜"]),
    weekday: row["요일"],
    operationType: row["운영구분"],
    deadlineTime: row["운영구분"] === "작성제외" ? "--:--" : normalizeTime_(row["마감시간"], ""),
    notification: row["운영구분"] === "작성제외" ? "OFF" : row["알림여부"],
    memo: row["비고"]
  };
}

function normalizeWritingType_(type) {
  return !type || type === "지정" ? "담당" : type;
}

function normalizeTime_(value, fallback) {
  if (value === "--:--") return "--:--";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "Asia/Seoul", "HH:mm");
  }
  const text = clean_(value);
  if (!text) return fallback || "";
  const hhmm = text.match(/^(\d{1,2}):(\d{2})/);
  if (hhmm) {
    return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
  }
  return fallback || text;
}

function createToken_(role, name) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`token:${token}`, JSON.stringify({ role, name }), 21600);
  return token;
}

function requireMentor_(token) {
  const auth = readToken_(token);
  if (!auth || auth.role !== "mentor") throw new Error("멘토 로그인이 필요합니다.");
  return auth;
}

function requireAdmin_(token) {
  const auth = readToken_(token);
  if (!auth || auth.role !== "admin") throw new Error("관리자 로그인이 필요합니다.");
  return auth;
}

function readToken_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get(`token:${token}`);
  return raw ? JSON.parse(raw) : null;
}

function getSetting_(key, fallback) {
  const row = readRows_(SHEETS.settings).find(item => item["항목"] === key);
  return row ? row["값"] : fallback;
}

function setSetting_(key, value) {
  const row = findRowIndex_(SHEETS.settings, "항목", key);
  if (row > 1) getSheet_(SHEETS.settings).getRange(row, 2).setValue(value);
  else appendRow_(SHEETS.settings, [key, value, ""]);
}

function hasSuccessLog_(date, childName, type) {
  return readRows_(SHEETS.logs).some(row => toDate_(row["발송일자"]) === date && row["관련 아동"] === childName && row["알림유형"] === type && row["결과"] === "성공");
}

function appendLog_(date, type, recipient, children, channel, result, memo) {
  appendRow_(SHEETS.logs, [date, nowDateTime_(), type, recipient, children, channel, result, memo]);
}

function readRows_(name) {
  const sheet = getSheet_(name);
  const lastRow = sheet.getLastRow();
  const headers = HEADERS[name];
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, headers.length).getValues().map(values => {
    const row = {};
    headers.forEach((header, index) => row[header] = values[index]);
    return row;
  });
}

function appendRow_(name, values) {
  getSheet_(name).appendRow(values);
}

function updateByKey_(name, keyHeader, keyValue, changes) {
  const rowIndex = findRowIndex_(name, keyHeader, keyValue);
  if (rowIndex < 2) throw new Error("수정할 행을 찾을 수 없습니다.");
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  Object.keys(changes).forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(rowIndex, col).setValue(changes[header]);
  });
}

function findRowIndex_(name, keyHeader, keyValue) {
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol < 1 || sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(keyValue)) return i + 2;
  }
  return -1;
}

function getSheet_(name) {
  return getSpreadsheet_().getSheetByName(name);
}

function getSpreadsheet_() {
  if (!SPREADSHEET_CACHE) {
    SPREADSHEET_CACHE = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return SPREADSHEET_CACHE;
}

function parsePayload_(e) {
  if (e && e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  return (e && e.parameter) || {};
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clean_(value) {
  return String(value == null ? "" : value).trim();
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Seoul", "yyyy-MM-dd");
}

function nowTime_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Seoul", "HH:mm");
}

function nowDateTime_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
}

function toDate_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || "Asia/Seoul", "yyyy-MM-dd");
  }
  return clean_(value).slice(0, 10);
}

function weekdayNumber_(date) {
  return new Date(`${date}T00:00:00`).getDay();
}

function weekdayKo_(date) {
  return ["일", "월", "화", "수", "목", "금", "토"][weekdayNumber_(date)];
}

function uniqueBy_(items, key) {
  const map = {};
  return items.filter(item => {
    if (map[item[key]]) return false;
    map[item[key]] = true;
    return true;
  });
}
