/* =========================
   실제 API 연동 설정
   =========================
   Apps Script 배포 후 Web App URL을 API_URL에 붙여 넣으세요.
*/
const APP_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzhOsfvEbPiENCowYxLCLhiGF527J5tYi7p3F64Z5WGmEquXvWaqsTVrkwOzYmdVJUrSA/exec",
  SYSTEM_PASSWORD_HASH: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4" // 1234
};

const today = toDateString(new Date());
let currentMentor = null;
let currentToken = "";
let taskState = { date: today, isWorkday: true, tasks: [], children: [] };
let currentTask = null;
let historyState = { allPeriod: false, records: [], childOptions: [] };
let editTarget = null;

function isApiMode() {
  return APP_CONFIG.API_URL && !APP_CONFIG.API_URL.includes("PASTE_APPS_SCRIPT");
}

async function callApi(action, payload = {}) {
  if (!isApiMode()) {
    throw new Error("Apps Script Web App URL이 설정되지 않았습니다. mentor.js의 APP_CONFIG.API_URL을 배포 URL로 교체해 주세요.");
  }

  const response = await fetch(APP_CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.message || "요청 처리 중 오류가 발생했습니다.");
  return data;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function checkSystemPassword() {
  const input = document.getElementById("systemPassword").value.trim();
  if ((await sha256(input)) !== APP_CONFIG.SYSTEM_PASSWORD_HASH) {
    alert("시스템 비밀번호가 올바르지 않습니다.");
    return;
  }
  sessionStorage.setItem("mentorSystemAccess", "Y");
  showOnly("loginPage");
}

async function mentorLogin() {
  const name = document.getElementById("mentorName").value.trim();
  const pin = document.getElementById("mentorPin").value.trim();
  if (!name || !pin) {
    alert("멘토 이름과 PIN을 입력해 주세요.");
    return;
  }

  try {
    const data = await callApi("loginMentor", { name, pin });
    currentMentor = data.mentor.name;
    currentToken = data.mentor.token;
    sessionStorage.setItem("mentorName", currentMentor);
    sessionStorage.setItem("mentorToken", currentToken);
    document.getElementById("formMentor").value = currentMentor;
    document.getElementById("formDate").value = today;
    document.getElementById("historyDateFilter").value = today;
    document.getElementById("welcomeMessage").textContent = `${currentMentor}님, 오늘 작성 대상 아동을 확인해 주세요.`;
    showOnly("mentorPage");
    await loadMentorTasks();
  } catch (error) {
    alert(error.message);
  }
}

async function loadMentorTasks() {
  const data = await callApi("getMentorTasks", { token: currentToken, date: today });
  taskState = data;
  renderTasks();
}

function renderTasks() {
  const notice = document.getElementById("workdayNotice");
  const list = document.getElementById("taskList");
  list.innerHTML = "";

  if (!taskState.isWorkday) {
    notice.textContent = `${taskState.date}은 기본 작성/알림 대상일이 아닙니다. 관리자 예외작성 설정이 있는 날짜만 작성할 수 있습니다.`;
  } else {
    notice.textContent = `${taskState.date} 작성 대상입니다. 같은 날짜 + 같은 아동의 관찰일지는 1건만 허용됩니다.`;
  }

  if (!taskState.tasks.length) {
    list.innerHTML = `<div class="task-item"><span>표시할 작성 대상이 없습니다.</span></div>`;
    return;
  }

  taskState.tasks.forEach(task => {
    const done = task.status === "작성완료";
    const badgeClass = done ? "done" : "missing";
    const action = done
      ? `<button class="secondary" type="button" onclick="showMentorTabById('historySection')">작성내역 보기</button>`
      : `<button type="button" onclick='openForm(${JSON.stringify(task)})'>작성하기</button>`;

    list.insertAdjacentHTML("beforeend", `
      <article class="task-item">
        <div>
          <strong>${escapeHtml(task.childName)}</strong>
          <span>${escapeHtml(task.originalMentor)} 담당 / 마감 ${escapeHtml(task.deadlineTime || "-")} / <span class="badge ${badgeClass}">${escapeHtml(task.status)}</span></span>
        </div>
        ${action}
      </article>
    `);
  });
}

function openAddChild() {
  const select = document.getElementById("extraChild");
  select.innerHTML = `<option value="">아동 선택</option>`;
  taskState.children.forEach(child => {
    select.insertAdjacentHTML("beforeend", `<option value="${child.childId}">${escapeHtml(child.childName)} / ${escapeHtml(child.group || "-")} / 담당 ${escapeHtml(child.originalMentor)}</option>`);
  });
  document.getElementById("extraReason").value = "";
  showOnly("addChildPage");
}

function addExtraChild() {
  const childId = document.getElementById("extraChild").value;
  const extraReason = document.getElementById("extraReason").value;
  if (!childId || !extraReason) {
    alert("아동과 추가사유를 선택해 주세요.");
    return;
  }
  const child = taskState.children.find(item => item.childId === childId);
  const already = taskState.tasks.find(item => item.childId === childId && item.status === "작성완료");
  if (already) {
    alert("이미 해당 날짜에 해당 아동의 관찰일지가 작성되었습니다.");
    return;
  }
  openForm({
    writingId: `${today}_${child.childId}`,
    date: today,
    childId: child.childId,
    childName: child.childName,
    originalMentor: child.originalMentor,
    writingType: child.originalMentor === currentMentor ? "담당" : "추가",
    extraReason,
    status: "미작성"
  });
}

function openForm(task) {
  currentTask = task;
  editTarget = null;
  document.getElementById("formTitle").textContent = "관찰일지 작성";
  fillFormMeta(task, "신규작성");
  renderBookInputs([""]);
  document.getElementById("learningNote").value = "";
  document.getElementById("socialWorkerNote").value = "";
  showOnly("formPage");
}

function fillFormMeta(task, editStatus) {
  document.getElementById("formMentor").value = currentMentor;
  document.getElementById("formDate").value = task.date || today;
  document.getElementById("formChild").value = task.childName;
  document.getElementById("formType").value = displayWritingType(task.writingType || (task.originalMentor === currentMentor ? "담당" : "추가"));
  document.getElementById("formEditStatus").value = editStatus;
  document.getElementById("formReason").value = task.extraReason || "해당 없음";
}

function renderBookInputs(values) {
  const list = document.getElementById("bookPageList");
  list.innerHTML = "";
  values.forEach(value => addBookPageInput(value));
}

function addBookPageInput(value = "") {
  const list = document.getElementById("bookPageList");
  const index = list.children.length + 1;
  const canDelete = index > 1;
  list.insertAdjacentHTML("beforeend", `
    <div class="book-row">
      <input class="book-page-input" value="${escapeAttribute(value)}" placeholder="예: 수학 기본서 p.30~33" aria-label="문제집명/페이지 ${index}" />
      <button class="ghost small-btn" type="button" ${canDelete ? "" : "disabled"} onclick="removeBookPageInput(this)">삭제</button>
    </div>
  `);
}

function removeBookPageInput(button) {
  const rows = document.querySelectorAll(".book-row");
  if (rows.length <= 1) return;
  button.closest(".book-row").remove();
}

function collectFormValues() {
  const books = [...document.querySelectorAll(".book-page-input")]
    .map(input => input.value.replace(/\s*\n+\s*/g, " ").trim())
    .filter(Boolean);
  const totalRows = document.querySelectorAll(".book-page-input").length;
  if (!books.length || books.length !== totalRows) throw new Error("문제집명/페이지는 1개 이상 필수이며, 추가한 입력칸도 비워둘 수 없습니다.");

  const learningNote = document.getElementById("learningNote").value.trim();
  const socialWorkerNote = document.getElementById("socialWorkerNote").value.trim();
  if (!learningNote || !socialWorkerNote) throw new Error("모든 본문 항목을 작성해 주세요. 해당 사항이 없으면 '해당 없음'으로 입력해 주세요.");
  return { books, learningNote, socialWorkerNote };
}

async function submitObservation() {
  try {
    const form = collectFormValues();
    if (!confirm("제출하시겠습니까?")) return;
    if (editTarget) {
      await callApi("updateObservation", {
        token: currentToken,
        writingId: editTarget.writingId,
        editReason: editTarget.editReason,
        ...form
      });
      alert("관찰일지가 수정되었습니다. 기존 최신 버전은 이력으로 보관됩니다.");
    } else {
      await callApi("submitObservation", {
        token: currentToken,
        date: currentTask.date || today,
        writingId: currentTask.writingId,
        childId: currentTask.childId,
        extraReason: currentTask.extraReason || "",
        ...form
      });
      alert("관찰일지가 제출되었습니다.");
    }
    await loadMentorTasks();
    showOnly("mentorPage");
    resetMentorHomeUI();
  } catch (error) {
    alert(error.message);
  }
}

async function loadMentorHistory() {
  clampDateInputToToday("historyDateFilter");
  const date = document.getElementById("historyDateFilter").value;
  const childId = document.getElementById("historyChildFilter").value;
  const data = await callApi("getMentorHistory", {
    token: currentToken,
    date: historyState.allPeriod ? "" : date,
    childId,
    allPeriod: historyState.allPeriod
  });
  historyState.records = data.records || [];
  historyState.childOptions = data.children || [];
  populateHistoryChildFilter();
  renderHistory();
}

function populateHistoryChildFilter() {
  const select = document.getElementById("historyChildFilter");
  const previous = select.value;
  select.innerHTML = `<option value="">전체 아동</option>`;
  historyState.childOptions.forEach(child => {
    select.insertAdjacentHTML("beforeend", `<option value="${child.childId}">${escapeHtml(child.childName)}</option>`);
  });
  if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function renderHistory() {
  const tbody = document.getElementById("mentorHistoryBody");
  tbody.innerHTML = "";
  document.getElementById("mentorDetailCard").classList.add("hidden");

  if (!historyState.records.length) {
    tbody.innerHTML = `<tr><td colspan="6">조회된 작성내역이 없습니다.</td></tr>`;
    return;
  }

  historyState.records.forEach(record => {
    const canEdit = record.date === today;
    tbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td>${escapeHtml(record.date)}</td>
        <td>${escapeHtml(record.childName)}</td>
        <td>${typeBadge(record.writingType)}</td>
        <td>${escapeHtml(record.submittedTime || "-")}</td>
        <td>${record.editStatus === "수정" ? `<span class="badge replace">수정 v${record.version}</span>` : `<span class="badge done">최초작성</span>`}</td>
        <td>
          <button class="secondary" type="button" onclick="viewHistoryRecord('${record.writingId}')">보기</button>
          ${canEdit ? `<button type="button" onclick="openEditReason('${record.writingId}')">수정</button>` : `<button class="ghost" type="button" onclick="alert('제출일이 지난 관찰일지는 관리자에게 수정 요청해 주세요.')">수정불가</button>`}
        </td>
      </tr>
    `);
  });
}

function viewHistoryRecord(writingId) {
  const record = historyState.records.find(item => item.writingId === writingId);
  if (!record) return;
  const card = document.getElementById("mentorDetailCard");
  card.innerHTML = observationDetailHtml(record, true);
  card.classList.remove("hidden");
}

function openEditReason(writingId) {
  const record = historyState.records.find(item => item.writingId === writingId);
  if (!record) return;
  if (record.actualWriter !== currentMentor) {
    alert("본인이 작성한 관찰일지만 수정할 수 있습니다.");
    return;
  }
  if (record.date !== today) {
    alert("제출일이 지난 관찰일지는 관리자에게 수정 요청해 주세요.");
    return;
  }
  editTarget = { writingId };
  document.getElementById("editReason").value = "";
  showOnly("editReasonPage");
}

function startEditWithReason() {
  const editReason = document.getElementById("editReason").value;
  if (!editReason) {
    alert("수정사유를 선택해 주세요.");
    return;
  }
  const record = historyState.records.find(item => item.writingId === editTarget.writingId);
  editTarget = { writingId: record.writingId, editReason };
  currentTask = {
    date: record.date,
    childId: record.childId,
    childName: record.childName,
    originalMentor: record.originalMentor,
    writingType: record.writingType,
    extraReason: record.extraReason
  };
  document.getElementById("formTitle").textContent = "관찰일지 수정";
  fillFormMeta(currentTask, "수정 중");
  renderBookInputs(record.books || splitBooks(record.bookPages));
  document.getElementById("learningNote").value = record.learningNote || "";
  document.getElementById("socialWorkerNote").value = record.socialWorkerNote || "";
  showOnly("formPage");
}

function applyHistoryDateFilter() {
  clampDateInputToToday("historyDateFilter");
  historyState.allPeriod = false;
}

function setHistoryToday() {
  historyState.allPeriod = false;
  document.getElementById("historyDateFilter").value = today;
  loadMentorHistory();
}

function setHistoryAllPeriod() {
  historyState.allPeriod = true;
  document.getElementById("historyDateFilter").value = "";
  loadMentorHistory();
}

function showMentorTab(id, button) {
  document.getElementById("todaySection").classList.toggle("hidden", id !== "todaySection");
  document.getElementById("historySection").classList.toggle("hidden", id !== "historySection");
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  button.classList.add("active");
  if (id === "historySection") loadMentorHistory();
}

function showMentorTabById(id) {
  const button = id === "historySection" ? document.querySelectorAll(".tab")[1] : document.querySelectorAll(".tab")[0];
  showMentorTab(id, button);
}

function backToMentor() {
  showOnly("mentorPage");
}

function goMentorHome() {
  if (currentMentor || sessionStorage.getItem("mentorToken")) {
    restoreSession();
    showOnly("mentorPage");
    resetMentorHomeUI();
    if (currentToken) loadMentorTasks();
    return;
  }
  showOnly(sessionStorage.getItem("mentorSystemAccess") === "Y" ? "loginPage" : "gatePage");
}

function resetMentorHomeUI() {
  document.getElementById("todaySection").classList.remove("hidden");
  document.getElementById("historySection").classList.add("hidden");
  document.querySelectorAll(".tab").forEach(tab => tab.classList.remove("active"));
  const firstTab = document.getElementById("todayTabBtn") || document.querySelector(".tab");
  if (firstTab) firstTab.classList.add("active");
}

function logout() {
  if (!confirm("로그아웃할까요?")) return;
  sessionStorage.removeItem("mentorName");
  sessionStorage.removeItem("mentorToken");
  sessionStorage.removeItem("mentorSystemAccess");
  currentMentor = null;
  currentToken = "";
  showOnly("gatePage");
}

function showOnly(id) {
  ["gatePage", "loginPage", "mentorPage", "addChildPage", "formPage", "editReasonPage"].forEach(page => {
    document.getElementById(page)?.classList.add("hidden");
  });
  document.getElementById(id)?.classList.remove("hidden");
}

function restoreSession() {
  currentMentor = currentMentor || sessionStorage.getItem("mentorName");
  currentToken = currentToken || sessionStorage.getItem("mentorToken");
  if (currentMentor) {
    document.getElementById("formMentor").value = currentMentor;
    document.getElementById("formDate").value = today;
  }
}

function observationDetailHtml(record, showEditNotice) {
  const books = record.books || splitBooks(record.bookPages);
  return `
    <h2>${escapeHtml(record.childName)} 관찰일지</h2>
    <div class="detail-body">
      <div class="detail-item"><strong>1. 제출자</strong><br>${escapeHtml(record.actualWriter)}</div>
      <div class="detail-item"><strong>2. 제출날짜</strong><br>${escapeHtml(record.date)}</div>
      <div class="detail-item"><strong>3. 아동 이름</strong><br>${escapeHtml(record.childName)}</div>
      <div class="detail-item"><strong>4. 문제집명/페이지</strong><br>${books.map((book, index) => `${index + 1}) ${escapeHtml(book)}`).join("<br>")}</div>
      <div class="detail-item"><strong>5. 학습태도 및 특이사항</strong><br>${nl2br(record.learningNote)}</div>
      <div class="detail-item"><strong>6. 담당 사회복지사 전달사항</strong><br>${nl2br(record.socialWorkerNote)}</div>
      ${record.editStatus === "수정" ? `<hr><div class="detail-item"><strong>버전</strong> ${record.version}</div><div class="detail-item"><strong>수정상태</strong> ${escapeHtml(record.editStatus)}</div><div class="detail-item"><strong>수정시간</strong> ${escapeHtml(record.lastModifiedTime || "-")}</div><div class="detail-item"><strong>수정사유</strong> ${escapeHtml(record.editReason || "-")}</div>` : ""}
      ${showEditNotice && record.date !== today ? `<p class="notice">제출일이 지난 관찰일지는 관리자에게 수정 요청해 주세요.</p>` : ""}
    </div>
  `;
}

function typeBadge(type) {
  const displayType = displayWritingType(type);
  const className = displayType === "대체" ? "replace" : displayType === "추가" ? "extra" : "done";
  return `<span class="badge ${className}">${escapeHtml(displayType)}</span>`;
}

function displayWritingType(type) {
  return !type || type === "지정" ? "담당" : type;
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
  setDateInputMaxToday("historyDateFilter");
  document.getElementById("historyDateFilter").value = today;
  restoreSession();
  if (sessionStorage.getItem("mentorSystemAccess") === "Y" && !currentToken) showOnly("loginPage");
  if (currentToken) {
    try {
      showOnly("mentorPage");
      await loadMentorTasks();
    } catch {
      logout();
    }
  }
});
