/* 실제 API 연동 설정: Apps Script Web App URL을 붙여 넣으세요. */
const APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbwnkxoLijfYHXuyUqaeBXsEThngCwgcCuIe1PX-YRBqEsV9FH8513SHbsFhG87mVRh8-A/exec",
  DATA_PAGE_URL: "https://docs.google.com/spreadsheets/d/1CvJq8NTV0aCGPq9qHPBL6adUYUfDvHq2RTlOG-gD9eI/edit?hl=ko&gid=0#gid=0",
  SYSTEM_PASSWORD_HASH: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4" // 1234
};

const today = toDateString(new Date());
let pendingRequests = 0;
let adminToken = "";
let dashboardState = null;
let childrenState = [];
let childRecordState = [];
let settingsState = { defaultDeadlineTime: "18:00", globalNotification: "ON", specificDates: [] };
let logState = [];
let mentorManagementState = { mentors: [], children: [] };

function isApiMode() {
  return APP_CONFIG.API_URL && !APP_CONFIG.API_URL.includes("PASTE_APPS_SCRIPT");
}

async function callApi(action, payload = {}) {
  if (!isApiMode()) {
    throw new Error("Apps Script Web App URL이 설정되지 않았습니다. admin.js의 APP_CONFIG.API_URL을 배포 URL로 교체해 주세요.");
  }

  setPageLoading(true);
  try {
    const response = await fetch(APP_CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "요청 처리 중 오류가 발생했습니다.");
    return data;
  } finally {
    setPageLoading(false);
  }
}

function setPageLoading(isLoading) {
  pendingRequests += isLoading ? 1 : -1;
  pendingRequests = Math.max(0, pendingRequests);
  document.body.classList.toggle("loading", pendingRequests > 0);
  document.body.setAttribute("aria-busy", pendingRequests > 0 ? "true" : "false");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function adminLogin() {
  const systemPassword = document.getElementById("adminSystemPassword").value.trim();
  const pin = document.getElementById("adminPin").value.trim();
  if ((await sha256(systemPassword)) !== APP_CONFIG.SYSTEM_PASSWORD_HASH) {
    alert("시스템 비밀번호가 올바르지 않습니다.");
    return;
  }
  try {
    const data = await callApi("adminLogin", { pin });
    adminToken = data.admin.token;
    sessionStorage.setItem("adminToken", adminToken);
    document.getElementById("dashboardDate").value = today;
    document.getElementById("logDateFilter").value = today;
    await initAdmin();
    showOnlyAdmin("adminPage");
  } catch (error) {
    alert(error.message);
  }
}

async function initAdmin() {
  await Promise.all([loadSettings(), loadDashboard()]);
}

async function loadDashboard() {
  clampDateInputToToday("dashboardDate");
  const date = document.getElementById("dashboardDate").value || today;
  const data = await callApi("getAdminDashboard", { token: adminToken, date });
  dashboardState = data;
  renderDashboard();
}

function renderDashboard() {
  if (!dashboardState) return;
  const info = document.getElementById("dashboardDeadlineInfo");
  info.innerHTML = `
    <span class="mini-status"><strong>마감시간</strong> ${escapeHtml(dashboardState.deadlineTime || "--:--")}</span>
    <span class="mini-status ${dashboardState.notificationEnabled ? "on" : "off"}"><strong>알림</strong> ${dashboardState.notificationEnabled ? "ON" : "OFF"}</span>
    <span class="mini-status"><strong>운영규칙</strong> ${escapeHtml(dashboardState.operationText || "-")}</span>
  `;

  const statusBody = document.getElementById("mentorStatusBody");
  statusBody.innerHTML = "";
  (dashboardState.mentorStatus || []).forEach(row => {
    statusBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(row.mentorName)}</td>
        <td>${row.targetCount}</td>
        <td>${row.mentorWritten}</td>
        <td>${row.proxyWritten}</td>
        <td><span class="badge ${row.missing ? "missing" : "done"}">${row.missing}</span></td>
        <td>${row.completionRate}%</td>
      </tr>
    `);
  });

  const missingBody = document.getElementById("missingBody");
  missingBody.innerHTML = "";
  if (!(dashboardState.missing || []).length) {
    missingBody.innerHTML = `<tr><td colspan="4">미작성 건이 없습니다.</td></tr>`;
    return;
  }
  dashboardState.missing.forEach(row => {
    missingBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(row.childName)}</td>
        <td>${escapeHtml(row.originalMentor)}</td>
        <td>${escapeHtml(row.deadlineTime || "-")}</td>
        <td><span class="badge missing">미작성</span></td>
      </tr>
    `);
  });
}

async function loadChildrenList() {
  const data = await callApi("getChildrenList", { token: adminToken });
  childrenState = data.children || [];
  fillChildrenFilters();
  renderChildrenList();
}

function fillChildrenFilters() {
  const groupFilter = document.getElementById("groupFilter");
  const mentorFilter = document.getElementById("mentorFilter");
  const groupValue = groupFilter.value;
  const mentorValue = mentorFilter.value;
  groupFilter.innerHTML = `<option value="">전체 그룹</option>`;
  mentorFilter.innerHTML = `<option value="">전체 멘토</option>`;
  [...new Set(childrenState.map(child => child.group).filter(Boolean))].forEach(group => groupFilter.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(group)}">${escapeHtml(group)}</option>`));
  [...new Set(childrenState.map(child => child.originalMentor).filter(Boolean))].forEach(mentor => mentorFilter.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(mentor)}">${escapeHtml(mentor)}</option>`));
  groupFilter.value = groupValue;
  mentorFilter.value = mentorValue;
}

function renderChildrenList() {
  const keyword = document.getElementById("childSearch").value.trim();
  const group = document.getElementById("groupFilter").value;
  const mentor = document.getElementById("mentorFilter").value;
  const body = document.getElementById("childrenBody");
  body.innerHTML = "";
  childrenState
    .filter(child => !keyword || child.childName.includes(keyword))
    .filter(child => !group || child.group === group)
    .filter(child => !mentor || child.originalMentor === mentor)
    .forEach(child => {
      body.insertAdjacentHTML("beforeend", `
        <tr>
          <td>${escapeHtml(child.childName)}</td>
          <td>${escapeHtml(child.group || "-")}</td>
          <td>${escapeHtml(child.originalMentor)}</td>
          <td>${escapeHtml(child.latestDate || "-")}</td>
          <td>${child.recordCount || 0}건</td>
          <td><button type="button" onclick="openChildDetail('${child.childId}')">보기</button></td>
        </tr>
      `);
    });
}

async function openChildDetail(childId) {
  const child = childrenState.find(item => item.childId === childId);
  const data = await callApi("getChildRecords", { token: adminToken, childId });
  childRecordState = data.records || [];
  document.getElementById("childDetailTitle").textContent = `${child.childName} 관찰일지`;
  document.getElementById("childDetailMeta").textContent = `그룹 ${child.group || "-"} / 기본담당멘토 ${child.originalMentor}`;
  const body = document.getElementById("childRecordsBody");
  body.innerHTML = "";
  if (!childRecordState.length) {
    body.innerHTML = `<tr><td colspan="9">작성된 관찰일지가 없습니다.</td></tr>`;
  }
  childRecordState.forEach(record => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(record.date)}</td>
        <td>${escapeHtml(record.weekday || "-")}</td>
        <td>${escapeHtml(record.originalMentor)}</td>
        <td>${escapeHtml(record.actualWriter)}</td>
        <td>${typeBadge(record.writingType)}</td>
        <td>${escapeHtml(record.extraReason || "-")}</td>
        <td>${record.editStatus === "수정" ? `<span class="badge replace">수정 v${record.version}</span>` : `<span class="badge done">최초작성</span>`}</td>
        <td><button class="secondary" type="button" onclick="showObservationDetail('${record.writingId}')">보기</button></td>
        <td><button type="button" onclick="printObservation('${record.writingId}')">인쇄</button></td>
      </tr>
    `);
  });
  document.getElementById("childDetailSection").classList.remove("hidden");
  document.getElementById("observationDetail").classList.add("hidden");
}

async function showObservationDetail(writingId) {
  const data = await callApi("getObservationDetail", { token: adminToken, writingId });
  const record = data.record;
  document.getElementById("observationDetailBody").innerHTML = observationDetailHtml(record, false);
  document.getElementById("observationDetail").classList.remove("hidden");
}

async function printObservation(writingId) {
  const data = await callApi("getObservationDetail", { token: adminToken, writingId });
  const record = data.record;
  document.getElementById("printArea").innerHTML = `<h1>관찰일지</h1>${observationDetailHtml(record, false)}`;
  window.print();
}

function closeChildDetail() {
  document.getElementById("childDetailSection").classList.add("hidden");
}

function hideObservationDetail() {
  document.getElementById("observationDetail").classList.add("hidden");
}

async function loadSettings() {
  const data = await callApi("getSettings", { token: adminToken });
  settingsState = data.settings;
  renderSettings();
}

function renderSettings() {
  document.getElementById("defaultDeadlineTime").value = settingsState.defaultDeadlineTime || "18:00";
  document.getElementById("globalNotificationToggle").value = settingsState.globalNotification || "ON";
  updateNotificationStatus();
  renderSpecificSettingsTable();
  resetSpecificDateForm(false);
}

function updateNotificationStatus() {
  const button = document.getElementById("globalNotificationStatusBtn");
  const isOn = settingsState.globalNotification !== "OFF";
  button.textContent = `알림 ${isOn ? "ON" : "OFF"}`;
  button.classList.toggle("on", isOn);
  button.classList.toggle("off", !isOn);
}

async function saveSettings() {
  try {
    const defaultDeadlineTime = document.getElementById("defaultDeadlineTime").value;
    const globalNotification = document.getElementById("globalNotificationToggle").value;
    await callApi("saveSettings", { token: adminToken, defaultDeadlineTime, globalNotification });
    await loadSettings();
    await loadDashboard();
    alert("설정이 저장되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

async function saveSpecificDateSetting() {
  clampDateInputToToday("specificDate");
  handleSpecificOperationChange();
  const operationType = document.getElementById("specificOperation").value;
  const setting = {
    date: document.getElementById("specificDate").value,
    weekday: document.getElementById("specificWeekday").value,
    operationType,
    deadlineTime: operationType === "작성제외" ? "--:--" : document.getElementById("specificDeadlineTime").value,
    notification: operationType === "작성제외" ? "OFF" : document.getElementById("specificNotificationToggle").value,
    memo: document.getElementById("specificMemo").value.trim()
  };
  if (!setting.date || !setting.deadlineTime) {
    alert("날짜와 마감시간을 입력해 주세요.");
    return;
  }
  if (setting.operationType !== "작성제외" && !/^\d{2}:\d{2}$/.test(setting.deadlineTime)) {
    alert("마감시간은 18:00 형식으로 입력해 주세요.");
    return;
  }
  try {
    await callApi("saveSpecificDateSetting", { token: adminToken, setting });
    await loadSettings();
    await loadDashboard();
    alert("특정일자 설정이 저장되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSpecificDateSetting(date) {
  if (!confirm(`${date} 설정을 삭제할까요?`)) return;
  await callApi("deleteSpecificDateSetting", { token: adminToken, date });
  await loadSettings();
  await loadDashboard();
}

function renderSpecificSettingsTable() {
  const body = document.getElementById("specificSettingsBody");
  body.innerHTML = "";
  const rows = settingsState.specificDates || [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7">특정일자 설정이 없습니다.</td></tr>`;
    return;
  }
  rows.forEach(row => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.weekday)}</td>
        <td>${escapeHtml(row.operationType)}</td>
        <td>${escapeHtml(row.deadlineTime)}</td>
        <td><span class="badge ${row.notification === "ON" ? "done" : "missing"}">${escapeHtml(row.notification)}</span></td>
        <td>${escapeHtml(row.memo || "-")}</td>
        <td>
          <button class="secondary" type="button" onclick="editSpecificSetting('${row.date}')">수정</button>
          <button class="ghost" type="button" onclick="deleteSpecificDateSetting('${row.date}')">삭제</button>
        </td>
      </tr>
    `);
  });
}

function editSpecificSetting(date) {
  const row = settingsState.specificDates.find(item => item.date === date);
  if (!row) return;
  document.getElementById("specificDate").value = row.date;
  document.getElementById("specificWeekday").value = row.weekday;
  document.getElementById("specificOperation").value = row.operationType;
  document.getElementById("specificDeadlineTime").value = row.deadlineTime;
  document.getElementById("specificNotificationToggle").value = row.notification;
  document.getElementById("specificMemo").value = row.memo || "";
  handleSpecificOperationChange();
}

function resetSpecificDateForm(resetMemo = true) {
  document.getElementById("specificDate").value = today;
  document.getElementById("specificWeekday").value = getKoreanWeekday(today);
  document.getElementById("specificOperation").value = "작성";
  document.getElementById("specificDeadlineTime").value = settingsState.defaultDeadlineTime || "18:00";
  document.getElementById("specificNotificationToggle").value = "ON";
  if (resetMemo) document.getElementById("specificMemo").value = "";
  handleSpecificOperationChange();
}

function syncSpecificWeekday() {
  clampDateInputToToday("specificDate");
  const date = document.getElementById("specificDate").value;
  document.getElementById("specificWeekday").value = date ? getKoreanWeekday(date) : "";
}

function setDateInputMaxToday(id) {
  const input = document.getElementById(id);
  if (!input) return;
  input.max = today;
}

function clampDateInputToToday(id) {
  const input = document.getElementById(id);
  if (!input || !input.value) return;
  if (input.value > today) {
    input.value = today;
    alert("미래 날짜는 선택할 수 없습니다.");
  }
}

function handleSpecificOperationChange() {
  const operation = document.getElementById("specificOperation").value;
  const deadline = document.getElementById("specificDeadlineTime");
  const notification = document.getElementById("specificNotificationToggle");
  if (operation === "작성제외") {
    deadline.value = "--:--";
    deadline.readOnly = true;
    notification.value = "OFF";
    notification.disabled = true;
    return;
  }
  deadline.readOnly = false;
  notification.disabled = false;
  if (!/^\d{2}:\d{2}$/.test(deadline.value)) {
    deadline.value = settingsState.defaultDeadlineTime || "18:00";
  }
}

async function loadMentorManagement() {
  const data = await callApi("getMentorManagement", { token: adminToken });
  mentorManagementState = { mentors: data.mentors || [], children: data.children || [] };
  renderMentorManagement();
  fillAssignmentControls();
}

function renderMentorManagement() {
  const mentorBody = document.getElementById("mentorManageBody");
  const assignmentBody = document.getElementById("assignmentBody");
  if (!mentorBody || !assignmentBody) return;

  mentorBody.innerHTML = "";
  mentorManagementState.mentors.forEach(mentor => {
    const assignedChildren = mentorManagementState.children
      .filter(child => child.originalMentor === mentor.name)
      .map(child => `${child.childName}${child.subject ? `(${child.subject})` : ""}`)
      .join(", ");
    mentorBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(mentor.name)}</td>
        <td>${escapeHtml(mentor.email || "-")}</td>
        <td><span class="badge ${mentor.active === "Y" ? "done" : "missing"}">${escapeHtml(mentor.active || "N")}</span></td>
        <td>${escapeHtml(assignedChildren || "-")}</td>
        <td>
          <button class="secondary" type="button" onclick="editMentor('${escapeAttribute(mentor.name)}')">수정</button>
          <button class="ghost" type="button" onclick="deleteMentor('${escapeAttribute(mentor.name)}')">삭제</button>
        </td>
      </tr>
    `);
  });

  assignmentBody.innerHTML = "";
  mentorManagementState.children.forEach(child => {
    assignmentBody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(child.childName)}</td>
        <td>${escapeHtml(child.group || "-")}</td>
        <td>${escapeHtml(child.originalMentor || "-")}</td>
        <td>${escapeHtml(child.subject || "-")}</td>
        <td>${escapeHtml(child.activityDays || "-")}</td>
        <td><button class="secondary" type="button" onclick="editAssignment('${child.childId}')">수정</button></td>
      </tr>
    `);
  });
}

function fillAssignmentControls() {
  const mentorSelect = document.getElementById("assignmentMentor");
  const childSelect = document.getElementById("assignmentChild");
  if (!mentorSelect || !childSelect) return;
  const previousMentor = mentorSelect.value;
  const previousChild = childSelect.value;
  mentorSelect.innerHTML = `<option value="">멘토 선택</option>`;
  childSelect.innerHTML = `<option value="">아동 선택</option>`;
  mentorManagementState.mentors
    .filter(mentor => mentor.active !== "N")
    .forEach(mentor => mentorSelect.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(mentor.name)}">${escapeHtml(mentor.name)}</option>`));
  mentorManagementState.children
    .forEach(child => childSelect.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(child.childId)}">${escapeHtml(child.childName)} / ${escapeHtml(child.group || "-")}</option>`));
  mentorSelect.value = previousMentor;
  childSelect.value = previousChild;
}

function editMentor(name) {
  const mentor = mentorManagementState.mentors.find(item => item.name === name);
  if (!mentor) return;
  document.getElementById("mentorManageName").value = mentor.name;
  document.getElementById("mentorManagePin").value = mentor.pin || "";
  document.getElementById("mentorManageEmail").value = mentor.email || "";
  document.getElementById("mentorManageActive").value = mentor.active || "Y";
}

function editAssignment(childId) {
  const child = mentorManagementState.children.find(item => item.childId === childId);
  if (!child) return;
  document.getElementById("assignmentMentor").value = child.originalMentor || "";
  document.getElementById("assignmentChild").value = child.childId;
  document.getElementById("assignmentSubject").value = child.subject || "";
  setSelectedDays(child.activityDays || "");
}

async function saveMentor() {
  const mentor = {
    name: document.getElementById("mentorManageName").value.trim(),
    pin: document.getElementById("mentorManagePin").value.trim(),
    email: document.getElementById("mentorManageEmail").value.trim(),
    active: document.getElementById("mentorManageActive").value
  };
  if (!mentor.name || !mentor.pin || !mentor.email) {
    alert("멘토명, PIN, 메일주소를 모두 입력해 주세요.");
    return;
  }
  try {
    await callApi("saveMentor", { token: adminToken, mentor });
    await loadMentorManagement();
    await loadChildrenList();
    await loadDashboard();
    alert("멘토 정보가 구글시트에 저장되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

async function deleteMentor(name) {
  const mentor = mentorManagementState.mentors.find(item => item.name === name);
  if (!mentor) return;
  if (!confirm(`${name} 멘토를 삭제 처리할까요?\n멘토관리 시트에서는 제거되고 삭제멘토 시트로 이관됩니다.`)) return;
  try {
    await callApi("deleteMentor", { token: adminToken, name });
    await loadMentorManagement();
    await loadChildrenList();
    await loadDashboard();
    alert("멘토 정보가 삭제멘토 시트로 이관되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

async function saveMentorAssignment() {
  const assignment = {
    mentorName: document.getElementById("assignmentMentor").value,
    childId: document.getElementById("assignmentChild").value,
    subject: document.getElementById("assignmentSubject").value.trim(),
    activityDays: getSelectedDays().join(",")
  };
  if (!assignment.mentorName || !assignment.childId || !assignment.subject || !assignment.activityDays) {
    alert("멘토, 아동, 과목, 활동 요일을 모두 설정해 주세요.");
    return;
  }
  try {
    await callApi("saveMentorAssignment", { token: adminToken, assignment });
    await loadMentorManagement();
    await loadChildrenList();
    await loadDashboard();
    alert("담당 아동/과목/요일 설정이 구글시트에 저장되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

function getSelectedDays() {
  return [...document.querySelectorAll('input[name="assignmentDays"]:checked')].map(input => input.value);
}

function setSelectedDays(daysText) {
  const days = String(daysText).split(",").map(day => day.trim()).filter(Boolean);
  document.querySelectorAll('input[name="assignmentDays"]').forEach(input => {
    input.checked = days.includes(input.value);
  });
}

async function loadNotificationLogs() {
  clampDateInputToToday("logDateFilter");
  const date = document.getElementById("logDateFilter").value;
  const data = await callApi("getNotificationLogs", { token: adminToken, date });
  logState = data.logs || [];
  const body = document.getElementById("notificationLogBody");
  body.innerHTML = "";
  if (!logState.length) {
    body.innerHTML = `<tr><td colspan="8">알림 로그가 없습니다.</td></tr>`;
    return;
  }
  logState.forEach(log => {
    body.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(log.sentDate)}</td>
        <td>${escapeHtml(log.sentAt)}</td>
        <td>${escapeHtml(log.type)}</td>
        <td>${escapeHtml(log.recipient)}</td>
        <td>${escapeHtml(log.children || "-")}</td>
        <td>${escapeHtml(log.channel)}</td>
        <td>${escapeHtml(log.result)}</td>
        <td>${escapeHtml(log.memo || "-")}</td>
      </tr>
    `);
  });
}

async function sendMissingNotifications() {
  const date = document.getElementById("dashboardDate").value || today;
  if (!confirm(`${date} 기준 미작성 알림을 발송할까요?`)) return;
  try {
    const data = await callApi("sendMissingNotifications", { token: adminToken, date });
    await loadDashboard();
    await loadNotificationLogs();
    alert(data.message || "알림 발송 처리가 완료되었습니다.");
  } catch (error) {
    alert(error.message);
  }
}

function showAdminTab(id, button) {
  ["dashboardSection", "childrenSection", "mentorSection", "settingsSection", "logSection"].forEach(section => {
    document.getElementById(section).classList.toggle("hidden", section !== id);
  });
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  button.classList.add("active");
  if (id === "childrenSection") loadChildrenList();
  if (id === "mentorSection") loadMentorManagement();
  if (id === "logSection") loadNotificationLogs();
}

function goAdminSettings() {
  showAdminTab("settingsSection", document.querySelectorAll(".tab")[3]);
}

function goAdminHome() {
  if (!adminToken && !sessionStorage.getItem("adminToken")) {
    showOnlyAdmin("adminGatePage");
    return;
  }
  adminToken = adminToken || sessionStorage.getItem("adminToken");
  showOnlyAdmin("adminPage");
  showAdminTab("dashboardSection", document.querySelectorAll(".tab")[0]);
}

function logoutAdmin() {
  if (!confirm("로그아웃할까요?")) return;
  sessionStorage.removeItem("adminToken");
  adminToken = "";
  showOnlyAdmin("adminGatePage");
}

function openDataPage() {
  window.open(APP_CONFIG.DATA_PAGE_URL, "_blank", "noopener,noreferrer");
}

function showOnlyAdmin(id) {
  document.getElementById("adminGatePage").classList.toggle("hidden", id !== "adminGatePage");
  document.getElementById("adminPage").classList.toggle("hidden", id !== "adminPage");
}

function observationDetailHtml(record) {
  const books = record.books || splitBooks(record.bookPages);
  return `
    <div class="detail-body">
      <div class="detail-item"><strong>1. 제출자</strong><br>${escapeHtml(record.actualWriter)}</div>
      <div class="detail-item"><strong>2. 제출날짜</strong><br>${escapeHtml(record.date)}</div>
      <div class="detail-item"><strong>3. 아동 이름</strong><br>${escapeHtml(record.childName)}</div>
      <div class="detail-item"><strong>4. 문제집명/페이지</strong><br>${books.map((book, index) => `${index + 1}) ${escapeHtml(book)}`).join("<br>")}</div>
      <div class="detail-item"><strong>5. 학습태도 및 특이사항</strong><br>${nl2br(record.learningNote)}</div>
      <div class="detail-item"><strong>6. 담당 사회복지사 전달사항</strong><br>${nl2br(record.socialWorkerNote)}</div>
      ${record.editStatus === "수정" ? `<div class="print-section"><strong>버전</strong> ${record.version}<br><strong>수정상태</strong> ${escapeHtml(record.editStatus)}<br><strong>수정시간</strong> ${escapeHtml(record.lastModifiedTime || "-")}<br><strong>수정사유</strong> ${escapeHtml(record.editReason || "-")}</div>` : ""}
    </div>
  `;
}

function typeBadge(type) {
  const displayType = !type || type === "지정" ? "담당" : type;
  const className = displayType === "대체" ? "replace" : displayType === "추가" ? "extra" : "done";
  return `<span class="badge ${className}">${escapeHtml(displayType)}</span>`;
}

function splitBooks(value = "") {
  return String(value).split(/\n+/).map(line => line.replace(/^\d+\)\s*/, "").trim()).filter(Boolean);
}

function toDateString(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getKoreanWeekday(dateString) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return days[new Date(`${dateString}T00:00:00`).getDay()];
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function nl2br(value = "") {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

window.addEventListener("load", async () => {
  ["dashboardDate", "specificDate", "logDateFilter"].forEach(setDateInputMaxToday);
  document.getElementById("dashboardDate").value = today;
  document.getElementById("logDateFilter").value = today;
  adminToken = sessionStorage.getItem("adminToken") || "";
  if (adminToken) {
    try {
      await initAdmin();
      showOnlyAdmin("adminPage");
    } catch {
      logoutAdmin();
    }
  }
});
