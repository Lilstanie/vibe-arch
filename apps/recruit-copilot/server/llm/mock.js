// Deterministic, input-aware fixtures. Used when no API key is configured so
// the whole product runs and demos end-to-end offline. Shapes match SCHEMAS
// exactly, so the same validation path runs for mock and real output.

const pick = (v, d) => (v && String(v).trim() ? v : d);

export const MOCK = {
  jd_analyze: (input) => {
    const title = pick(input.title, "资深后端开发工程师");
    return {
      role_summary: `${title}：负责高并发交易/核心链路的架构与稳定性，要求扎实的分布式功底与量化产出。`,
      seniority: "中高级（7 年左右，能独立负责模块并带小组）",
      hard_requirements: [
        { item: "5 年以上 Java 后端经验", why: "岗位需独立扛核心链路" },
        { item: "分布式 / 高并发实战（有量化战绩）", why: "JD 强调交易系统吞吐" },
        { item: "熟悉消息中间件（Kafka / RocketMQ）", why: "异步化与最终一致性场景" },
        { item: "MySQL 调优 / 分库分表经验", why: "数据量与性能瓶颈" },
      ],
      nice_to_have: ["有大促/秒杀经验", "Service Mesh / 云原生", "带过团队"],
      red_lines: ["频繁跳槽（2 年内多段）", "无量化产出、纯 CRUD 履历", "学历不达标（要求本科及以上）"],
      search_keywords: ["Java", "分布式", "高并发", "RocketMQ", "分库分表", "交易系统", "秒杀"],
      boolean_string: '(Java) AND (分布式 OR 高并发) AND (RocketMQ OR Kafka) AND (交易 OR 订单 OR 支付)',
      target_companies: ["阿里", "美团", "拼多多", "字节", "京东", "携程"],
      screening_questions: [
        "介绍一次你主导的高并发优化，QPS 从多少到多少？",
        "消息中间件选型：Kafka vs RocketMQ 你怎么权衡？",
        "分库分表后如何解决分布式事务与跨库查询？",
        "线上一次严重故障的定位与复盘过程？",
      ],
      salary_read: "预算 35-50K·16 薪，与市场资深后端相符，可覆盖多数在职候选人的期望。",
      risk_notes: ["Kafka 深度需面试验证", "在职候选人需确认竞业与到岗时间"],
    };
  },

  match_candidate: (input) => {
    const c = input.candidate || {};
    const name = pick(c.name, "候选人");
    return {
      score: 78,
      verdict: "建议沟通",
      strengths: [
        `${name} 的 Java + 分布式 + 高并发经验扎实`,
        "订单系统重构 QPS 2k→12k，量化战绩过硬，命中 JD 高并发要求",
        "7 年经验且带过 5 人小组，职级匹配",
      ],
      gaps: ["JD 要求 Kafka，简历以 RocketMQ 为主，深度需面试验证", "现公司在职，需确认离职时间与竞业协议"],
      red_line_hits: [
        { rule: "无频繁跳槽", status: "pass", note: "两段经历 4 年 / 3.5 年" },
        { rule: "学历本科及以上", status: "pass", note: "本科统招" },
        { rule: "有量化产出", status: "pass", note: "QPS、成功率均有数据" },
        { rule: "竞业/到岗", status: "warn", note: "在职，需电话确认" },
      ],
      confidence: 82,
      next_action: "安排 15 分钟电话初面，重点摸底 Kafka 深度与离职时间。",
    };
  },

  screen_resume: (input) => {
    const txt = input.resume_text || "";
    const has = (k) => txt.includes(k);
    return {
      extracted: {
        name: has("张伟") ? "张伟" : "(待确认)",
        phone: "138****6021",
        current_company: "某电商科技（上海）",
        current_title: "高级后端开发工程师",
        years: "7年",
        education: "本科",
        expected_salary: "35-45K · 上海",
        skills: ["Java", "分布式", "高并发", "RocketMQ", "MySQL", "Redis"],
        highlights: ["订单系统重构 QPS 2k→12k", "支付网关日均 800w 笔，成功率 99.99%"],
      },
      preview_verdict: "pass",
      needs_human: false,
      reasons: ["硬技能匹配后端方向", "有清晰量化战绩", "薪资在预算内"],
    };
  },

  draft_message: (input) => {
    const c = input.candidate || {};
    const name = pick(c.name, "你好");
    const followup = input.kind === "followup";
    return followup
      ? {
          variants: [
            { label: "轻提醒", text: `${name}你好，前两天聊到的资深后端岗位，方便的话我把 JD 细节和团队情况发你参考？也想听听你目前的看法～` },
            { label: "给价值", text: `${name}，补充一点：这个岗位薪资能覆盖你的期望，且负责的是交易中台核心链路，和你订单系统的经验很契合。要不约个 15 分钟电话细聊？` },
          ],
          notes: ["跟进消息避免催促感，给新信息或新价值点", "两条择一，勿群发"],
        }
      : {
          variants: [
            { label: "技术共鸣", text: `${name}你好，看到你主导订单系统重构把 QPS 从 2k 做到 12k，非常亮眼。我们在招资深后端负责交易中台高并发场景，方向很契合，方便聊两句吗？` },
            { label: "简洁直接", text: `你好${name}，你的分布式+高并发背景和我们岗位很匹配，薪资范围也覆盖你的期望，想约时间深入聊聊，你看合适吗？` },
          ],
          notes: ["开场白突出对方量化亮点，降低群发感", "Boss 每日打招呼有限额（约 20-30），优先高匹配候选人"],
        };
  },

  summarize_call: (input) => ({
    summary:
      "与候选人电话沟通约 12 分钟。对岗位方向（交易中台/高并发）有兴趣，认可技术挑战；" +
      "当前在职，考虑年后看机会，最关注团队技术氛围与晋升空间。对薪资无明显异议。",
    candidate_interest: "medium",
    key_points: ["认可岗位技术挑战", "在职，倾向年后看机会", "关注团队氛围与晋升"],
    concerns: ["到岗时间较晚（年后）", "需确认现公司竞业限制"],
    suggested_actions: [
      { action: "把 JD 与团队介绍整理成一段发给候选人", due_hint: "今晚" },
      { action: "周末发一条轻跟进，维持热度", due_hint: "本周末" },
      { action: "确认竞业协议细节", due_hint: "下次沟通时" },
    ],
    followup_message: "很高兴今天聊得投缘～我整理了岗位和团队的资料发你，你先看看，有任何问题随时找我。",
  }),
};
