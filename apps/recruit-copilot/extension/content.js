// Recruit Copilot — Boss 直聘 content script.
//
// 一体化：扩展不是一个独立的小挂件，而是把【完整的 Web 工作台】以侧边栏形式
// 停靠在 Boss 页面右侧（iframe 加载 /?embed=1）。同一套 UI、同一后端、同一
// 候选人库——扩展形态和 Web 形态是同一个产品的两种入口，不是两个东西。
//
// 内容脚本额外负责一件跨边界的事：把 AI 开场白【填入】Boss 自己的聊天框
// （iframe 因跨源无法直接操作 Boss DOM），并守护每日打招呼额度。

(function () {
  "use strict";
  const APP = location.origin.includes("localhost:5178") ? location.origin : "http://localhost:5178";
  const DOCK_W = 400;
  const DAILY_GREET_LIMIT = 25;
  const CANDIDATE_NAME_SEL = "[data-rc-name], .geek-name, [class*='name']";
  const CHAT_INPUT_SEL = "[data-rc-chat], textarea, [contenteditable='true']";

  const store = {
    async get(k) {
      if (globalThis.chrome?.storage?.local) { const o = await chrome.storage.local.get(k); return o[k]; }
      try { return JSON.parse(localStorage.getItem(k)); } catch { return null; }
    },
    async set(k, v) {
      if (globalThis.chrome?.storage?.local) return chrome.storage.local.set({ [k]: v });
      try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
    },
  };
  const todayKey = () => "rc_greet_" + new Date().toISOString().slice(0, 10);
  const greetCount = async () => (await store.get(todayKey())) || 0;
  const bumpGreet = async () => { const n = (await greetCount()) + 1; await store.set(todayKey(), n); return n; };

  const readName = () => { const el = document.querySelector(CANDIDATE_NAME_SEL); return el ? el.textContent.trim() : ""; };
  function fillChatBox(text) {
    const box = document.querySelector(CHAT_INPUT_SEL);
    if (!box) { status("没找到聊天输入框，选择器需按当前页面调整", true); return false; }
    if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") box.value = text; else box.textContent = text;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    return true;
  }

  async function fillOpener() {
    const name = readName();
    if (!name) return status("没读到候选人姓名", true);
    const count = await greetCount();
    if (count >= DAILY_GREET_LIMIT) return status(`今日打招呼已达 ${count}/${DAILY_GREET_LIMIT}，把额度留给更高匹配的人`, true);
    status("AI 正在拟开场白…");
    try {
      const r = await fetch(`${APP}/api/outreach`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, kind: "opener" }),
      });
      const data = await r.json();
      if (!r.ok) return status(data.error || "请求失败", true);
      if (fillChatBox(data.variants?.[0]?.text || "")) {
        const n = await bumpGreet();
        status(`已填入开场白（未发送）· 今日 ${n}/${DAILY_GREET_LIMIT} · 请确认后手动发送`);
      }
    } catch { status("连接工作台失败，请先启动本地服务", true); }
  }

  // ---- docked sidebar (the full workbench) ----
  let $status, $name, iframe, dock, tab, collapsed = false;
  function status(t, warn) { if ($status) { $status.textContent = t; $status.style.color = warn ? "#dc2626" : "#6b7280"; } }
  const appUrl = (name) => `${APP}/?embed=1${name ? "&candidate=" + encodeURIComponent(name) : ""}`;

  function mount() {
    if (document.getElementById("rc-dock")) return;
    document.documentElement.classList.add("rc-docked");

    dock = document.createElement("div");
    dock.id = "rc-dock";
    dock.style.cssText =
      `position:fixed;top:0;right:0;width:${DOCK_W}px;height:100vh;z-index:2147483000;` +
      "background:#fff;border-left:1px solid #e3e4e8;box-shadow:-10px 0 30px rgba(0,0,0,.10);" +
      "display:flex;flex-direction:column;font-family:-apple-system,'PingFang SC',sans-serif;transition:transform .22s;";
    dock.innerHTML =
      "<div style='flex:none;display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid #eef0f2;background:linear-gradient(135deg,#4f46e5,#6d5cf0);color:#fff'>" +
      "<div style='width:22px;height:22px;border-radius:6px;background:#fff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-weight:700'>R</div>" +
      "<div style='flex:1;min-width:0'><b style='font-size:13px'>Recruit Copilot</b><div id='rc-name' style='font-size:10.5px;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'></div></div>" +
      "<button id='rc-fill' title='把 AI 开场白填入 Boss 聊天框' style='background:#fff;color:#4f46e5;border:none;border-radius:7px;padding:5px 9px;font-weight:700;font-size:11.5px;cursor:pointer'>✍ 填开场白</button>" +
      "<button id='rc-collapse' title='收起' style='background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:7px;width:26px;height:26px;cursor:pointer;font-size:14px'>»</button>" +
      "</div>" +
      "<div id='rc-status' style='flex:none;font-size:11px;color:#6b7280;padding:5px 11px;border-bottom:1px solid #f2f3f5;min-height:22px'>就地触达 · 完整工作台就在右侧</div>" +
      "<div style='flex:1;min-height:0'><iframe id='rc-frame' style='width:100%;height:100%;border:0' title='Recruit Copilot 工作台'></iframe></div>";
    document.body.appendChild(dock);

    tab = document.createElement("div");
    tab.id = "rc-tab";
    tab.title = "打开 Recruit Copilot";
    tab.style.cssText =
      "position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2147483000;display:none;" +
      "background:#4f46e5;color:#fff;padding:10px 8px;border-radius:10px 0 0 10px;cursor:pointer;" +
      "writing-mode:vertical-rl;font:600 12px -apple-system,'PingFang SC',sans-serif;box-shadow:-4px 0 14px rgba(79,70,229,.3)";
    tab.textContent = "R · 工作台";
    document.body.appendChild(tab);

    $status = dock.querySelector("#rc-status");
    $name = dock.querySelector("#rc-name");
    iframe = dock.querySelector("#rc-frame");
    dock.querySelector("#rc-fill").onclick = fillOpener;
    dock.querySelector("#rc-collapse").onclick = () => setCollapsed(true);
    tab.onclick = () => setCollapsed(false);

    // when the workbench finishes loading, tell it who's open
    iframe.addEventListener("load", () => postCandidate());
    // receive fill requests from the workbench (cross-origin bridge)
    window.addEventListener("message", async (e) => {
      if (e.source !== iframe.contentWindow) return; // only trust our own iframe
      const d = e.data;
      if (!d || d.source !== "rc-app") return;
      if (d.type === "fill") {
        const ok = fillChatBox(d.text);
        let count;
        if (ok) count = await bumpGreet();
        iframe.contentWindow.postMessage({ source: "rc-ext", type: "fill-result", ok, count, msg: ok ? "" : "没找到聊天输入框" }, APP);
      }
    });

    refreshCandidate(true);
    // Boss is an SPA; re-detect the candidate when the name element changes
    let last = readName();
    setInterval(() => { const n = readName(); if (n && n !== last) { last = n; refreshCandidate(); } }, 1500);
  }

  function postCandidate() {
    try { iframe.contentWindow.postMessage({ source: "rc-ext", type: "candidate", name: readName() }, APP); } catch {}
  }
  function refreshCandidate(first) {
    const name = readName();
    $name.textContent = name ? "候选人：" + name : "未识别到候选人";
    if (first) iframe.src = appUrl(name); // initial load carries the candidate in the URL
    else postCandidate(); // afterwards just message it — no reload, keeps state
  }

  function setCollapsed(v) {
    collapsed = v;
    dock.style.transform = v ? `translateX(${DOCK_W}px)` : "translateX(0)";
    tab.style.display = v ? "block" : "none";
    document.documentElement.classList.toggle("rc-docked", !v);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
