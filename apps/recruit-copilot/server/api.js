// API handlers: wires HTTP routes to the store and the stateless AI agents.

import { json } from "./router.js";
import { col, raw, logActivity, reset } from "./store.js";
import { runAgent } from "./llm/agent.js";
import { activeProvider } from "./llm/provider.js";
import { STAGES, SEED } from "./seed.js";
import * as feishu from "../integrations/feishu.js";

const jobs = col("jobs");
const candidates = col("candidates");
const reminders = col("reminders");
const calls = col("calls");

const jobAnalysisFor = (candidate) => {
  const job = jobs.find(candidate.job_id);
  return job?.analysis || null;
};

// Push a candidate (and its resume) to Feishu Bitable, idempotently.
// Non-fatal: a sync failure never breaks the core flow.
async function syncToFeishu(candidateId, screen) {
  const c = candidates.find(candidateId);
  if (!c) return null;
  const prev = c.feishu || {};
  const stage_label = STAGES.find((s) => s.key === c.stage)?.label || c.stage;
  try {
    const cand = await feishu.upsertCandidate({ ...c, stage_label }, prev.candidate_record_id);
    let resumeId = prev.resume_record_id;
    if (c.resume_text) {
      const r = await feishu.upsertResume(c, screen || c.screen, prev.resume_record_id);
      resumeId = r.record_id;
    }
    const info = {
      candidate_record_id: cand.record_id,
      resume_record_id: resumeId,
      mode: feishu.isLive() ? "live" : "dry-run",
      last_synced_at: new Date().toISOString(),
    };
    candidates.update(c.id, { feishu: info });
    logActivity({ type: "feishu", text: `同步「${c.name}」到飞书多维表格（${info.mode}）` });
    return info;
  } catch (e) {
    logActivity({ type: "feishu", text: `飞书同步「${c.name}」失败：${String(e.message || e)}` });
    return { error: String(e.message || e) };
  }
}

export function registerRoutes(r) {
  r.get("/api/health", (req, res) => json(res, 200, { ok: true }));

  r.get("/api/meta", (req, res) =>
    json(res, 200, { stages: STAGES, provider: activeProvider(), feishu: feishu.getStatus() })
  );

  r.get("/api/state", (req, res) => json(res, 200, raw()));

  r.post("/api/reset", (req, res) => {
    reset(SEED);
    json(res, 200, { ok: true });
  });

  // ---------- Feishu Bitable integration ----------
  r.get("/api/feishu/status", (req, res) => json(res, 200, feishu.getStatus()));
  r.get("/api/feishu/log", (req, res) => json(res, 200, feishu.getSyncLog()));
  r.post("/api/candidates/:id/sync", async (req, res, { params }) => {
    const c = candidates.find(params.id);
    if (!c) return json(res, 404, { error: "not found" });
    const info = await syncToFeishu(c.id);
    json(res, 200, { feishu: info, status: feishu.getStatus() });
  });

  // Bidirectional: pull changes made in Feishu (阶段/备注) back into local store.
  r.post("/api/feishu/pull", async (req, res) => {
    const applied = [];
    for (const c of candidates.all()) {
      const rid = c.feishu?.candidate_record_id;
      if (!rid) continue;
      const remote = await feishu.getRemoteFields(rid);
      if (!remote) continue;
      const patch = {};
      if (remote["阶段"]) {
        const key = STAGES.find((s) => s.label === remote["阶段"])?.key;
        if (key && key !== c.stage) patch.stage = key;
      }
      if (remote["备注"] != null && remote["备注"] !== c.notes) patch.notes = remote["备注"];
      if (Object.keys(patch).length) {
        candidates.update(c.id, patch);
        const note = patch.stage ? `阶段→${STAGES.find((s) => s.key === patch.stage).label}` : "";
        applied.push({ id: c.id, name: c.name, ...patch });
        logActivity({ type: "feishu", text: `从飞书回流「${c.name}」${note}${patch.notes ? " 备注更新" : ""}` });
      }
    }
    json(res, 200, { applied, count: applied.length });
  });

  // Demo helper: emulate someone editing the candidate's 阶段 inside Feishu.
  r.post("/api/feishu/simulate-remote-edit", (req, res, { body }) => {
    const c = candidates.find(body.candidate_id);
    if (!c) return json(res, 404, { error: "not found" });
    const rid = c.feishu?.candidate_record_id;
    if (!rid) return json(res, 400, { error: "尚未同步到飞书，无法模拟回流" });
    const label = STAGES.find((s) => s.key === body.stage)?.label || body.stage;
    feishu.simulateRemoteEdit(rid, { 阶段: label });
    json(res, 200, { ok: true, remote_stage: label });
  });

  // ---------- Jobs / JD ----------
  r.get("/api/jobs", (req, res) => json(res, 200, jobs.all()));

  r.post("/api/jobs", async (req, res, { body }) => {
    const job = jobs.insert({
      title: body.title || "未命名岗位",
      company: body.company || "",
      jd_text: body.jd_text || "",
      analysis: null,
    });
    logActivity({ type: "job", text: `新增岗位「${job.title}」` });
    json(res, 201, job);
  });

  // JD -> structured sourcing strategy (AI task #1)
  r.post("/api/jobs/:id/analyze", async (req, res, { params }) => {
    const job = jobs.find(params.id);
    if (!job) return json(res, 404, { error: "job not found" });
    try {
      const out = await runAgent("jd_analyze", {
        title: job.title,
        company: job.company,
        jd_text: job.jd_text,
      });
      jobs.update(job.id, { analysis: out.data });
      logActivity({ type: "ai", text: `AI 分析岗位「${job.title}」（${out.provider}${out.repaired ? "·修复" : ""}）` });
      json(res, 200, { job: jobs.find(job.id), meta: { provider: out.provider, ms: out.ms, repaired: out.repaired } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e), errors: e.errors });
    }
  });

  // Smart sourcing (AI task #6): learn from the whole pool + feedback → refined
  // keywords, exclude signals, and a打招呼-priority ranked shortlist.
  r.post("/api/jobs/:id/sourcing", async (req, res, { params, body }) => {
    const job = jobs.find(params.id);
    if (!job) return json(res, 404, { error: "job not found" });
    try {
      let analysis = job.analysis;
      if (!analysis) {
        const a = await runAgent("jd_analyze", { title: job.title, company: job.company, jd_text: job.jd_text });
        jobs.update(job.id, { analysis: a.data });
        analysis = a.data;
      }
      // accumulate Jay's corrections across runs
      const feedback = [...(job.sourcing_feedback || [])];
      if (body.feedback) feedback.push(body.feedback);
      const pool = candidates.all().filter((c) => c.job_id === job.id);
      const out = await runAgent("smart_sourcing", { jd_analysis: analysis, candidates: pool, feedback });
      jobs.update(job.id, { sourcing: out.data, sourcing_feedback: feedback });
      logActivity({ type: "ai", text: `智能寻访「${job.title}」→ 优化关键词 ${out.data.refined_keywords.length} 个、排序 ${out.data.ranked.length} 人` });
      json(res, 200, { job: jobs.find(job.id), meta: { provider: out.provider, ms: out.ms } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e), errors: e.errors });
    }
  });

  // ---------- Candidates ----------
  r.get("/api/candidates", (req, res) => json(res, 200, candidates.all()));

  r.get("/api/candidates/:id", (req, res, { params }) => {
    const c = candidates.find(params.id);
    return c ? json(res, 200, c) : json(res, 404, { error: "not found" });
  });

  r.post("/api/candidates", async (req, res, { body }) => {
    const c = candidates.insert({
      job_id: body.job_id || jobs.all()[0]?.id || null,
      name: body.name || "(待确认)",
      title: body.title || "",
      company: body.company || "",
      years: body.years || "",
      education: body.education || "",
      expected_salary: body.expected_salary || "",
      city: body.city || "",
      skills: body.skills || [],
      highlights: body.highlights || [],
      resume_text: body.resume_text || "",
      stage: body.stage || "sourced",
      match: null,
      screen: body.screen || null,
      notes: body.notes || "",
    });
    logActivity({ type: "candidate", text: `新增候选人「${c.name}」入库` });
    await syncToFeishu(c.id, body.screen);
    json(res, 201, candidates.find(c.id));
  });

  r.patch("/api/candidates/:id", (req, res, { params, body }) => {
    const c = candidates.update(params.id, body);
    return c ? json(res, 200, c) : json(res, 404, { error: "not found" });
  });

  // kanban stage move
  r.post("/api/candidates/:id/stage", async (req, res, { params, body }) => {
    const c = candidates.find(params.id);
    if (!c) return json(res, 404, { error: "not found" });
    candidates.update(c.id, { stage: body.stage });
    logActivity({ type: "stage", text: `「${c.name}」移动到「${STAGES.find((s) => s.key === body.stage)?.label || body.stage}」` });
    await syncToFeishu(c.id);
    json(res, 200, candidates.find(c.id));
  });

  // candidate vs job match (AI task #2)
  r.post("/api/candidates/:id/match", async (req, res, { params }) => {
    const c = candidates.find(params.id);
    if (!c) return json(res, 404, { error: "not found" });
    let analysis = jobAnalysisFor(c);
    try {
      // auto-analyze the job first if not done yet
      if (!analysis) {
        const job = jobs.find(c.job_id);
        if (job) {
          const a = await runAgent("jd_analyze", { title: job.title, company: job.company, jd_text: job.jd_text });
          jobs.update(job.id, { analysis: a.data });
          analysis = a.data;
        }
      }
      const out = await runAgent("match_candidate", { jd_analysis: analysis, candidate: c });
      candidates.update(c.id, { match: out.data });
      logActivity({ type: "ai", text: `AI 匹配「${c.name}」→ ${out.data.score}分 / ${out.data.verdict}` });
      await syncToFeishu(c.id); // push updated 匹配分 to Bitable
      json(res, 200, { candidate: candidates.find(c.id), meta: { provider: out.provider, ms: out.ms } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e), errors: e.errors });
    }
  });

  // outreach message draft (AI task #4)
  r.post("/api/candidates/:id/message", async (req, res, { params, body }) => {
    const c = candidates.find(params.id);
    if (!c) return json(res, 404, { error: "not found" });
    try {
      const out = await runAgent("draft_message", {
        candidate: c,
        jd_analysis: jobAnalysisFor(c),
        kind: body.kind || "opener",
        tone: body.tone,
      });
      logActivity({ type: "ai", text: `AI 为「${c.name}」生成${body.kind === "followup" ? "跟进" : "开场白"}话术` });
      json(res, 200, { ...out.data, meta: { provider: out.provider } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e) });
    }
  });

  // one-call outreach for the Boss extension: name -> ensured match + opener variants
  r.post("/api/outreach", async (req, res, { body }) => {
    const name = (body.name || "").trim();
    const c = candidates.all().find((x) => x.name === name);
    if (!c) return json(res, 404, { error: `候选人「${name}」还没入库，请先在工作台入库/初筛` });
    try {
      // ensure a match exists so the panel can show a score
      if (!c.match) {
        let analysis = jobAnalysisFor(c);
        const job = jobs.find(c.job_id);
        if (!analysis && job) {
          const a = await runAgent("jd_analyze", { title: job.title, company: job.company, jd_text: job.jd_text });
          jobs.update(job.id, { analysis: a.data });
          analysis = a.data;
        }
        const m = await runAgent("match_candidate", { jd_analysis: analysis, candidate: c });
        candidates.update(c.id, { match: m.data });
      }
      const msg = await runAgent("draft_message", {
        candidate: candidates.find(c.id),
        jd_analysis: jobAnalysisFor(c),
        kind: body.kind || "opener",
      });
      logActivity({ type: "ai", text: `扩展为「${c.name}」生成${body.kind === "followup" ? "跟进" : "开场白"}（Boss 侧边栏）` });
      json(res, 200, { candidate: candidates.find(c.id), variants: msg.data.variants, notes: msg.data.notes });
    } catch (e) {
      json(res, 502, { error: String(e.message || e) });
    }
  });

  // resume screening (AI task #3) — feed unsure ones to a human
  r.post("/api/screen-resume", async (req, res, { body }) => {
    const job = body.job_id ? jobs.find(body.job_id) : jobs.all()[0];
    try {
      const out = await runAgent("screen_resume", {
        resume_text: body.resume_text || "",
        jd_analysis: job?.analysis || null,
      });
      logActivity({ type: "ai", text: `AI 初筛简历 → ${out.data.preview_verdict}${out.data.needs_human ? "（需人工）" : ""}` });
      json(res, 200, { ...out.data, meta: { provider: out.provider } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e) });
    }
  });

  // ---------- Reminders (activation / follow-up) ----------
  r.get("/api/reminders", (req, res) => json(res, 200, reminders.all()));

  r.post("/api/reminders", (req, res, { body }) => {
    const rem = reminders.insert({
      candidate_id: body.candidate_id || null,
      text: body.text || "",
      due: body.due || new Date().toISOString(),
      due_hint: body.due_hint || "",
      done: false,
    });
    json(res, 201, rem);
  });

  r.post("/api/reminders/:id/done", (req, res, { params }) => {
    const rem = reminders.update(params.id, { done: true });
    return rem ? json(res, 200, rem) : json(res, 404, { error: "not found" });
  });

  // ---------- Calls (phone -> text -> summary + auto tasks) (AI task #5) ----------
  r.get("/api/calls", (req, res) => json(res, 200, calls.all()));

  r.post("/api/calls", async (req, res, { body }) => {
    const c = body.candidate_id ? candidates.find(body.candidate_id) : null;
    try {
      const out = await runAgent("summarize_call", {
        transcript: body.transcript || "",
        candidate: c,
        resume: c?.resume_text,
      });
      const call = calls.insert({
        candidate_id: body.candidate_id || null,
        transcript: body.transcript || "",
        result: out.data,
      });
      // auto-create reminders from suggested actions (proactive follow-up)
      const created = [];
      for (const a of out.data.suggested_actions || []) {
        const due = hintToDue(a.due_hint);
        const rem = reminders.insert({
          candidate_id: body.candidate_id || null,
          text: a.action,
          due,
          due_hint: a.due_hint || "",
          done: false,
          source: "call",
        });
        created.push(rem);
      }
      logActivity({ type: "ai", text: `AI 整理通话纪要${c ? `（${c.name}）` : ""}，生成 ${created.length} 条跟进任务` });
      json(res, 201, { call, reminders_created: created, meta: { provider: out.provider } });
    } catch (e) {
      json(res, 502, { error: String(e.message || e) });
    }
  });
}

// naive natural-language -> timestamp mapping (timezone: server local)
function hintToDue(hint = "") {
  const d = new Date();
  const set = (h) => {
    d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  if (/今晚|tonight/.test(hint)) return set(20);
  if (/明天上午|明早/.test(hint)) return new Date(d.getTime() + 24 * 3600e3).toISOString();
  if (/明天|tomorrow/.test(hint)) return new Date(d.getTime() + 24 * 3600e3).toISOString();
  if (/本周末|周末|weekend/.test(hint)) {
    const day = d.getDay();
    const add = ((6 - day + 7) % 7) || 6; // next Saturday
    return new Date(d.getTime() + add * 24 * 3600e3).toISOString();
  }
  if (/下周|next week/.test(hint)) return new Date(d.getTime() + 7 * 24 * 3600e3).toISOString();
  return new Date(d.getTime() + 24 * 3600e3).toISOString();
}
