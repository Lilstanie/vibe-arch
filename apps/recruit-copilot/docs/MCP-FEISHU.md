# 飞书（Feishu / Lark）接入方案

## 飞书有没有 MCP？

**有。** 两条路：

1. **飞书官方 Lark OpenAPI MCP Server**（`@larksuiteoapi/lark-mcp`，飞书开放平台出品）
   把飞书开放平台的 API 包装成 MCP 工具，覆盖**多维表格（Bitable）**、消息、文档、日历等。
   适合让「AI 客户端（Claude/ChatGPT 桌面端、支持 MCP 的 Agent）」直接读写飞书。

2. **社区 MCP Server**（多个开源实现，专注 Bitable 记录 CRUD）。

> 对本项目：MCP 主要用于**「让某个 AI 助手直接操作飞书」**的场景。
> 本项目自身是个 Web 服务，更适合**直连飞书开放平台 REST API**（见下）。两者不冲突，可并存。

## 表结构（对应 Jay 的用法）

- **Table 1 · 候选人库**：姓名 / 手机 / 现公司 / 期望薪资 / 阶段 / 匹配分 / 关联岗位 …
- **Table 2 · 简历库**：原始简历文本或附件 / AI 抽取字段 / 初筛结论（`preview_verdict`）。

`candidates` 与 `calls`/`reminders` 通过 `candidate_id` 关联，天然映射到多维表的关联字段。

## 直连方案（推荐给本服务）

飞书开放平台 Bitable 记录 API（示意）：

```
POST https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records
Authorization: Bearer {tenant_access_token}
Body: { "fields": { "姓名": "张伟", "期望薪资": "35-45K", "匹配分": 78, ... } }
```

`tenant_access_token` 由 app_id / app_secret 换取（`/open-apis/auth/v3/tenant_access_token/internal`）。

本项目已留出适配层：[`integrations/feishu.js`](../integrations/feishu.js)
—— 定义了 `upsertCandidate / upsertResume / listCandidates` 接口，
默认 **dry-run（打印将要写入的内容）**；配好 `FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_*`
后切成真实写入即可，`store.js` 的调用点无需改动。

## 落地步骤

1. 飞书开放平台建**企业自建应用**，开通「多维表格」权限，拿 app_id / app_secret。
2. 建一个多维表，建 Table 1 / Table 2，记下 app_token 与 table_id。
3. 配置环境变量，把 `integrations/feishu.js` 的 `DRY_RUN` 关掉。
4. 在 `api.js` 的入库/匹配/初筛处调用适配器（当前留了 TODO 注释锚点）。

## 双向回流（Feishu → 本系统）

写入是一半，回流是另一半：Jay 或团队常直接在多维表格里改「阶段/备注」，这些改动要能同步回来。

- 已实现：`POST /api/feishu/pull` 逐条读取候选人对应的 Bitable 记录，比对「阶段/备注」，有变化就更新本地。
  - live 模式：真实 GET 记录（`getRemoteFields` 走 Bitable 记录查询）。
  - dry-run：用内存里的"模拟远端"演示整条往返（`POST /api/feishu/simulate-remote-edit` 模拟有人在飞书改了阶段，再 `pull` 回来）。UI 顶栏「↻ 拉取飞书」+ 候选人抽屉「🧪 模拟回流」。
- 生产化建议：用**飞书事件订阅（webhook）**在记录变更时主动推送，替代轮询做实时回流。

## 为什么先不默认打通

- 需要真实企业凭证与你们的表结构，属于**部署期配置**，不适合塞进 prototype 默认路径。
- 适配层已就位 → 从「70% 复制粘贴」到「80% 自动写飞书」只差填凭证，是 ROADMAP 的第一个里程碑。
