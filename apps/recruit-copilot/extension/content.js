// Recruit Copilot — Boss 直聘 content script (skeleton).
//
// 设计原则（对应产品诉求②「尽量手动 / 半自动」）：
//   - 只做「把 AI 生成好的开场白【填入】聊天框」，绝不自动点发送。
//   - 每日打招呼计数守护（Boss 有约 20–30 条/天限额）：接近上限时提示，把额度留给高匹配的人。
//   - 与本地服务 http://localhost:5178 通信取匹配/话术；平台 DOM 选择器需按实际页面调整。
//
// 这是骨架：选择器（CANDIDATE_NAME_SEL / CHAT_INPUT_SEL）请按当时的 Boss 页面结构填。

const API = "http://localhost:5178";
const DAILY_GREET_LIMIT = 25;

// —— 选择器占位（Boss 页面改版频繁，需实测校准）——
const CANDIDATE_NAME_SEL = "[class*='name'], .geek-name";
const CHAT_INPUT_SEL = "textarea, [contenteditable='true']";

const todayKey = () => "greet_" + new Date().toISOString().slice(0, 10);

async function greetCount() {
  const o = await chrome.storage.local.get(todayKey());
  return o[todayKey()] || 0;
}
async function bumpGreet() {
  const n = (await greetCount()) + 1;
  await chrome.storage.local.set({ [todayKey()]: n });
  return n;
}

function readCandidateName() {
  const el = document.querySelector(CANDIDATE_NAME_SEL);
  return el ? el.textContent.trim() : "";
}

// 把文本【填入】聊天框（不发送），并聚焦，等 Jay 自己按发送
function fillChatBox(text) {
  const box = document.querySelector(CHAT_INPUT_SEL);
  if (!box) return alert("没找到聊天输入框，选择器需按当前页面调整");
  if (box.tagName === "TEXTAREA") {
    box.value = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    box.textContent = text; // contenteditable
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }
  box.focus();
}

async function draftOpenerForCurrent() {
  const count = await greetCount();
  if (count >= DAILY_GREET_LIMIT) {
    return alert(`今日打招呼已达 ${count}/${DAILY_GREET_LIMIT}，把额度留给更高匹配的候选人吧。`);
  }
  const name = readCandidateName();
  // 简化：按名字找库里候选人；真实实现应带更多身份信息
  const res = await fetch(`${API}/api/candidates`).then((r) => r.json());
  const c = res.find((x) => x.name === name);
  if (!c) return alert(`候选人「${name}」还没入库，先在工作台入库或初筛。`);

  const draft = await fetch(`${API}/api/candidates/${c.id}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "opener" }),
  }).then((r) => r.json());

  const text = draft.variants?.[0]?.text || "";
  fillChatBox(text);
  const n = await bumpGreet();
  panelStatus(`已填入开场白（不会自动发送）。今日 ${n}/${DAILY_GREET_LIMIT}。请确认后手动发送。`);
}

// —— 极简悬浮面板 ——
function mountPanel() {
  if (document.getElementById("rc-panel")) return;
  const el = document.createElement("div");
  el.id = "rc-panel";
  el.style.cssText =
    "position:fixed;right:16px;bottom:16px;z-index:99999;background:#4f46e5;color:#fff;" +
    "font:13px -apple-system,PingFang SC,sans-serif;border-radius:12px;padding:12px 14px;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:240px";
  el.innerHTML =
    "<b>Recruit Copilot</b><div id='rc-status' style='opacity:.85;margin:6px 0;font-size:11.5px'>就地半自动助手</div>" +
    "<button id='rc-draft' style='background:#fff;color:#4f46e5;border:none;border-radius:8px;padding:6px 10px;font-weight:600;cursor:pointer'>✍ 生成开场白并填入</button>";
  document.body.appendChild(el);
  document.getElementById("rc-draft").onclick = draftOpenerForCurrent;
}
function panelStatus(t) {
  const s = document.getElementById("rc-status");
  if (s) s.textContent = t;
}

mountPanel();
