// End-to-end smoke test against a running server. Usage: node scripts/smoke.js
const BASE = process.env.BASE || "http://localhost:5178";
const j = async (m, p, b) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { "content-type": "application/json" },
    body: b ? JSON.stringify(b) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
};

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`);
};

const run = async () => {
  ok("health", (await j("GET", "/api/health")).data.ok === true);

  const meta = await j("GET", "/api/meta");
  ok("meta.stages", Array.isArray(meta.data.stages) && meta.data.stages.length > 0, `provider=${meta.data.provider}`);

  const state = await j("GET", "/api/state");
  const jobId = state.data.jobs[0]?.id;
  const zw = state.data.candidates.find((c) => c.name === "张伟");
  ok("seed loaded", !!jobId && !!zw);

  const analyze = await j("POST", `/api/jobs/${jobId}/analyze`);
  ok("jd_analyze", analyze.status === 200 && Array.isArray(analyze.data.job.analysis.hard_requirements),
     `keywords=${analyze.data.job.analysis.search_keywords?.length}`);

  const match = await j("POST", `/api/candidates/${zw.id}/match`);
  ok("match_candidate", match.status === 200 && typeof match.data.candidate.match.score === "number",
     `score=${match.data.candidate.match?.score}`);

  const msg = await j("POST", `/api/candidates/${zw.id}/message`, { kind: "opener" });
  ok("draft_message", msg.status === 200 && msg.data.variants.length >= 1);

  const screen = await j("POST", "/api/screen-resume", { resume_text: "张伟 7年 Java 分布式 QPS 2k→12k", job_id: jobId });
  ok("screen_resume", screen.status === 200 && ["pass", "maybe", "reject"].includes(screen.data.preview_verdict),
     `verdict=${screen.data.preview_verdict}`);

  const stage = await j("POST", `/api/candidates/${zw.id}/stage`, { stage: "interview" });
  ok("stage move", stage.status === 200 && stage.data.stage === "interview");

  const call = await j("POST", "/api/calls", {
    candidate_id: zw.id,
    transcript: "喂你好，我是猎头...岗位挺感兴趣的，就是现在在职，想年后看看...薪资没问题...",
  });
  ok("summarize_call + auto reminders", call.status === 201 && call.data.reminders_created.length >= 1,
     `reminders=${call.data.reminders_created.length}`);

  // ---- Feishu integration ----
  const fst = await j("GET", "/api/feishu/status");
  ok("feishu status", ["live", "dry-run"].includes(fst.data.mode), `mode=${fst.data.mode}`);

  const newCand = await j("POST", "/api/candidates", {
    job_id: jobId, name: "测试候选人", title: "后端", resume_text: "测试简历文本 Java",
    screen: { preview_verdict: "maybe", needs_human: true },
  });
  ok("insert auto-syncs feishu", newCand.status === 201 && !!newCand.data.feishu?.candidate_record_id,
     `rec=${newCand.data.feishu?.candidate_record_id}`);

  const resync = await j("POST", `/api/candidates/${zw.id}/sync`);
  ok("manual feishu sync", resync.status === 200 && !!resync.data.feishu?.candidate_record_id);

  const flog = await j("GET", "/api/feishu/log");
  ok("feishu sync log recorded", Array.isArray(flog.data) && flog.data.length >= 2, `entries=${flog.data.length}`);

  // ---- Smart sourcing ----
  const src = await j("POST", `/api/jobs/${jobId}/sourcing`);
  ok("smart_sourcing", src.status === 200 && src.data.job.sourcing.ranked.length >= 1,
     `ranked=${src.data.job.sourcing.ranked.length}, kw=${src.data.job.sourcing.refined_keywords.length}`);
  const src2 = await j("POST", `/api/jobs/${jobId}/sourcing`, { feedback: "候选人「王芳」判断不准：请降低优先级" });
  ok("sourcing feedback loop", src2.status === 200 && src2.data.job.sourcing_feedback.length >= 1,
     `feedback=${src2.data.job.sourcing_feedback.length}`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
};
run().catch((e) => {
  console.error("smoke crashed:", e);
  process.exit(1);
});
