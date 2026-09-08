// Feishu (Lark) Bitable adapter — interface + real-call outline.
//
// Default is DRY_RUN: it logs what WOULD be written, so wiring it into the app
// is safe before you have real credentials. Fill the env vars and flip DRY_RUN
// to false to write to your 多维表格 (Bitable). The rest of the app calls these
// functions and never touches Feishu directly.
//
// Env:
//   FEISHU_APP_ID, FEISHU_APP_SECRET
//   FEISHU_BITABLE_APP_TOKEN
//   FEISHU_TABLE_CANDIDATES   (Table 1 · 候选人库)
//   FEISHU_TABLE_RESUMES      (Table 2 · 简历库)

const env = process.env;
const DRY_RUN = !(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BITABLE_APP_TOKEN);
const BASE = "https://open.feishu.cn/open-apis";

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

async function createRecord(tableId, fields) {
  if (DRY_RUN) {
    console.log(`[feishu:dry-run] → table ${tableId}:`, JSON.stringify(fields));
    return { dry_run: true, fields };
  }
  const token = await tenantToken();
  const res = await fetch(
    `${BASE}/bitable/v1/apps/${env.FEISHU_BITABLE_APP_TOKEN}/tables/${tableId}/records`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(`feishu write failed: ${data.msg}`);
  return data.data.record;
}

// ---- public adapter interface (stable regardless of backend) ----

export async function upsertCandidate(c) {
  return createRecord(env.FEISHU_TABLE_CANDIDATES || "tblCandidates", {
    姓名: c.name,
    现公司: c.company || "",
    现职位: c.title || "",
    期望薪资: c.expected_salary || "",
    城市: c.city || "",
    阶段: c.stage || "",
    匹配分: c.match?.score ?? null,
    技能: (c.skills || []).join("、"),
    备注: c.notes || "",
  });
}

export async function upsertResume(c, screen) {
  return createRecord(env.FEISHU_TABLE_RESUMES || "tblResumes", {
    姓名: c.name,
    简历原文: c.resume_text || "",
    初筛结论: screen?.preview_verdict || "",
    需人工: screen?.needs_human ? "是" : "否",
    亮点: (c.highlights || []).join("；"),
  });
}

export function isLive() {
  return !DRY_RUN;
}
