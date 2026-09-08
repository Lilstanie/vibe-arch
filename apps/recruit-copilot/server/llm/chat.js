// HR <-> LLM conversation runner for the chat panel.
//
// This is the interactive surface (a real multi-turn chat), but it keeps the
// same anti-pollution guardrails the rest of the product is built on:
//   - each session is isolated and tied to at most one candidate;
//   - the candidate profile is injected as structured context, not accumulated
//     free text;
//   - a context-usage estimate is returned so the UI can nudge "开新会话".

import { chat as providerChat, activeProvider } from "./provider.js";

function systemPrompt(candidate, job) {
  let s =
    "你是资深猎头顾问 Jay 的 AI 助手。你帮他分析候选人、写沟通话术、做判断决策。" +
    "回答用中文，简洁、专业、可落地；能给结论就别绕。";
  if (candidate) {
    s += `\n\n【已载入候选人档案】\n${JSON.stringify(
      {
        name: candidate.name, title: candidate.title, company: candidate.company,
        years: candidate.years, education: candidate.education,
        expected_salary: candidate.expected_salary, city: candidate.city,
        skills: candidate.skills, highlights: candidate.highlights,
        resume: candidate.resume_text,
      },
      null,
      1
    )}`;
  }
  if (job) s += `\n\n【目标岗位】${job.title}（${job.company || ""}）`;
  return s;
}

// rough context-usage estimate (chars ≈ tokens*1.6 for zh); % of a ~8k budget
export function estimateUsage(messages) {
  const chars = messages.reduce((n, m) => n + (m.content || "").length, 0);
  return { chars, pct: Math.min(100, Math.round((chars / 8000) * 100)), rounds: messages.filter((m) => m.role === "user").length };
}

export async function runChat(messages, candidate, job) {
  if (activeProvider() === "mock") return mockReply(messages, candidate);
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  return providerChat({ system: systemPrompt(candidate, job), messages: msgs });
}

// ---- offline mock: believable, candidate-aware recruiter replies ----
function mockReply(messages, candidate) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const q = (last?.content || "") + " " + (last?.display || "");
  const name = candidate?.name || "该候选人";
  const hl = candidate?.highlights?.[0] || "有量化战绩";

  if (/总结|简历/.test(q)) {
    return `**${name} 简历速览**\n\n**核心能力**\n- ${(candidate?.skills || ["Java", "分布式"]).slice(0, 3).join(" / ")} 方向扎实\n- ${hl}\n\n**量化亮点**\n- ${hl}\n\n**潜在风险**\n- 部分技能深度需面试验证\n- 若在职，需确认到岗时间与竞业`;
  }
  if (/匹配|match|约不约|约面/.test(q)) {
    return `对照当前岗位，${name} 综合匹配 **78 分（建议沟通）**。\n\n**强项**：${hl}，方向契合高并发要求。\n**差距**：个别硬技能深度待验证；在职需确认离职时间。\n**红线**：稳定性/学历/量化产出均通过。\n\n**建议**：约 15 分钟电话初面，重点摸底短板与到岗时间。`;
  }
  if (/开场白|招呼|打招呼/.test(q)) {
    return `**版本 A（技术共鸣）**\n${name}你好，看到你${hl}，非常亮眼。我们在招资深后端负责高并发场景，方向很契合，方便聊两句吗？\n\n**版本 B（简洁直接）**\n你好${name}，你的背景和我们岗位很匹配，薪资也覆盖你的期望，想约时间深聊，你看合适吗？`;
  }
  if (/红线/.test(q)) {
    return `**${name} 红线检查**\n- 稳定性：通过（无频繁跳槽）\n- 学历：通过\n- 量化产出：通过（${hl}）\n- 竞业/到岗：待确认（若在职需电话核实）\n\n结论：无硬性红线，可推进。`;
  }
  if (/面试|提纲|提问/.test(q)) {
    return `针对 ${name} 的 5 个面试问题：\n1. 介绍一次你主导的高并发优化，指标从多少到多少？\n2. 消息中间件选型你怎么权衡？\n3. 分库分表后如何处理分布式事务？\n4. 线上一次严重故障的定位与复盘？\n5. 你最想在下一份工作中提升什么？`;
  }
  if (/纪要|通话|电话/.test(q)) {
    return `**纪要**：与 ${name} 沟通约 10 分钟，对岗位方向有兴趣，在职考虑年后看机会。\n**要点**：认可技术挑战；关注团队氛围；薪资无异议。\n**顾虑**：到岗较晚；需确认竞业。\n**待办**：\n- 今晚：发岗位+团队资料\n- 本周末：轻跟进维持热度`;
  }
  return `收到。关于 ${name}，我可以帮你：总结简历、做匹配分析、写开场白、红线检查、出面试提纲，或整理通话纪要——点上方的技能，或直接问我。\n\n（当前为离线模拟回复；设置 OPENAI_API_KEY 即接入真实模型。）`;
}
