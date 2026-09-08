"use strict";
// Recruit Copilot — front-end SPA (vanilla, hash-routed).

// ---------- api ----------
const api = async (method, path, body) => {
  const r = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  return r.json();
};

// ---------- state ----------
const S = { state: null, meta: null };
async function refresh() {
  const [state, meta] = await Promise.all([api("GET", "/api/state"), api("GET", "/api/meta")]);
  S.state = state;
  S.meta = meta;
  renderChrome();
}
const stageLabel = (k) => (S.meta.stages.find((s) => s.key === k) || {}).label || k;
const jobById = (id) => S.state.jobs.find((j) => j.id === id);
const candById = (id) => S.state.candidates.find((c) => c.id === id);

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (t) =>
  String(t == null ? "" : t).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const chips = (arr, cls = "") => (arr || []).map((x) => `<span class="tag ${cls}">${esc(x)}</span>`).join("");
function toast(text, feishu) {
  const w = $("#toastWrap");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = (feishu ? '<span class="fs">飞</span>' : "") + `<span>${esc(text)}</span>`;
  w.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast("已复制到剪贴板 ✓"), () => toast("复制失败"));
}
const fmtWhen = (iso) => {
  const d = new Date(iso), now = new Date();
  const diff = (d - now) / 3600e3;
  const t = d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
  if (diff < 0) return `已过期 · ${t}`;
  if (diff < 24) return `${Math.round(diff)}小时后 · ${t}`;
  return t;
};
const isDue = (r) => !r.done && new Date(r.due) - new Date() < 12 * 3600e3;

// ---------- chrome (nav + provider) ----------
function renderChrome() {
  $("#navCandCount").textContent = S.state.candidates.length;
  const dueCount = S.state.reminders.filter((r) => !r.done).length;
  $("#navRemCount").textContent = dueCount;
  $("#providerName").textContent = S.meta.provider === "mock" ? "离线模拟" : S.meta.provider;
  $("#providerBox").classList.toggle("live", S.meta.provider !== "mock");
  const fs = S.meta.feishu || { mode: "dry-run", live: false };
  $("#feishuMode").textContent = fs.live ? "已连接" : "dry-run";
  $("#feishuPill").classList.toggle("live", !!fs.live);
  $("#feishuPill").title = fs.hint || "";
  // follow-up badge (non-blocking)
  api("GET", "/api/activation/followups").then((fu) => { const el = $("#navFuCount"); if (el) el.textContent = fu.length; }).catch(() => {});
}
const TZ = "Asia/Shanghai";

// ---------- router ----------
const routes = {
  dashboard: { title: "概览", sub: "今日一览与近期动态", render: viewDashboard },
  chat: { title: "AI 对话", sub: "和 AI 助手直接聊，技能一键调用；按候选人隔离会话防污染", render: viewChat },
  jd: { title: "岗位分析", sub: "把 JD 拆成可执行的寻访策略", render: viewJD },
  sourcing: { title: "智能寻访", sub: "综合候选人池 + 反馈，优化关键词并排序打招呼优先级", render: viewSourcing },
  kanban: { title: "人才看板", sub: "拖拽卡片推进候选人阶段", render: viewKanban },
  screen: { title: "简历初筛", sub: "AI 抽取字段 + 初筛判断，不确定转人工", render: viewScreen },
  activation: { title: "主动跟进", sub: "分阶段跟进规则 + 人才池激活，别让候选人凉掉", render: viewActivation },
  reminders: { title: "跟进提醒", sub: "分阶段主动跟进与人才池激活", render: viewReminders },
  calls: { title: "通话纪要", sub: "电话转写 → 纪要 + 自动生成跟进任务", render: viewCalls },
};
function router() {
  closeDrawer(); // never let a drawer/scrim linger across navigation
  const key = (location.hash.replace("#/", "") || "dashboard").split("/")[0];
  const route = routes[key] || routes.dashboard;
  document.querySelectorAll(".nav a.item").forEach((a) =>
    a.classList.toggle("active", a.getAttribute("href") === `#/${key}`)
  );
  $("#pageTitle").textContent = route.title;
  $("#pageSub").textContent = route.sub;
  route.render($("#content"));
}

// ================= VIEWS =================

function viewDashboard(root) {
  const c = S.state.candidates;
  const byStage = {};
  S.meta.stages.forEach((s) => (byStage[s.key] = c.filter((x) => x.stage === s.key).length));
  const analyzed = S.state.jobs.filter((j) => j.analysis).length;
  const due = S.state.reminders.filter((r) => !r.done).sort((a, b) => new Date(a.due) - new Date(b.due));
  const matched = c.filter((x) => x.match).length;

  root.innerHTML = `
  <div class="grid c4" style="margin-bottom:16px">
    <div class="stat"><div class="n">${c.length}</div><div class="l">候选人 · <span class="em">${matched}</span> 已 AI 匹配</div></div>
    <div class="stat"><div class="n">${byStage.interview || 0}</div><div class="l">进入面试阶段</div></div>
    <div class="stat"><div class="n">${due.length}</div><div class="l">待跟进任务</div></div>
    <div class="stat"><div class="n">${analyzed}/${S.state.jobs.length}</div><div class="l">岗位已分析</div></div>
  </div>
  <div class="grid c2">
    <div class="card">
      <h3>⏰ 待跟进（按时间）</h3>
      <div id="dashRem">${due.length ? "" : '<div class="empty">暂无待办 🎉</div>'}</div>
    </div>
    <div class="card">
      <h3>🕐 最近动态</h3>
      <ul class="feed">${S.state.activities.slice(0, 12).map(feedRow).join("")}</ul>
    </div>
  </div>`;

  const dr = $("#dashRem");
  due.slice(0, 6).forEach((r) => dr.appendChild(reminderNode(r)));
}
const feedRow = (a) =>
  `<li><span class="ic">${a.type === "ai" ? "✨" : a.type === "stage" ? "↔" : "•"}</span><span>${esc(a.text)}</span><span class="at">${new Date(a.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span></li>`;

// ---- AI chat panel (HR <-> LLM, with skills) ----
const chatState = { sessionId: null, candidateId: "", skills: [], pendingSkill: null };
const mdLite = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
function chatBubble(m) {
  const who = m.role === "user" ? "我" : "AI 助手";
  const text = m.role === "user" ? m.display || m.content : m.content;
  return `<div class="cmsg ${m.role}"><div class="who">${who}</div><div class="b">${mdLite(text)}</div></div>`;
}

async function viewChat(root) {
  chatState.skills = await api("GET", "/api/skills");
  const cands = S.state.candidates;
  root.innerHTML = `
    <div class="chatwrap">
      <div class="chathead">
        <div class="row">
          <select id="chCand">
            <option value="">通用对话（不载入档案）</option>
            ${cands.map((c) => `<option value="${c.id}">${esc(c.name)} · ${esc(c.title || "")}</option>`).join("")}
          </select>
          <button class="btn sm" id="chNew">＋ 新会话</button>
          <div class="ctxbar-wrap">
            <div class="ctxbar-lab"><span id="chBadges"></span><span id="chPct">0%</span></div>
            <div class="ctxbar" id="chBar"><i style="width:0%"></i></div>
          </div>
        </div>
      </div>
      <div class="skillrow" id="chSkills"></div>
      <div class="thread" id="chThread"></div>
      <div id="chPend"></div>
      <div class="chatinput">
        <textarea id="chInput" rows="1" placeholder="问点什么，或点上方技能…"></textarea>
        <button class="send-btn" id="chSend">➤</button>
      </div>
    </div>`;
  renderSkillRow();
  $("#chCand").value = chatState.candidateId || "";
  $("#chCand").onchange = async () => { chatState.candidateId = $("#chCand").value; await newSessionChat(); };
  $("#chNew").onclick = newSessionChat;
  $("#chSend").onclick = () => sendChat();
  const input = $("#chInput");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });

  if (chatState.sessionId) await loadChat();
  else await newSessionChat();
}

function renderSkillRow() {
  const row = $("#chSkills");
  if (!row) return;
  row.innerHTML =
    chatState.skills.map((s) =>
      `<span class="skillchip" data-skill="${s.id}">${s.icon} ${esc(s.name)}${s.builtin ? "" : ` <span class="x" data-del="${s.id}">×</span>`}</span>`
    ).join("") + `<span class="skillchip add" id="chAddSkill">＋ 技能</span>`;
  row.querySelectorAll("[data-skill]").forEach((el) =>
    (el.onclick = (e) => { if (e.target.dataset.del) return; onSkillClick(el.dataset.skill); })
  );
  row.querySelectorAll("[data-del]").forEach((el) =>
    (el.onclick = async (e) => {
      e.stopPropagation();
      await api("DELETE", `/api/skills/${el.dataset.del}`);
      chatState.skills = await api("GET", "/api/skills");
      renderSkillRow();
      toast("已删除技能");
    })
  );
  $("#chAddSkill").onclick = addCustomSkill;
}

function onSkillClick(id) {
  const s = chatState.skills.find((x) => x.id === id);
  if (!s) return;
  if (s.needs_input) {
    chatState.pendingSkill = s.id;
    $("#chPend").innerHTML = `<div style="padding:6px 14px 0"><span class="pendtag">${s.icon} ${esc(s.name)} <span class="x" id="chClearPend">✕</span></span> <span class="small muted">在下方输入/粘贴内容后发送</span></div>`;
    $("#chClearPend").onclick = () => { chatState.pendingSkill = null; $("#chPend").innerHTML = ""; };
    const inp = $("#chInput"); inp.placeholder = `${s.name}：输入或粘贴内容…`; inp.focus();
    document.querySelectorAll(".skillchip").forEach((c) => c.classList.toggle("active", c.dataset.skill === id));
  } else {
    sendChat({ skill_id: id });
  }
}

async function addCustomSkill() {
  const name = prompt("技能名称？（如：竞品背调 / 谈薪话术）");
  if (!name) return;
  const icon = prompt("图标 emoji？", "⭐") || "⭐";
  const p = prompt("提示词模板？可用占位符：{{name}} {{candidate}} {{resume}} {{job}}", `总结候选人 {{name}} 的 ...`);
  if (!p) return;
  const needs_input = confirm("发送前需要我先在输入框补充内容吗？\n（确定=是，适合“通话纪要”这类需要粘贴内容的技能）");
  await api("POST", "/api/skills", { name, icon, prompt: p, needs_input });
  chatState.skills = await api("GET", "/api/skills");
  renderSkillRow();
  toast(`已添加技能「${name}」`);
}

async function newSessionChat() {
  const c = await api("POST", "/api/chats", { candidate_id: chatState.candidateId || null });
  chatState.sessionId = c.id;
  chatState.pendingSkill = null;
  if ($("#chPend")) $("#chPend").innerHTML = "";
  renderThread(c.messages);
  updateChatCtx({ pct: 0, rounds: 0 });
}

async function loadChat() {
  const c = await api("GET", `/api/chats/${chatState.sessionId}`);
  renderThread(c.messages);
  updateChatCtx(c.usage);
}

function renderThread(messages) {
  const t = $("#chThread");
  if (!t) return;
  if (!messages.length) {
    const c = chatState.candidateId ? candById(chatState.candidateId) : null;
    t.innerHTML = `<div class="cmsg assistant"><div class="who">AI 助手</div><div class="b">${
      c ? `已载入 <b>${esc(c.name)}</b> 的档案 👋 点上方技能，或直接问我关于 TA 的任何问题。` : "你好 👋 我是你的猎头 AI 助手。可在左上角载入某位候选人的档案，或直接问我。"
    }</div></div>`;
    return;
  }
  t.innerHTML = messages.map(chatBubble).join("");
  t.scrollTop = t.scrollHeight;
}

function updateChatCtx(usage) {
  const pct = usage.pct || 0;
  if ($("#chPct")) $("#chPct").textContent = pct + "%";
  const bar = $("#chBar");
  if (bar) { bar.querySelector("i").style.width = pct + "%"; bar.classList.toggle("warn", pct > 60); }
  if ($("#chBadges"))
    $("#chBadges").innerHTML = `📄 ${chatState.candidateId ? "档案已载入" : "通用"} · 🕐 第 ${(usage.rounds || 0) + 1} 轮${
      pct > 60 ? ' · <b style="color:var(--amber)">建议开新会话</b>' : ""
    }`;
}

async function sendChat(opts = {}) {
  const input = $("#chInput");
  const text = (opts.text !== undefined ? opts.text : input.value).trim();
  const skill_id = opts.skill_id || chatState.pendingSkill;
  if (!text && !skill_id) return;

  input.value = ""; input.style.height = "auto";
  chatState.pendingSkill = null;
  if ($("#chPend")) $("#chPend").innerHTML = "";
  input.placeholder = "问点什么，或点上方技能…";
  document.querySelectorAll(".skillchip.active").forEach((c) => c.classList.remove("active"));

  const t = $("#chThread");
  const skill = skill_id ? chatState.skills.find((s) => s.id === skill_id) : null;
  const userDisplay = skill ? `${skill.icon} ${skill.name}${text ? "：" + text : ""}` : text;
  if (t.querySelector(".cmsg.assistant .b") && t.children.length === 1 && !chatState.sessionMsgs) t.innerHTML = "";
  t.insertAdjacentHTML("beforeend", chatBubble({ role: "user", content: userDisplay }));
  t.insertAdjacentHTML("beforeend", `<div class="cmsg assistant" id="chTyping"><div class="who">AI 助手</div><div class="b"><span class="typing3"><i></i><i></i><i></i></span></div></div>`);
  t.scrollTop = t.scrollHeight;

  try {
    const r = await api("POST", `/api/chats/${chatState.sessionId}/message`, { text, skill_id });
    renderThread(r.messages);
    updateChatCtx(r.usage);
  } catch (e) {
    const ty = $("#chTyping"); if (ty) ty.remove();
    toast("出错：" + e.message);
  }
}

// ---- JD analysis ----
function viewJD(root) {
  const jobs = S.state.jobs;
  root.innerHTML = `
  <div class="grid c2" style="align-items:start">
    <div class="card">
      <h3>📋 输入职位描述</h3>
      <label class="fl">职位名称</label><input id="jdTitle" placeholder="资深后端开发工程师" />
      <div style="height:10px"></div>
      <label class="fl">公司</label><input id="jdCompany" placeholder="某电商科技（上海）" />
      <div style="height:10px"></div>
      <label class="fl">JD 原文</label><textarea id="jdText" rows="8" placeholder="粘贴 JD 全文…"></textarea>
      <div style="height:12px"></div>
      <button class="btn primary" id="jdCreate">＋ 新建并分析</button>
      <div class="divline"></div>
      <div class="small muted" style="margin-bottom:6px">已有岗位</div>
      <div id="jobList"></div>
    </div>
    <div class="card" id="jdResult"><div class="empty">选择左侧岗位或新建，点击「分析」生成寻访策略</div></div>
  </div>`;

  const jl = $("#jobList");
  jobs.forEach((j) => {
    const row = document.createElement("div");
    row.className = "reminder";
    row.style.cursor = "pointer";
    row.innerHTML = `<div style="flex:1"><b>${esc(j.title)}</b><div class="small muted">${esc(j.company || "")}</div></div>
      ${j.analysis ? '<span class="pill green">已分析</span>' : '<span class="pill warn">未分析</span>'}`;
    row.onclick = () => renderJDResult(j.id);
    jl.appendChild(row);
  });

  $("#jdCreate").onclick = async () => {
    const title = $("#jdTitle").value.trim();
    if (!title) return toast("请填写职位名称");
    const job = await api("POST", "/api/jobs", {
      title,
      company: $("#jdCompany").value.trim(),
      jd_text: $("#jdText").value.trim(),
    });
    await refresh();
    renderJDResult(job.id, true);
  };

  if (jobs[0]) renderJDResult(jobs[0].id);
}

async function renderJDResult(jobId, autorun) {
  const box = $("#jdResult");
  let job = jobById(jobId);
  const runBtn = `<button class="btn primary" id="runAnalyze">✨ ${job.analysis ? "重新分析" : "分析岗位"}</button>`;
  const draw = () => {
    job = jobById(jobId);
    const a = job.analysis;
    box.innerHTML = `<h3>📋 ${esc(job.title)} <span class="muted small" style="font-weight:400">${esc(job.company || "")}</span></h3>
      <div style="margin-bottom:12px">${runBtn}</div>
      ${a ? renderAnalysis(a) : '<div class="empty">尚未分析，点击上方按钮</div>'}`;
    $("#runAnalyze").onclick = runAnalyze;
  };
  async function runAnalyze() {
    box.querySelector("#runAnalyze").outerHTML = '<span class="spin"></span> <span class="muted small">AI 正在拆解 JD…</span>';
    try {
      const res = await api("POST", `/api/jobs/${jobId}/analyze`);
      await refresh();
      draw();
      toast(`岗位分析完成（${res.meta.provider}${res.meta.repaired ? "·已修复结构" : ""}）`);
    } catch (e) {
      toast("分析失败：" + e.message);
      draw();
    }
  }
  draw();
  if (autorun && !job.analysis) runAnalyze();
}

function renderAnalysis(a) {
  const reqs = a.hard_requirements.map((r) => `<div class="li"><span class="b">✅</span><div><b>${esc(r.item)}</b>${r.why ? ` <span class="muted small">— ${esc(r.why)}</span>` : ""}</div></div>`).join("");
  const redlines = a.red_lines.map((r) => `<div class="li"><span class="b">🚩</span><div>${esc(r)}</div></div>`).join("");
  const questions = a.screening_questions.map((q, i) => `<div class="li"><span class="b">${i + 1}.</span><div>${esc(q)}</div></div>`).join("");
  return `
    <div class="sect"><div class="scorebig"><div><div class="vd">岗位画像</div><div class="small" style="margin-top:4px;color:#3a3f45">${esc(a.role_summary)}</div><div class="small muted" style="margin-top:6px">职级：${esc(a.seniority)}</div></div></div></div>
    <div class="sect"><div class="st">🎯 硬性要求</div>${reqs}</div>
    <div class="sect"><div class="st">➕ 加分项</div>${chips(a.nice_to_have, "hot")}</div>
    <div class="sect"><div class="st">🚩 红线（一票否决）</div>${redlines}</div>
    <div class="sect"><div class="st">🔍 Boss 搜索关键词</div>${chips(a.search_keywords, "hot")}
      <div style="margin-top:10px"><label class="fl">布尔搜索串</label>
      <div style="display:flex;gap:8px"><input readonly value="${esc(a.boolean_string)}" /><button class="btn sm" data-copy="${esc(a.boolean_string)}">复制</button></div></div>
    </div>
    <div class="sect"><div class="st">🏢 对标挖人公司</div>${chips(a.target_companies)}</div>
    <div class="sect"><div class="st">❓ 初筛问题</div>${questions}</div>
    ${a.salary_read ? `<div class="sect"><div class="st">💰 薪资解读</div><div class="small">${esc(a.salary_read)}</div></div>` : ""}
    ${a.risk_notes && a.risk_notes.length ? `<div class="sect"><div class="st">⚠ 风险提示</div>${a.risk_notes.map((r) => `<div class="li"><span class="b">•</span><div>${esc(r)}</div></div>`).join("")}</div>` : ""}
  `;
}

// ---- Smart sourcing ----
function viewSourcing(root) {
  const jobs = S.state.jobs;
  root.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label class="fl" style="margin:0">岗位</label>
        <select id="srcJob" style="width:auto;min-width:220px">${jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}</select>
        <button class="btn primary" id="srcRun">🧭 运行智能寻访</button>
        <span class="small muted">综合该岗位下 ${S.state.candidates.length} 位候选人的进展与结果，反推更准的搜索词并排序打招呼优先级。</span>
      </div>
    </div>
    <div id="srcResult"></div>`;
  $("#srcRun").onclick = () => runSourcing($("#srcJob").value);
  const j = jobs.find((x) => x.sourcing);
  if (j) { $("#srcJob").value = j.id; renderSourcing(j.id); }
  else root.querySelector("#srcResult").innerHTML = '<div class="card"><div class="empty">选择岗位并运行，AI 会学习整个候选人池，产出优化关键词 + 排序短名单</div></div>';
}
async function runSourcing(jobId, feedback) {
  const box = $("#srcResult");
  box.innerHTML = '<div class="card"><span class="spin"></span> <span class="muted small">AI 正在学习候选人池、优化寻访策略…</span></div>';
  try {
    const res = await api("POST", `/api/jobs/${jobId}/sourcing`, feedback ? { feedback } : {});
    await refresh();
    renderSourcing(jobId);
    toast(feedback ? "已吸收反馈，重新排序 ✓" : `寻访策略已更新（${res.meta.provider}）`);
  } catch (e) { box.innerHTML = `<div class="card"><div class="empty">失败：${esc(e.message)}</div></div>`; }
}
function renderSourcing(jobId) {
  const job = jobById(jobId);
  const s = job.sourcing;
  if (!s) return;
  const orig = new Set((job.analysis?.search_keywords) || []);
  const kw = s.refined_keywords.map((k) => `<span class="tag ${orig.has(k) ? "" : "hot"}" title="${orig.has(k) ? "原有" : "新增/提权"}">${esc(k)}</span>`).join("");
  const ranked = s.ranked.map((r) => {
    const c = S.state.candidates.find((x) => x.name === r.name);
    return `<div class="reminder" style="${r.recommend ? "" : "opacity:.72"}">
      <div style="width:34px;text-align:center"><div style="font-weight:800;font-size:16px;color:${r.recommend ? "#4f46e5" : "#9ca3af"}">${r.score}</div></div>
      <div style="flex:1"><b>${esc(r.name)}</b> ${r.recommend ? '<span class="pill green">优先打招呼</span>' : '<span class="pill">暂缓</span>'}
        <div class="small muted">${esc(r.reason)}</div></div>
      ${c ? `<button class="btn sm" data-open="${c.id}">查看</button>` : ""}
      <button class="btn sm" data-badfit="${esc(r.name)}">这个不准</button>
    </div>`;
  }).join("");

  $("#srcResult").innerHTML = `
    <div class="grid c2" style="align-items:start">
      <div class="card">
        <h3>🎯 理想候选人画像</h3>
        <div class="small" style="margin-bottom:14px">${esc(s.ideal_profile)}</div>
        <div class="st" style="font-size:11px">🔍 优化后关键词 <span class="muted" style="font-weight:400">（紫色=新增/提权）</span></div>
        <div style="margin:6px 0 12px">${kw}</div>
        <label class="fl">优化后布尔搜索串</label>
        <div style="display:flex;gap:8px"><input readonly value="${esc(s.refined_boolean)}" /><button class="btn sm" data-copy="${esc(s.refined_boolean)}">复制</button></div>
        <div class="st" style="font-size:11px;margin-top:14px">🚫 排除信号（负向筛选）</div>
        ${s.exclude_signals.map((e) => `<div class="li"><span class="b">✗</span><div>${esc(e)}</div></div>`).join("")}
        <div class="st" style="font-size:11px;margin-top:14px">💡 从候选人池学到的规律</div>
        ${s.learned_from.map((l) => `<div class="li"><span class="b">•</span><div>${esc(l)}</div></div>`).join("")}
      </div>
      <div class="card">
        <h3>📊 打招呼优先级排序 <span class="muted small" style="font-weight:400;margin-left:auto">额度有限，从上往下打</span></h3>
        ${ranked}
        <div class="small muted" style="margin-top:8px">点「这个不准」纠偏 → AI 吸收后重新排序（反馈会累积）。</div>
      </div>
    </div>`;

  $("#srcResult").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openCandidate(b.getAttribute("data-open"))));
  $("#srcResult").querySelectorAll("[data-badfit]").forEach((b) => (b.onclick = async () => {
    const name = b.getAttribute("data-badfit");
    const why = prompt(`为什么「${name}」不准？（这条会作为纠偏反馈喂给 AI）`, "方向不符，请降低优先级");
    if (!why) return;
    runSourcing(jobId, `候选人「${name}」判断不准：${why}`);
  }));
}

// ---- Kanban ----
function viewKanban(root) {
  root.innerHTML = `<div class="board" id="board"></div>`;
  const board = $("#board");
  S.meta.stages.forEach((stage) => {
    const list = S.state.candidates.filter((c) => c.stage === stage.key);
    const col = document.createElement("div");
    col.className = "column";
    col.dataset.stage = stage.key;
    col.innerHTML = `<div class="col-head">${stage.label}<span class="c">${list.length}</span></div>`;
    list.forEach((c) => col.appendChild(kcard(c)));
    // drop targets
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("dragover"); });
    col.addEventListener("dragleave", () => col.classList.remove("dragover"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("dragover");
      const id = e.dataTransfer.getData("id");
      const c = candById(id);
      if (!c || c.stage === stage.key) return;
      await api("POST", `/api/candidates/${id}/stage`, { stage: stage.key });
      await refresh();
      router();
      toast(`「${c.name}」→ ${stage.label}`);
    });
    board.appendChild(col);
  });
}
function kcard(c) {
  const el = document.createElement("div");
  el.className = "kcard";
  el.draggable = true;
  el.innerHTML = `<div class="kn">${esc(c.name)} ${c.match ? `<span class="score">${c.match.score}</span>` : ""}</div>
    <div class="kr">${esc(c.title || "")}${c.company ? " · " + esc(c.company) : ""}</div>
    <div class="kmeta">${c.years ? `<span class="tag">${esc(c.years)}</span>` : ""}${c.city ? `<span class="tag">${esc(c.city)}</span>` : ""}${c.expected_salary ? `<span class="tag hot">${esc(c.expected_salary)}</span>` : ""}</div>`;
  el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("id", c.id); el.classList.add("dragging"); });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  el.addEventListener("click", () => openCandidate(c.id));
  return el;
}

// ---- Candidate drawer ----
async function openCandidate(id) {
  const c = candById(id);
  const drawer = $("#drawer");
  const scrim = $("#scrim");
  const initial = (c.name || "?")[0];
  drawer.innerHTML = `
    <div class="dh">
      <div class="av">${esc(initial)}</div>
      <div style="flex:1">
        <div style="font-size:17px;font-weight:700">${esc(c.name)}</div>
        <div class="small muted">${esc(c.title || "")}${c.company ? " · " + esc(c.company) : ""}</div>
        <div style="margin-top:6px"><span class="pill" style="background:#eef2ff;color:#4f46e5">${stageLabel(c.stage)}</span></div>
      </div>
      <button class="close" id="drawerClose">✕</button>
    </div>
    <div class="db" id="drawerBody"></div>`;
  scrim.classList.add("show");
  drawer.classList.add("show");
  $("#drawerClose").onclick = closeDrawer;
  scrim.onclick = closeDrawer;
  drawCandidateBody(id);
}
function closeDrawer() {
  $("#drawer").classList.remove("show");
  $("#scrim").classList.remove("show");
}
function drawCandidateBody(id) {
  const c = candById(id);
  const body = $("#drawerBody");
  const m = c.match;
  body.innerHTML = `
    <div class="sect">
      <div class="st">基本信息</div>
      <div class="kv small">
        <div><span class="k">经验</span> ${esc(c.years || "-")}</div>
        <div><span class="k">学历</span> ${esc(c.education || "-")}</div>
        <div><span class="k">城市</span> ${esc(c.city || "-")}</div>
        <div><span class="k">期望</span> ${esc(c.expected_salary || "-")}</div>
      </div>
      <div style="margin-top:10px">${chips(c.skills, "hot")}</div>
      ${c.highlights && c.highlights.length ? `<div style="margin-top:8px">${c.highlights.map((h) => `<div class="li"><span class="b">⭐</span><div>${esc(h)}</div></div>`).join("")}</div>` : ""}
    </div>

    <div class="sect">
      <div class="st">阶段 <select id="stageSel" style="width:auto;margin-left:auto;padding:4px 8px">${S.meta.stages.map((s) => `<option value="${s.key}" ${s.key === c.stage ? "selected" : ""}>${s.label}</option>`).join("")}</select></div>
    </div>

    <div class="sect">
      <div class="st">🎯 AI 匹配分析 <button class="btn sm" id="runMatch" style="margin-left:auto">${m ? "重新匹配" : "运行匹配"}</button></div>
      <div id="matchBox">${m ? renderMatch(m) : '<div class="empty small">尚未匹配</div>'}</div>
    </div>

    <div class="sect">
      <div class="st">💬 沟通话术
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn sm" id="draftOpener">开场白</button>
          <button class="btn sm" id="draftFollow">跟进</button>
        </span>
      </div>
      <div id="msgBox"><div class="empty small">点击生成 Boss 打招呼 / 跟进文案</div></div>
    </div>

    <div class="sect">
      <div class="st">📝 备注</div>
      <textarea id="noteArea" rows="2">${esc(c.notes || "")}</textarea>
      <div style="margin-top:6px;display:flex;gap:8px">
        <button class="btn sm" id="saveNote">保存备注</button>
        <button class="btn sm" id="addRem">＋ 加跟进提醒</button>
      </div>
    </div>

    <div class="sect">
      <div class="st"><span class="fs" style="width:15px;height:15px;border-radius:50%;background:#3370ff;color:#fff;font-size:9px;display:inline-flex;align-items:center;justify-content:center">飞</span> 飞书同步
        <span style="margin-left:auto;display:flex;gap:6px">
          <button class="btn sm" id="simFeishu" title="演示：模拟有人在飞书里把 TA 推进一个阶段，再回流">🧪 模拟回流</button>
          <button class="btn sm" id="syncFeishu">↻ 同步到飞书</button>
        </span>
      </div>
      <div id="feishuBox">${renderFeishu(c)}</div>
    </div>`;

  $("#stageSel").onchange = async (e) => {
    await api("POST", `/api/candidates/${id}/stage`, { stage: e.target.value });
    await refresh();
    toast("阶段已更新");
  };
  $("#runMatch").onclick = async () => {
    $("#matchBox").innerHTML = '<span class="spin"></span> <span class="muted small">AI 正在比对岗位与候选人…</span>';
    try {
      const res = await api("POST", `/api/candidates/${id}/match`);
      await refresh();
      $("#matchBox").innerHTML = renderMatch(res.candidate.match);
      toast(`匹配完成：${res.candidate.match.score}分 · ${res.candidate.match.verdict}`);
    } catch (e) { $("#matchBox").innerHTML = `<div class="empty small">失败：${esc(e.message)}</div>`; }
  };
  const draft = async (kind) => {
    $("#msgBox").innerHTML = '<span class="spin"></span> <span class="muted small">AI 正在拟稿…</span>';
    try {
      const res = await api("POST", `/api/candidates/${id}/message`, { kind });
      $("#msgBox").innerHTML = res.variants.map((v) =>
        `<div class="msgvariant"><button class="copy" data-copy="${esc(v.text)}">复制</button><div class="lbl">${esc(v.label)}</div><div class="tx">${esc(v.text)}</div></div>`
      ).join("") + (res.notes && res.notes.length ? `<div class="small muted" style="margin-top:4px">${res.notes.map(esc).join(" · ")}</div>` : "");
    } catch (e) { $("#msgBox").innerHTML = `<div class="empty small">失败：${esc(e.message)}</div>`; }
  };
  $("#draftOpener").onclick = () => draft("opener");
  $("#draftFollow").onclick = () => draft("followup");
  $("#saveNote").onclick = async () => {
    await api("PATCH", `/api/candidates/${id}`, { notes: $("#noteArea").value });
    await refresh();
    toast("备注已保存 ✓", true);
  };
  $("#addRem").onclick = async () => {
    const text = prompt("跟进内容？", `跟进 ${c.name}`);
    if (!text) return;
    const hint = prompt("什么时候？（今晚 / 明天 / 本周末）", "明天") || "";
    await api("POST", "/api/reminders", { candidate_id: id, text, due_hint: hint, due: hintDue(hint) });
    await refresh();
    toast("已加入跟进提醒 ⏰");
  };
  $("#syncFeishu").onclick = async () => {
    $("#feishuBox").innerHTML = '<span class="spin"></span> <span class="muted small">正在写入飞书多维表格…</span>';
    try {
      await api("POST", `/api/candidates/${id}/sync`);
      await refresh();
      $("#feishuBox").innerHTML = renderFeishu(candById(id));
      toast("已同步到飞书多维表格 ✓", true);
    } catch (e) { $("#feishuBox").innerHTML = `<div class="empty small">失败：${esc(e.message)}</div>`; }
  };
  $("#simFeishu").onclick = async () => {
    const cur = candById(id);
    if (!cur.feishu?.candidate_record_id) { await api("POST", `/api/candidates/${id}/sync`); await refresh(); }
    const stages = S.meta.stages.map((s) => s.key);
    const idx = stages.indexOf(candById(id).stage);
    const next = stages[Math.min(idx + 1, stages.length - 2)]; // advance one (skip 淘汰)
    try {
      await api("POST", "/api/feishu/simulate-remote-edit", { candidate_id: id, stage: next });
      const r = await api("POST", "/api/feishu/pull");
      await refresh();
      drawCandidateBody(id);
      toast(r.count ? `飞书侧改为「${stageLabel(next)}」→ 已回流 ✓` : "无变化", true);
    } catch (e) { toast("模拟失败：" + e.message); }
  };
}
function renderFeishu(c) {
  const f = c.feishu;
  if (!f || f.error) return `<div class="synced"><span class="fs">飞</span><div>${f && f.error ? "上次同步失败：" + esc(f.error) : "尚未同步。点右上角「同步到飞书」写入候选人库(Table 1)与简历库(Table 2)。"}</div></div>`;
  return `<div class="synced"><span class="fs">飞</span><div>
    已写入飞书（<b>${esc(f.mode)}</b>）· 候选人记录 <code>${esc(f.candidate_record_id || "-")}</code>${f.resume_record_id ? ` · 简历记录 <code>${esc(f.resume_record_id)}</code>` : ""}
    <div class="small muted">最近同步 ${new Date(f.last_synced_at).toLocaleString("zh-CN")}${f.mode === "dry-run" ? " · dry-run 未配置凭证时仅记录待写内容" : ""}</div>
  </div></div>`;
}
function renderMatch(m) {
  const rl = m.red_line_hits.map((h) => `<div class="li"><span class="b"><span class="pill ${h.status}">${h.status === "pass" ? "通过" : h.status === "warn" ? "待确认" : "不符"}</span></span><div>${esc(h.rule)}${h.note ? ` <span class="muted small">— ${esc(h.note)}</span>` : ""}</div></div>`).join("");
  return `
    <div class="scorebig"><div class="num">${m.score}</div><div><div class="vd">${esc(m.verdict)}</div><div class="small muted">置信度 ${m.confidence}%</div></div></div>
    <div class="small" style="margin-bottom:4px"><b class="tag green">强项</b></div>${m.strengths.map((s) => `<div class="li"><span class="b">✓</span><div>${esc(s)}</div></div>`).join("")}
    <div class="small" style="margin:8px 0 4px"><b class="tag amber">差距 / 待确认</b></div>${m.gaps.map((s) => `<div class="li"><span class="b">△</span><div>${esc(s)}</div></div>`).join("")}
    <div class="small" style="margin:8px 0 4px"><b>红线检查</b></div>${rl}
    <div class="divline"></div><div class="li"><span class="b">➡</span><div><b>下一步：</b>${esc(m.next_action)}</div></div>`;
}

// ---- Resume screening ----
function viewScreen(root) {
  root.innerHTML = `
  <div class="grid c2" style="align-items:start">
    <div class="card">
      <h3>📄 粘贴简历 / 截图文本</h3>
      <label class="fl">目标岗位</label>
      <select id="scrJob">${S.state.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}</select>
      <div style="height:10px"></div>
      <textarea id="scrText" rows="10" placeholder="把 Boss 简历/截图里的文本粘进来…">张伟，32岁，7年经验，本科。主导订单系统重构 QPS 2k→12k。技能 Java/分布式/高并发/RocketMQ。期望 35-45K，上海。</textarea>
      <div style="height:12px"></div>
      <button class="btn primary" id="scrRun">✨ AI 提取 + 初筛</button>
    </div>
    <div class="card" id="scrResult"><div class="empty">左侧粘贴文本，AI 会先抽字段，再给初筛判断（不确定会转人工）</div></div>
  </div>`;
  $("#scrRun").onclick = async () => {
    const box = $("#scrResult");
    box.innerHTML = '<span class="spin"></span> <span class="muted small">AI 正在读简历…</span>';
    try {
      const res = await api("POST", "/api/screen-resume", { resume_text: $("#scrText").value, job_id: $("#scrJob").value });
      const e = res.extracted;
      const verdictPill = { pass: "green", maybe: "amber", reject: "red" }[res.preview_verdict];
      box.innerHTML = `
        <h3>初筛结果 <span class="pill ${verdictPill}" style="margin-left:auto">${res.preview_verdict.toUpperCase()}</span></h3>
        ${res.needs_human ? '<div class="reminder due" style="margin-bottom:12px"><span>🙋 信息不足/存疑，建议人工复核</span></div>' : ""}
        <div class="kv small" style="margin-bottom:10px">
          <div><span class="k">姓名</span> ${esc(e.name)}</div><div><span class="k">电话</span> ${esc(e.phone)}</div>
          <div><span class="k">公司</span> ${esc(e.current_company)}</div><div><span class="k">职位</span> ${esc(e.current_title)}</div>
          <div><span class="k">经验</span> ${esc(e.years)}</div><div><span class="k">学历</span> ${esc(e.education)}</div>
          <div><span class="k">期望</span> ${esc(e.expected_salary)}</div>
        </div>
        <div style="margin-bottom:8px">${chips(e.skills, "hot")}</div>
        ${(e.highlights || []).map((h) => `<div class="li"><span class="b">⭐</span><div>${esc(h)}</div></div>`).join("")}
        <div class="small" style="margin:10px 0 4px"><b>判断理由</b></div>${res.reasons.map((r) => `<div class="li"><span class="b">•</span><div>${esc(r)}</div></div>`).join("")}
        <div class="divline"></div>
        <button class="btn primary" id="scrConfirm">✓ 确认入库到人才库</button>`;
      $("#scrConfirm").onclick = async () => {
        await api("POST", "/api/candidates", {
          job_id: $("#scrJob").value, name: e.name, title: e.current_title, company: e.current_company,
          years: e.years, education: e.education, expected_salary: e.expected_salary,
          skills: e.skills, highlights: e.highlights, resume_text: $("#scrText").value,
          screen: { preview_verdict: res.preview_verdict, needs_human: res.needs_human },
        });
        await refresh();
        toast("已入库人才库并同步飞书（看板 · 待联系）✓", true);
      };
    } catch (err) { box.innerHTML = `<div class="empty">失败：${esc(err.message)}</div>`; }
  };
}

// ---- Proactive follow-up & pool activation ----
async function viewActivation(root) {
  root.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3>🔔 分阶段跟进建议 <button class="btn primary sm" id="fuApplyAll" style="margin-left:auto">＋ 全部加入提醒</button></h3>
      <div class="small muted" style="margin:-4px 0 12px">按「阶段 + 停留天数」规则扫描：谁该跟进、该做什么、什么时候。加入后到「跟进提醒」管理。</div>
      <div id="fuList"><span class="spin"></span> <span class="muted small">扫描中…</span></div>
    </div>
    <div class="card">
      <h3>🧲 人才池激活</h3>
      <div class="small muted" style="margin:-4px 0 12px">岗位仍在招时，把早期/沉睡但匹配的老候选人批量捞回来重新联系。</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <select id="poolJob" style="width:auto;min-width:220px">${S.state.jobs.map((j) => `<option value="${j.id}">${esc(j.title)}</option>`).join("")}</select>
        <button class="btn" id="poolScan">扫描沉睡候选人</button>
      </div>
      <div id="poolList"></div>
    </div>`;

  await loadFollowups();
  $("#fuApplyAll").onclick = async () => {
    const r = await api("POST", "/api/activation/followups/apply", {});
    await refresh();
    await loadFollowups();
    toast(r.count ? `已加入 ${r.count} 条跟进提醒 ⏰` : "没有新的可加入（都已存在）");
  };
  $("#poolScan").onclick = () => scanPool($("#poolJob").value);
  scanPool($("#poolJob").value);
}
async function loadFollowups() {
  const list = await api("GET", "/api/activation/followups");
  $("#navFuCount").textContent = list.length;
  const box = $("#fuList");
  if (!list.length) { box.innerHTML = '<div class="empty small">当前没有到期的跟进建议 🎉</div>'; return; }
  box.innerHTML = list.map((s) => `
    <div class="reminder">
      <div style="flex:1"><span class="pill amber">${esc(s.rule_label)}</span> <b style="margin-left:4px">${esc(s.name)}</b>
        <div class="small muted">${esc(s.message)}</div></div>
      <div class="when">停留 ${s.days_in_stage} 天 · ${esc(s.due_hint)}</div>
      <button class="btn sm" data-fu="${esc(s.rule)}:${esc(s.candidate_id)}">加入</button>
    </div>`).join("");
  box.querySelectorAll("[data-fu]").forEach((b) => (b.onclick = async () => {
    const r = await api("POST", "/api/activation/followups/apply", { items: [b.getAttribute("data-fu")] });
    await refresh();
    await loadFollowups();
    toast(r.count ? "已加入跟进提醒 ⏰" : "该提醒已存在");
  }));
}
async function scanPool(jobId) {
  const box = $("#poolList");
  box.innerHTML = '<span class="spin"></span> <span class="muted small">扫描中…</span>';
  const list = await api("GET", `/api/jobs/${jobId}/activation`);
  if (!list.length) { box.innerHTML = '<div class="empty small">该岗位下没有可激活的早期候选人</div>'; return; }
  box.innerHTML = list.map((c) => `
    <div class="reminder">
      <input type="checkbox" class="poolChk" data-id="${esc(c.candidate_id)}" checked style="width:16px;height:16px" />
      <div style="flex:1"><b>${esc(c.name)}</b> <span class="pill">${stageLabel(c.stage)}</span>
        <div class="small muted">${esc(c.reason)} · 停留 ${c.days_in_stage} 天</div></div>
      ${c.fit != null ? `<div class="when" style="font-weight:700;color:#4f46e5">${c.fit}</div>` : ""}
    </div>`).join("") +
    `<button class="btn primary" id="poolActivate" style="margin-top:8px">🧲 激活选中（生成跟进提醒）</button>`;
  $("#poolActivate").onclick = async () => {
    const ids = [...box.querySelectorAll(".poolChk:checked")].map((x) => x.getAttribute("data-id"));
    if (!ids.length) return toast("请先勾选候选人");
    const r = await api("POST", `/api/jobs/${jobId}/activate`, { candidate_ids: ids });
    await refresh();
    toast(r.count ? `已激活 ${r.count} 人，生成跟进提醒 ⏰` : "选中的都已在跟进中");
  };
}

// ---- Reminders ----
function reminderNode(r) {
  const c = r.candidate_id ? candById(r.candidate_id) : null;
  const el = document.createElement("div");
  el.className = "reminder" + (r.done ? " done" : isDue(r) ? " due" : "");
  el.innerHTML = `<div class="chk">${r.done ? "✓" : ""}</div>
    <div class="tx" style="flex:1"><div>${esc(r.text)}</div>${c ? `<div class="small muted">${esc(c.name)}</div>` : ""}</div>
    <div class="when">${r.due_hint ? esc(r.due_hint) + " · " : ""}${fmtWhen(r.due)}</div>`;
  el.querySelector(".chk").onclick = async () => {
    if (r.done) return;
    await api("POST", `/api/reminders/${r.id}/done`);
    await refresh();
    router();
    toast("已完成 ✓");
  };
  return el;
}
function viewReminders(root) {
  const rem = [...S.state.reminders].sort((a, b) => (a.done - b.done) || new Date(a.due) - new Date(b.due));
  root.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <h3>➕ 快速添加</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input id="remText" placeholder="跟进内容" style="flex:2;min-width:200px" />
        <input id="remHint" placeholder="今晚 / 明天 / 本周末" style="flex:1;min-width:120px" />
        <button class="btn primary" id="remAdd">添加</button>
      </div>
    </div>
    <div class="card"><h3>⏰ 全部提醒</h3><div id="remList">${rem.length ? "" : '<div class="empty">暂无提醒</div>'}</div></div>`;
  const list = $("#remList");
  rem.forEach((r) => list.appendChild(reminderNode(r)));
  $("#remAdd").onclick = async () => {
    const text = $("#remText").value.trim();
    if (!text) return toast("请填写内容");
    const hint = $("#remHint").value.trim();
    await api("POST", "/api/reminders", { text, due_hint: hint, due: hintDue(hint) });
    await refresh();
    router();
    toast("已添加 ⏰");
  };
}
function hintDue(hint = "") {
  const d = new Date();
  if (/今晚/.test(hint)) { d.setHours(20, 0, 0, 0); return d.toISOString(); }
  if (/本周末|周末/.test(hint)) { const add = ((6 - d.getDay() + 7) % 7) || 6; return new Date(d.getTime() + add * 864e5).toISOString(); }
  if (/明天|明早/.test(hint)) return new Date(d.getTime() + 864e5).toISOString();
  if (/下周/.test(hint)) return new Date(d.getTime() + 7 * 864e5).toISOString();
  return new Date(d.getTime() + 864e5).toISOString();
}

// ---- Calls ----
function viewCalls(root) {
  root.innerHTML = `
  <div class="grid c2" style="align-items:start">
    <div class="card">
      <h3>📞 电话转写 → 纪要</h3>
      <label class="fl">候选人</label>
      <select id="callCand"><option value="">（不关联）</option>${S.state.candidates.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <div style="height:10px"></div>
      <label class="fl">通话转写（可粘贴语音转文字结果）</label>
      <textarea id="callText" rows="9" placeholder="喂你好，我是猎头小李…岗位挺感兴趣的，就是现在在职，想年后看看…薪资倒是没问题…">喂你好，我是猎头。之前给你推荐的资深后端岗位，你有兴趣吗？——挺感兴趣的，交易系统这块我做了很多。就是我现在还在职，想年后再看看机会。薪资的话 40K 左右我觉得可以。团队氛围和晋升我比较看重。</textarea>
      <div style="height:12px"></div>
      <button class="btn primary" id="callRun">✨ 生成纪要 + 自动建任务</button>
      <div class="small muted" style="margin-top:8px">纪要里的后续动作会按「今晚/本周末/明天」自动转成跟进提醒。</div>
    </div>
    <div class="card" id="callResult"><div class="empty">左侧粘贴通话内容，AI 整理成结构化纪要并自动排跟进</div></div>
  </div>`;
  $("#callRun").onclick = async () => {
    const box = $("#callResult");
    box.innerHTML = '<span class="spin"></span> <span class="muted small">AI 正在整理纪要…</span>';
    try {
      const res = await api("POST", "/api/calls", { candidate_id: $("#callCand").value || null, transcript: $("#callText").value });
      const r = res.call.result;
      const interestPill = { high: "green", medium: "amber", low: "red", unknown: "" }[r.candidate_interest];
      box.innerHTML = `
        <h3>通话纪要 <span class="pill ${interestPill}" style="margin-left:auto">意向：${r.candidate_interest}</span></h3>
        <div class="small" style="margin-bottom:10px">${esc(r.summary)}</div>
        <div class="st" style="font-size:11px">要点</div>${r.key_points.map((k) => `<div class="li"><span class="b">•</span><div>${esc(k)}</div></div>`).join("")}
        <div class="st" style="font-size:11px;margin-top:8px">顾虑 / 风险</div>${r.concerns.map((k) => `<div class="li"><span class="b">⚠</span><div>${esc(k)}</div></div>`).join("")}
        <div class="st" style="font-size:11px;margin-top:8px">已自动创建 ${res.reminders_created.length} 条跟进</div>
        ${r.suggested_actions.map((a) => `<div class="li"><span class="b">⏰</span><div>${esc(a.action)} <span class="tag amber">${esc(a.due_hint || "")}</span></div></div>`).join("")}
        ${r.followup_message ? `<div class="divline"></div><div class="msgvariant"><button class="copy" data-copy="${esc(r.followup_message)}">复制</button><div class="lbl">建议发送的跟进消息</div><div class="tx">${esc(r.followup_message)}</div></div>` : ""}`;
      await refresh();
      toast(`纪要完成，自动生成 ${res.reminders_created.length} 条跟进 ⏰`, true);
    } catch (e) { box.innerHTML = `<div class="empty">失败：${esc(e.message)}</div>`; }
  };
}

// ---------- global copy delegation ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-copy]");
  if (t) copyText(t.getAttribute("data-copy"));
});
$("#resetBtn").onclick = async () => {
  await api("POST", "/api/reset");
  await refresh();
  router();
  toast("已重置示例数据");
};
$("#pullFeishuBtn").onclick = async () => {
  const r = await api("POST", "/api/feishu/pull");
  await refresh();
  router();
  toast(r.count ? `已从飞书回流 ${r.count} 条改动 ✓` : "飞书侧无新改动", true);
};

// ---------- boot ----------
window.addEventListener("hashchange", router);
(async () => {
  await refresh();
  if (!location.hash) location.hash = "#/dashboard";
  router();
})();
