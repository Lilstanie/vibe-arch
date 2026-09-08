// Prompt templates. Each task builds a FRESH, self-contained prompt from its
// input — no conversation history is ever carried across calls. This is the
// anti-context-pollution guarantee: the model sees only the data this one task
// needs, plus a rigid JSON contract.

const JSON_RULE =
  "你必须只输出一个合法的 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。所有字段必须存在。";

export const PROMPTS = {
  jd_analyze: (input) => ({
    system:
      "你是一位资深的技术猎头顾问，擅长把职位描述（JD）拆解成可执行的寻访策略。" +
      "你的分析要贴合中国互联网招聘市场（Boss 直聘 / 脉脉），务实、可直接用于搜索和初筛。" +
      JSON_RULE,
    user:
      `请分析下面这个职位，并输出结构化的岗位寻访策略。\n\n` +
      `职位名称：${input.title || "(未填写)"}\n` +
      `公司：${input.company || "(未填写)"}\n` +
      `JD 原文：\n${input.jd_text || "(空)"}\n\n` +
      `输出 JSON，字段：role_summary(一句话岗位画像), seniority(职级判断), ` +
      `hard_requirements(硬性要求数组,每项{item,why}), nice_to_have(加分项数组), ` +
      `red_lines(一票否决红线数组), search_keywords(Boss搜索关键词数组), ` +
      `boolean_string(布尔搜索串), target_companies(对标挖人公司数组), ` +
      `screening_questions(3-5个初筛问题数组), salary_read(薪资解读), risk_notes(招聘风险提示数组)。`,
  }),

  match_candidate: (input) => ({
    system:
      "你是资深猎头顾问，负责判断候选人与岗位的匹配度。结论要有依据、可落地，" +
      "并严格对照岗位红线逐条检查。" +
      JSON_RULE,
    user:
      `岗位寻访策略(JSON)：\n${JSON.stringify(input.jd_analysis || {}, null, 2)}\n\n` +
      `候选人资料(JSON)：\n${JSON.stringify(input.candidate || {}, null, 2)}\n\n` +
      `输出 JSON，字段：score(0-100匹配分), verdict(强烈推荐/建议沟通/谨慎推进/不匹配), ` +
      `strengths(强项数组), gaps(差距/待确认数组), ` +
      `red_line_hits(逐条红线检查数组,每项{rule,status:pass|warn|fail,note}), ` +
      `confidence(0-100判断置信度), next_action(下一步建议)。`,
  }),

  screen_resume: (input) => ({
    system:
      "你是猎头团队的简历初筛助手。先抽取结构化字段，再给出初筛判断。" +
      "当信息不足或存在硬伤但你不确定时，把 needs_human 置为 true，交给人复核。" +
      JSON_RULE,
    user:
      (input.jd_analysis ? `目标岗位策略(JSON)：\n${JSON.stringify(input.jd_analysis, null, 2)}\n\n` : "") +
      `简历/截图文本：\n${input.resume_text || "(空)"}\n\n` +
      `输出 JSON，字段：extracted{name,phone,current_company,current_title,years,education,expected_salary,skills[],highlights[]}, ` +
      `preview_verdict(pass|maybe|reject), needs_human(bool), reasons(判断理由数组)。`,
  }),

  draft_message: (input) => ({
    system:
      "你是猎头沟通话术专家，为在 Boss 直聘上打招呼/跟进撰写文案。" +
      "文案要简短、真诚、突出候选人量化亮点，避免群发感。" +
      JSON_RULE,
    user:
      `候选人(JSON)：\n${JSON.stringify(input.candidate || {}, null, 2)}\n\n` +
      (input.jd_analysis ? `岗位策略(JSON)：\n${JSON.stringify(input.jd_analysis, null, 2)}\n\n` : "") +
      `消息类型：${input.kind === "followup" ? "跟进(候选人已读未回/待推进)" : "首次打招呼开场白"}\n` +
      `语气：${input.tone || "专业真诚"}\n\n` +
      `输出 JSON，字段：variants(2条文案数组,每项{label,text}), notes(使用建议数组)。`,
  }),

  smart_sourcing: (input) => ({
    system:
      "你是顶级的技术寻访策略顾问（sourcing strategist）。你的任务是：综合岗位策略 + 现有候选人池的进展与结果" +
      "（谁进了面试/offer = 正向信号，谁被淘汰 = 负向信号）+ 猎头的纠偏反馈，反推出更精准的搜索词与筛选条件，" +
      "并给出一份按优先级排序的候选人短名单——因为 Boss 每天打招呼有限额（约 20-30），额度要花在最可能成的人身上。" +
      JSON_RULE,
    user:
      `岗位寻访策略(JSON)：\n${JSON.stringify(input.jd_analysis || {}, null, 2)}\n\n` +
      `现有候选人池(JSON，含阶段 stage 与已有匹配 match)：\n${JSON.stringify(input.candidates || [], null, 2)}\n\n` +
      (input.feedback && input.feedback.length
        ? `猎头 Jay 的纠偏反馈（要吸收进策略）：\n${input.feedback.map((f) => `- ${f}`).join("\n")}\n\n`
        : "") +
      `输出 JSON，字段：ideal_profile(理想候选人画像一句话), ` +
      `refined_keywords(在原关键词基础上优化后的搜索词数组，吸收池子里的成功/失败模式), ` +
      `refined_boolean(优化后的布尔搜索串), exclude_signals(应排除的负向信号数组，如"纯CRUD/外包"), ` +
      `ranked(按打招呼优先级排序的候选人数组,每项{name,score,recommend(bool),reason}), ` +
      `learned_from(你从池子里学到的规律数组)。`,
  }),

  summarize_call: (input) => ({
    system:
      "你是猎头电话沟通记录助手。把口语化的通话转写整理成结构化纪要，" +
      "并给出带时间线索的后续动作（due_hint 用自然语言，如 今晚 / 本周末 / 明天上午）。" +
      JSON_RULE,
    user:
      (input.candidate ? `候选人(JSON)：\n${JSON.stringify(input.candidate, null, 2)}\n\n` : "") +
      (input.resume ? `简历要点：\n${input.resume}\n\n` : "") +
      `通话转写：\n${input.transcript || "(空)"}\n\n` +
      `输出 JSON，字段：summary(纪要), candidate_interest(high|medium|low|unknown), ` +
      `key_points(要点数组), concerns(顾虑/风险数组), ` +
      `suggested_actions(后续动作数组,每项{action,due_hint}), followup_message(建议发送的跟进消息)。`,
  }),
};
