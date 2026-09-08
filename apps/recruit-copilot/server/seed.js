// Seed data. Run `node server/seed.js --reset` to (re)initialize the store.

import { reset } from "./store.js";

export const STAGES = [
  { key: "sourced", label: "待联系" },
  { key: "greeted", label: "已打招呼" },
  { key: "replied", label: "已回复" },
  { key: "screening", label: "沟通/初筛" },
  { key: "interview", label: "约面/面试" },
  { key: "offer", label: "Offer" },
  { key: "onboard", label: "入职" },
  { key: "rejected", label: "暂缓/淘汰" },
];

const t = (d) => new Date(Date.now() + d * 3600 * 1000).toISOString();

export const SEED = {
  jobs: [
    {
      id: "job_zaixian_be",
      title: "资深后端开发工程师",
      company: "某电商科技（上海）",
      jd_text:
        "负责交易中台核心链路的设计与稳定性建设。要求：5年以上Java后端经验；" +
        "精通分布式、高并发，有大促/秒杀实战；熟悉RocketMQ/Kafka等消息中间件；" +
        "熟悉MySQL分库分表与调优；本科及以上。薪资35-50K·16薪。",
      analysis: null,
      created_at: t(-72),
    },
  ],
  candidates: [
    {
      id: "cand_zhangwei",
      job_id: "job_zaixian_be",
      name: "张伟",
      title: "高级后端开发工程师",
      company: "某电商科技（上海）",
      years: "7年",
      education: "本科",
      expected_salary: "35-45K",
      city: "上海",
      skills: ["Java", "分布式", "高并发", "RocketMQ", "MySQL", "Redis"],
      highlights: ["订单系统重构 QPS 2k→12k", "支付网关日均 800w 笔"],
      stage: "replied",
      stage_since: t(-72),
      match: null,
      notes: "Boss 已回复，待安排电话初面",
      resume_text:
        "张伟，32岁，7年经验，本科。现任某电商科技高级后端。主导订单系统重构，QPS 2k→12k。" +
        "前司支付网关日均800w笔，成功率99.99%。技能：Java/分布式/高并发/RocketMQ/MySQL/Redis。期望35-45K。",
      created_at: t(-48),
    },
    {
      id: "cand_lina",
      job_id: "job_zaixian_be",
      name: "李娜",
      title: "后端开发工程师",
      company: "某支付公司",
      years: "5年",
      education: "本科",
      expected_salary: "28-35K",
      city: "上海",
      skills: ["Java", "Spring Cloud", "MySQL"],
      highlights: ["对账系统 T+1 优化"],
      stage: "greeted",
      stage_since: t(-120),
      match: null,
      notes: "已打招呼，未读",
      resume_text: "李娜，5年Java后端，支付方向，做过对账系统优化。期望28-35K。",
      created_at: t(-30),
    },
    {
      id: "cand_chenchen",
      job_id: "job_zaixian_be",
      name: "陈晨",
      title: "资深后端工程师",
      company: "某大厂",
      years: "8年",
      education: "硕士",
      expected_salary: "45-55K",
      city: "杭州",
      skills: ["Java", "Kafka", "分布式", "K8s"],
      highlights: ["秒杀系统 10w QPS", "带 8 人团队"],
      stage: "interview",
      stage_since: t(-96),
      match: null,
      notes: "一面通过，约二面",
      resume_text: "陈晨，8年，硕士，大厂资深后端。做过秒杀10w QPS，精通Kafka，带8人团队。期望45-55K，杭州。",
      created_at: t(-96),
    },
    {
      id: "cand_wangfang",
      job_id: "job_zaixian_be",
      name: "王芳",
      title: "Java 开发工程师",
      company: "某外包",
      years: "4年",
      education: "大专",
      expected_salary: "20-25K",
      city: "上海",
      skills: ["Java", "MyBatis"],
      highlights: [],
      stage: "sourced",
      stage_since: t(-216),
      match: null,
      notes: "简历偏 CRUD，待初筛",
      resume_text: "王芳，4年，大专，外包背景，主要做业务CRUD开发。期望20-25K。",
      created_at: t(-12),
    },
  ],
  reminders: [
    {
      id: "rem_1",
      candidate_id: "cand_zhangwei",
      text: "给张伟发岗位+团队介绍资料",
      due: t(4),
      due_hint: "今晚",
      done: false,
      created_at: t(-2),
    },
    {
      id: "rem_2",
      candidate_id: "cand_chenchen",
      text: "跟进陈晨二面时间",
      due: t(20),
      due_hint: "明天",
      done: false,
      created_at: t(-5),
    },
  ],
  calls: [],
  activities: [
    { id: "act_seed", at: t(-1), type: "system", text: "系统初始化，载入示例数据" },
  ],
};

if (process.argv.includes("--reset")) {
  reset(SEED);
  console.log("DB reset with seed data.");
}
