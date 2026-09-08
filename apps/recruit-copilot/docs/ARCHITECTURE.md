# 架构

```
┌──────────────┐   HTTP/JSON    ┌────────────────────────────────┐
│  web/ (SPA)  │ ◀────────────▶ │  server/ (Node, zero-dep)      │
│  vanilla JS  │                │  index.js → router → api.js    │
└──────────────┘                │        │                        │
                                │        ▼                        │
                                │   store.js (JSON file)          │
                                │        │                        │
                                │        ▼                        │
                                │   llm/agent.js  ← 无状态任务层   │
                                │     ├ prompts.js  (每任务模板)   │
                                │     ├ schemas.js  (输出契约)     │
                                │     ├ provider.js (OpenAI/Claude)│
                                │     └ mock.js     (离线 fixtures)│
                                └────────────────────────────────┘
```

## 可靠性核心：无状态任务 Agent

回答「**如何保证 ChatGPT 输出长期稳定、不漂移、不污染**」——不是靠提示词祈祷，而是靠**架构约束**：

1. **无状态（Stateless）**
   每次 AI 调用都由 `prompts.js` 根据**本次输入**现场拼出完整 prompt，**从不携带历史对话**。
   任务之间、候选人之间的上下文物理隔离 → 不可能跨任务污染。
   （对比：把所有东西塞进一个长对话，是上下文污染和输出漂移的根源。）

2. **结构化契约（Structured）**
   每个任务的输出用 `schemas.js` 里的 Schema 强校验。形状是硬约束，模型不能自由发挥字段。

3. **自愈（Self-healing）**
   解析/校验失败时，把**具体错误**回灌给模型做一次 repair 重试（`temperature=0`）。
   仍失败则抛错，绝不把脏数据写库。

4. **优雅降级（Graceful）**
   无 API key 时走 `mock.js`，但**走同一条 Schema 校验路径**，两种模式行为一致 → 永远可演示。

```
runAgent(task, input)
  ├─ mock?  → MOCK[task](input) ──┐
  └─ live?  → provider.complete ──┤→ extractJson → validate(schema)
                                   │      └─ fail → repair 一次 → validate
                                   ▼
                              { data, provider, ms, repaired }
```

## Provider 抽象

`provider.js` 用 `fetch` 直连，无 SDK：
- 默认 **OpenAI（ChatGPT）**，`response_format: json_object`。
- 备选 **Anthropic（Claude）**。
- `activeProvider()` 按环境变量选择；无 key → `mock`。

切换只需环境变量，业务代码零改动。

## 数据模型（`store.js`）

| 集合 | 关键字段 |
|---|---|
| `jobs` | title, company, jd_text, **analysis**(AI 产出的寻访策略) |
| `candidates` | job_id, name, skills[], highlights[], **stage**, **match**(AI 匹配结果), resume_text, notes |
| `reminders` | candidate_id, text, due(ISO), due_hint, done, source |
| `calls` | candidate_id, transcript, **result**(AI 纪要) |
| `activities` | type, text, at —— 全链路审计 |

持久化是本地 JSON 文件；接口层 `col(name)` 抽象了增删改查，**换成飞书 Bitable / Postgres 只需替换实现**。

## API 一览

```
GET  /api/state · /api/meta · /api/health
POST /api/jobs                 · POST /api/jobs/:id/analyze          (AI①)
GET  /api/candidates · POST … · PATCH /api/candidates/:id
POST /api/candidates/:id/stage · /match (AI②) · /message (AI④)
POST /api/screen-resume        (AI③)
GET/POST /api/reminders · POST /api/reminders/:id/done
GET/POST /api/calls            (AI⑤：纪要 + 自动建提醒)
POST /api/reset
```

## 非目标（prototype 边界）

鉴权、多租户、并发写锁、真实 Boss/飞书 OAuth、无人值守自动化——均见 [ROADMAP.md](ROADMAP.md)。
