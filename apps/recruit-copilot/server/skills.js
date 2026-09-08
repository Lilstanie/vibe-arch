// Chat "skills" — reusable prompt templates the HR can invoke in the chat
// panel. Built-ins live here (always available); custom skills are stored in
// the `skills` collection. A skill's prompt may use placeholders:
//   {{name}} {{resume}} {{candidate}} {{job}}
// `needs_input: true` means clicking it prefills the input for the HR to add
// their own text (e.g. paste a transcript) instead of sending immediately.

export const BUILTIN_SKILLS = [
  { id: "sk_summary", builtin: true, icon: "✍", name: "总结简历",
    prompt: "请用要点总结候选人 {{name}} 的简历：核心能力、量化亮点、潜在风险各列 2-3 条。\n简历：{{resume}}" },
  { id: "sk_match", builtin: true, icon: "🎯", name: "匹配分析",
    prompt: "对照当前岗位 {{job}}，分析候选人 {{name}} 的匹配度（给个分数）、强项、差距和红线，最后给约不约面的建议。候选人资料：{{candidate}}" },
  { id: "sk_opener", builtin: true, icon: "💬", name: "写开场白",
    prompt: "为候选人 {{name}} 写两版 Boss 打招呼开场白，突出其量化亮点，避免群发感，每版两三句。候选人资料：{{candidate}}" },
  { id: "sk_redline", builtin: true, icon: "🚩", name: "红线检查",
    prompt: "逐条检查候选人 {{name}} 是否触碰用人红线（稳定性/学历/量化产出/竞业等），每条给 通过/待确认/不符。候选人资料：{{candidate}}" },
  { id: "sk_interview", builtin: true, icon: "❓", name: "面试提纲",
    prompt: "针对候选人 {{name}} 生成 5 个面试提问，重点考察其可能的短板与岗位关键要求。候选人资料：{{candidate}}" },
  { id: "sk_callnotes", builtin: true, icon: "📞", name: "通话纪要", needs_input: true,
    prompt: "帮我把下面这段和候选人 {{name}} 的通话整理成：一句纪要 + 3 个要点 + 顾虑 + 带时间的待办。\n通话内容：" },
];

export function expandSkill(skill, candidate, job) {
  const c = candidate || {};
  const map = {
    "{{name}}": c.name || "该候选人",
    "{{resume}}": c.resume_text || "(未提供简历文本)",
    "{{candidate}}": candidate ? JSON.stringify(pickCandidate(c)) : "(未选择候选人)",
    "{{job}}": job ? `${job.title}（${job.company || ""}）` : "(未关联岗位)",
  };
  return skill.prompt.replace(/\{\{name\}\}|\{\{resume\}\}|\{\{candidate\}\}|\{\{job\}\}/g, (m) => map[m]);
}

function pickCandidate(c) {
  return {
    name: c.name, title: c.title, company: c.company, years: c.years,
    education: c.education, expected_salary: c.expected_salary, city: c.city,
    skills: c.skills, highlights: c.highlights,
  };
}
