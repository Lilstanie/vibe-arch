# Recruit Copilot

给猎头（Jay）用的 AI 工作台：把 **JD 分析 → 匹配沟通 → 流程管理** 三段工作流串起来，
用 LLM Agent 处理岗位拆解、候选人匹配、简历初筛、话术生成、通话纪要，并把结论沉淀到人才库。

> **零运行时依赖** —— 只需 Node ≥ 20（自带 `fetch`）。没有 API key 也能完整跑通（内置 mock）。

---

## 快速开始

```bash
cd apps/recruit-copilot
node server/seed.js --reset     # 初始化示例数据（可选，首次启动会自动 seed）
node server/index.js            # 启动 → http://localhost:5178
node scripts/smoke.js           # 另开一个终端跑端到端冒烟测试
```

三个入口：

| 入口 | 地址 | 形态 |
|---|---|---|
| **产品展示页** | `http://localhost:5178/landing.html` | 落地页，并列展示两种形态（含实时预览） |
| **Web 工作台** | `http://localhost:5178/` | 深度分析与管理中枢（SPA） |
| **Chrome 扩展联调** | `http://localhost:5178/mock-boss.html` | 模拟 Boss 页 + 停靠的完整工作台侧边栏 |

> **一体化**：扩展不是独立小挂件，而是把完整工作台（`/?embed=1`）以侧边栏 iframe 停靠在 Boss 右侧——同一套界面、同一个后端。Boss 页上打开的候选人会自动载入侧栏工作台。

默认用 **离线 mock** 跑 AI；要接真实模型：

```bash
export OPENAI_API_KEY=sk-...          # 默认 provider = ChatGPT
# 或
export ANTHROPIC_API_KEY=sk-ant-...   # 备选 provider = Claude
```

见 `.env.example`。

---

## 它解决什么（对应你提的痛点）

| 你的诉求 | 本项目怎么落地 |
|---|---|
| **① Chat 输出长期稳定、不漂移、不污染** | **无状态任务 Agent**：每次 AI 调用都是全新、隔离的 prompt（不累积对话历史）+ JSON Schema 校验 + 一次自动修复重试。见 `server/llm/agent.js`。 |
| **HR 直接和 LLM 聊天（像 ChatGPT/Claude）** | 「AI 对话」面板：多轮对话 + **可加自定义技能**（总结简历/匹配/开场白/红线/面试提纲/通话纪要，及 HR 自建）。按候选人**隔离会话** + 上下文占用条 + 一键新会话，防污染。见 `server/llm/chat.js`、`server/skills.js`。 |
| **JD → 岗位分析** | `POST /api/jobs/:id/analyze` → 硬性要求 / 红线 / Boss 关键词 / 布尔搜索串 / 对标公司 / 初筛问题。 |
| **匹配沟通** | `POST /api/candidates/:id/match`（匹配分 + 红线逐条检查）+ `/message`（开场白 / 跟进话术）。 |
| **流程管理 / Kanban** | 候选人看板（拖拽推进阶段）+ 候选人详情抽屉 + 活动流审计。 |
| **② 编辑好的信息发给 Boss** | 话术一键复制 → 半自动贴到 Boss；`extension/` 提供 Boss Chrome 扩展骨架（内容脚本，带每日打招呼限额守护）。 |
| **最花时间 / best-ROI（智能寻访）** | `POST /api/jobs/:id/sourcing`：综合候选人池 + 结果 + Jay 反馈，产出优化关键词、排除信号、**打招呼优先级排序**（带纠偏反馈闭环）。 |
| **简历初筛（自己 preview / 不确定喂 LLM）** | `POST /api/screen-resume`：抽字段 + 初筛判断，`needs_human=true` 时标记转人工。 |
| **③ 主动跟进 / 人才池激活** | 规则引擎（`server/rules.js`）按「阶段 + 停留天数」生成跟进建议（`/api/activation/followups`）；按岗位扫描沉睡候选人批量激活（`/api/jobs/:id/activate`）。「今晚/明天/本周末」→ 时间戳，统一 Asia/Shanghai 显示。 |
| **电话转文字 → 纪要 + 任务** | `POST /api/calls`：转写 → 结构化纪要（意向/要点/顾虑）+ **自动生成带时间的跟进任务**。 |
| **Feishu 多维表格** | `integrations/feishu.js` Bitable 适配器接口；`docs/MCP-FEISHU.md` 说明飞书 MCP 接入方案。 |

---

## 目录

```
apps/recruit-copilot/
├── server/
│   ├── index.js          # 零依赖 HTTP 服务 + 静态托管
│   ├── api.js            # REST 路由 ↔ 数据 ↔ AI Agent
│   ├── router.js         # 极简路由器
│   ├── store.js          # JSON 文件持久化
│   ├── seed.js           # 示例数据 + 看板阶段定义
│   └── llm/
│       ├── agent.js      # ★ 无状态任务 Agent（可靠性核心）
│       ├── provider.js   # OpenAI / Anthropic / mock（fetch）
│       ├── prompts.js    # 每个任务的自包含 prompt 模板
│       ├── schemas.js    # 输出 Schema + 校验器
│       └── mock.js       # 离线 fixtures
├── web/                  # 前端 SPA（vanilla，hash 路由）
│   ├── index.html · styles.css · app.js
├── extension/            # Boss 直聘 Chrome 扩展骨架（半自动打招呼）
├── integrations/feishu.js  # 飞书多维表格适配器接口
├── scripts/smoke.js     # 端到端冒烟测试
└── docs/                 # 工作流分析 / 架构 / 路线图 / 飞书 MCP
```

## 文档

- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — 猎头工作流拆解、每步自动化程度、**最花时间 / best-ROI** 分析
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统架构、无状态 Agent、数据模型、provider 抽象
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 产品形态演进：70%（笨办法）→ 80%（feishu/boss MCP）→ 更高自动化
- [`docs/MCP-FEISHU.md`](docs/MCP-FEISHU.md) — 飞书有没有 MCP？怎么把候选人/简历写进多维表格

> 这是一个 prototype。数据存本地 JSON，鉴权/多租户/生产化未做，见 ROADMAP。
> 想独立成库：把 `apps/recruit-copilot/` 目录拷出去 `git init` 即可，无外部耦合。
