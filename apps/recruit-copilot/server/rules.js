// Proactive follow-up rules engine + talent-pool activation.
//
// Two mechanisms answering "主动跟进 / 人才池激活":
//   1) Stage-based follow-up rules: a candidate stuck in a stage past a
//      threshold surfaces a concrete next action (with a timing hint).
//   2) Pool activation: for a still-open job, surface dormant candidates
//      (early stage, untouched a while) ranked by fit, to re-engage in batch.

const HOUR = 3600e3;
const daysSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / (24 * HOUR) : 0);
const stageAge = (c) => daysSince(c.stage_since || c.created_at);

// each rule: when a candidate matches, it yields one follow-up suggestion.
export const FOLLOWUP_RULES = [
  {
    id: "greeted_stale", stage: "greeted", days: 3, due_hint: "今天",
    label: "已读未回", msg: (c, d) => `「${c.name}」已打招呼 ${d} 天未回复，换个角度再跟进一次（可用 AI 生成新开场白）`,
  },
  {
    id: "replied_idle", stage: "replied", days: 2, due_hint: "今天",
    label: "待推进", msg: (c, d) => `「${c.name}」已回复 ${d} 天，尽快安排 15 分钟电话初面`,
  },
  {
    id: "screening_idle", stage: "screening", days: 3, due_hint: "明天",
    label: "沟通停滞", msg: (c, d) => `「${c.name}」沟通/初筛已 ${d} 天无进展，推动约面或给结论`,
  },
  {
    id: "interview_idle", stage: "interview", days: 3, due_hint: "明天",
    label: "面试跟进", msg: (c, d) => `「${c.name}」进入面试 ${d} 天，跟进面试结果 / 约下一轮`,
  },
  {
    id: "offer_idle", stage: "offer", days: 2, due_hint: "今晚",
    label: "Offer 闭环", msg: (c, d) => `「${c.name}」Offer 阶段已 ${d} 天，催候选人决策，避免流失`,
  },
  {
    id: "sourced_dormant", stage: "sourced", days: 7, due_hint: "本周末",
    label: "人才池沉睡", msg: (c, d) => `「${c.name}」待联系已 ${d} 天，重新评估或激活`,
  },
];

// Rule-based follow-up suggestions (preview; does not write anything).
export function followupSuggestions(candidates) {
  const out = [];
  for (const c of candidates) {
    const age = Math.floor(stageAge(c));
    for (const r of FOLLOWUP_RULES) {
      if (c.stage === r.stage && age >= r.days) {
        out.push({
          candidate_id: c.id, name: c.name, stage: c.stage, days_in_stage: age,
          rule: r.id, rule_label: r.label, message: r.msg(c, age), due_hint: r.due_hint,
        });
      }
    }
  }
  // most-overdue first
  return out.sort((a, b) => b.days_in_stage - a.days_in_stage);
}

// Dormant, re-engageable candidates for an open job, ranked by fit.
export function activationCandidates(job, candidates) {
  const early = new Set(["sourced", "greeted", "replied"]);
  return candidates
    .filter((c) => c.job_id === job.id && early.has(c.stage))
    .map((c) => ({
      candidate_id: c.id, name: c.name, stage: c.stage,
      days_in_stage: Math.floor(stageAge(c)),
      fit: c.match?.score ?? null,
      reason: c.match
        ? `匹配 ${c.match.score} · ${c.match.verdict}`
        : "尚未 AI 匹配（可先跑匹配再决定优先级）",
    }))
    .sort((a, b) => (b.fit ?? 50) - (a.fit ?? 50) || b.days_in_stage - a.days_in_stage);
}
