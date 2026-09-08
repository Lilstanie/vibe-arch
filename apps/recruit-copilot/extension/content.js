// Recruit Copilot — Boss 直聘 content script.
//
// 半自动触达（对应产品诉求②「尽量手动」）：
//   - 只把 AI 生成好的开场白【填入】聊天框，绝不自动点发送。
//   - 每日打招呼计数守护（Boss 约 20–30/天）：接近上限提示，把额度留给高匹配的人。
//   - 一次 /api/outreach 调用：名字 → 匹配分 + 开场白，减少往返。
//
// 选择器占位（Boss 页面改版频繁，需实测校准 CANDIDATE_NAME_SEL / CHAT_INPUT_SEL）。

(function () {
  "use strict";

  const API = location.origin.includes("localhost:5178") ? location.origin : "http://localhost:5178";
  const DAILY_GREET_LIMIT = 25;
  const CANDIDATE_NAME_SEL = "[data-rc-name], .geek-name, [class*='name']";
  const CHAT_INPUT_SEL = "[data-rc-chat], textarea, [contenteditable='true']";

  // storage shim: chrome.storage.local if present, else localStorage (so this
  // also runs in a plain page for testing without the chrome API).
  const store = {
    async get(k) {
      if (globalThis.chrome?.storage?.local) {
        const o = await chrome.storage.local.get(k);
        return o[k];
      }
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

  const readName = () => {
    const el = document.querySelector(CANDIDATE_NAME_SEL);
    return el ? el.textContent.trim() : "";
  };
  function fillChatBox(text) {
    const box = document.querySelector(CHAT_INPUT_SEL);
    if (!box) { status("没找到聊天输入框，选择器需按当前页面调整", true); return false; }
    if (box.tagName === "TEXTAREA" || box.tagName === "INPUT") {
      box.value = text;
    } else {
      box.textContent = text;
    }
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.focus();
    return true;
  }

  async function outreach(kind) {
    const name = readName();
    if (!name) return status("没读到候选人姓名", true);
    const count = await greetCount();
    if (kind === "opener" && count >= DAILY_GREET_LIMIT) {
      return status(`今日打招呼已达 ${count}/${DAILY_GREET_LIMIT}，把额度留给更高匹配的候选人。`, true);
    }
    status("AI 正在分析并拟稿…");
    try {
      const r = await fetch(`${API}/api/outreach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, kind }),
      });
      const data = await r.json();
      if (!r.ok) return status(data.error || "请求失败", true);
      const m = data.candidate?.match;
      if (m) setMatch(`匹配 ${m.score} · ${m.verdict}`);
      const text = data.variants?.[0]?.text || "";
      if (fillChatBox(text) && kind === "opener") {
        const n = await bumpGreet();
        status(`已填入开场白（未发送）· 今日 ${n}/${DAILY_GREET_LIMIT} · 请确认后手动发送`);
      } else if (kind === "followup") {
        status("已填入跟进文案（未发送）");
      }
    } catch (e) {
      status("连接工作台失败，请先启动本地服务", true);
    }
  }

  // ---- panel UI ----
  let $status, $match;
  function status(t, warn) { if ($status) { $status.textContent = t; $status.style.color = warn ? "#fecaca" : "rgba(255,255,255,.9)"; } }
  function setMatch(t) { if ($match) $match.textContent = t; }

  function mountPanel() {
    if (document.getElementById("rc-panel")) return;
    const el = document.createElement("div");
    el.id = "rc-panel";
    el.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:99999;width:230px;background:linear-gradient(135deg,#4f46e5,#6d5cf0);" +
      "color:#fff;font:13px -apple-system,'PingFang SC',sans-serif;border-radius:14px;padding:13px 14px;box-shadow:0 10px 30px rgba(79,70,229,.35)";
    el.innerHTML =
      "<div style='display:flex;align-items:center;gap:7px'><div style='width:22px;height:22px;border-radius:6px;background:#fff;color:#4f46e5;display:flex;align-items:center;justify-content:center;font-weight:700'>R</div><b>Recruit Copilot</b></div>" +
      "<div id='rc-cand' style='margin:8px 0 2px;font-size:12px;opacity:.95'></div>" +
      "<div id='rc-match' style='font-size:11px;opacity:.8;min-height:14px'></div>" +
      "<div id='rc-status' style='font-size:11px;margin:6px 0;min-height:28px;line-height:1.4'>就地半自动助手</div>" +
      "<div style='display:flex;gap:6px'>" +
      "<button id='rc-open' style='flex:1;background:#fff;color:#4f46e5;border:none;border-radius:8px;padding:6px 4px;font-weight:700;cursor:pointer;font-size:12px'>✍ 开场白</button>" +
      "<button id='rc-follow' style='flex:1;background:rgba(255,255,255,.2);color:#fff;border:none;border-radius:8px;padding:6px 4px;font-weight:600;cursor:pointer;font-size:12px'>跟进</button>" +
      "</div>" +
      "<div style='display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;opacity:.75'>" +
      "<a id='rc-refresh' style='color:#fff;cursor:pointer;text-decoration:underline'>↻ 重新识别</a>" +
      `<a href='${API}' target='_blank' style='color:#fff;text-decoration:underline'>打开工作台 ↗</a>` +
      "</div>";
    document.body.appendChild(el);
    $status = el.querySelector("#rc-status");
    $match = el.querySelector("#rc-match");
    const refreshName = () => { el.querySelector("#rc-cand").textContent = readName() ? "候选人：" + readName() : "未识别到候选人"; };
    refreshName();
    el.querySelector("#rc-open").onclick = () => outreach("opener");
    el.querySelector("#rc-follow").onclick = () => outreach("followup");
    el.querySelector("#rc-refresh").onclick = () => { refreshName(); setMatch(""); status("已重新识别"); };
  }

  // expose for testing
  globalThis.__rc = { outreach, readName, fillChatBox, greetCount };
  mountPanel();
})();
