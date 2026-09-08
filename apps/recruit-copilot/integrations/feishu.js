// Feishu (Lark) Bitable adapter — interface + real-call outline + observable sync log.
//
// Default is DRY_RUN: it records what WOULD be written (and fabricates record
// ids) so the whole sync path is exercisable and visible in the UI before you
// have credentials. Fill the env vars to write to your 多维表格 (Bitable) for
// real; the rest of the app calls these functions and never touches Feishu
// directly. Every call is captured in an in-memory sync log the UI can read.
//
// Env:
//   FEISHU_APP_ID, FEISHU_APP_SECRET
//   FEISHU_BITABLE_APP_TOKEN
//   FEISHU_TABLE_CANDIDATES   (Table 1 · 候选人库)
//   FEISHU_TABLE_RESUMES      (Table 2 · 简历库)

import crypto from "node:crypto";

const env = process.env;
const LIVE = !!(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN);
const BASE = "https://open.feishu.cn/open-apis";
const TABLE_CAND = () => env.FEISHU_TABLE_CANDIDATES || "tblCandidates";
const TABLE_RES = () => env.FEISHU_TABLE_RESUMES || "tblResumes";

// ---- observable sync log ----
const _log = [];
function record(entry) {
  _log.unshift({ at: new Date().toISOString(), mode: LIVE ? "live" : "dry-run", ...entry });
  if (_log.length > 100) _log.pop();
}

// ---- simulated remote (dry-run only) ----
// In dry-run there is no real Bitable, so we keep the "remote" state here to
// make the bidirectional (Feishu -> local) pull path exercisable and testable.
// In live mode this map is unused; pull reads the real records instead.
const _remote = new Map(); // record_id -> fields
function rememberRemote(rid, fields) {
  _remote.set(rid, { ...(_remote.get(rid) || {}), ...fields });
}
export function simulateRemoteEdit(rid, patch) {
  if (!rid) return;
  rememberRemote(rid, patch);
  record({ table: "(remote)", op: "remote-edit", label: "模拟飞书侧编辑", fields: patch, record_id: rid, ok: true });
}
// read the current remote fields of one record (real GET in live, memory in dry-run)
export async function getRemoteFields(rid) {
  if (!rid) return null;
  if (LIVE) {
    try {
      const appToken = env.FEISHU_BITABLE_APP_TOKEN;
      const data = await apiCall("GET", `${BASE}/bitable/v1/apps/${appToken}/tables/${TABLE_CAND()}/records/${rid}`);
      return data.record?.fields || null;
    } catch {
      return null;
    }
  }
  return _remote.get(rid) || null;
}
export function getSyncLog() {
  return _log;
}
export function getStatus() {
  return {
    mode: LIVE ? "live" : "dry-run",
    live: LIVE,
    tables: { candidates: TABLE_CAND(), resumes: TABLE_RES() },
    synced: _log.filter((e) => e.ok).length,
    hint: LIVE
      ? "已连接飞书开放平台"
      : "未配置凭证 → dry-run（记录将写入的内容，不真正写飞书）。设置 FEISHU_APP_ID/SECRET/BITABLE_APP_TOKEN 后自动切换为真实写入。",
  };
}

// ---- auth (live only) ----
let _token = null;
let _exp = 0;
async function tenantToken() {
  if (_token && Date.now() < _exp) return _token;
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`feishu auth failed: ${data.msg}`);
  _token = data.tenant_access_token;
  _exp = Date.now() + (data.expire - 60) * 1000;
  return _token;
}

async function apiCall(method, url, body) {
  const token = await tenantToken();
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`feishu ${data.code}: ${data.msg}`);
  return data.data;
}

// create or update one record; returns { record_id }
async function writeRecord(tableId, fields, recordId, label) {
  const op = recordId ? "update" : "create";
  if (!LIVE) {
    const rid = recordId || "dry_" + crypto.randomBytes(4).toString("hex");
    if (tableId === TABLE_CAND()) rememberRemote(rid, fields); // keep simulated remote in sync
    record({ table: tableId, op, label, fields, record_id: rid, ok: true });
    return { record_id: rid };
  }
  try {
    const appToken = env.FEISHU_BITABLE_APP_TOKEN;
    let data;
    if (recordId) {
      data = await apiCall("PUT", `${BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, { fields });
    } else {
      data = await apiCall("POST", `${BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`, { fields });
    }
    const rid = data.record?.record_id || recordId;
    record({ table: tableId, op, label, fields, record_id: rid, ok: true });
    return { record_id: rid };
  } catch (e) {
    record({ table: tableId, op, label, fields, ok: false, error: String(e.message || e) });
    throw e;
  }
}

// ---- public adapter interface ----
function candidateFields(c) {
  return {
    姓名: c.name,
    现公司: c.company || "",
    现职位: c.title || "",
    期望薪资: c.expected_salary || "",
    城市: c.city || "",
    经验: c.years || "",
    学历: c.education || "",
    阶段: c.stage_label || c.stage || "",
    匹配分: c.match?.score ?? null,
    匹配结论: c.match?.verdict || "",
    技能: (c.skills || []).join("、"),
    亮点: (c.highlights || []).join("；"),
    备注: c.notes || "",
  };
}

// upsert a candidate; pass existing record_id to update in place (idempotent)
export async function upsertCandidate(c, recordId) {
  return writeRecord(TABLE_CAND(), candidateFields(c), recordId, `候选人「${c.name}」`);
}

// upsert a resume row (Table 2)
export async function upsertResume(c, screen, recordId) {
  return writeRecord(
    TABLE_RES(),
    {
      姓名: c.name,
      简历原文: (c.resume_text || "").slice(0, 5000),
      初筛结论: screen?.preview_verdict || "",
      需人工: screen?.needs_human ? "是" : "否",
      亮点: (c.highlights || []).join("；"),
    },
    recordId,
    `简历「${c.name}」`
  );
}

export function isLive() {
  return LIVE;
}
