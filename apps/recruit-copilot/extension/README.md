# Boss 直聘扩展（骨架）

在 Boss 页面就地调用 Recruit Copilot 的半自动助手。**只填入、不自动发送**——
把 AI 生成的开场白填进聊天框，由 Jay 确认后手动发送，并守护每日打招呼限额。

## 加载

1. 先启动本地服务：`node ../server/index.js`（默认 `http://localhost:5178`）。
2. Chrome → `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选本目录。
3. 打开 Boss 直聘候选人页，右下角出现悬浮面板。

## 已内置

- 右下角悬浮面板 +「生成开场白并填入」按钮
- 调本地服务取候选人话术
- **每日打招呼计数守护**（`DAILY_GREET_LIMIT = 25`），接近上限提示优先高匹配候选人
- 只 `fillChatBox()` 填入，绝不自动点发送

## 需按实际页面校准

Boss 页面结构会变，`content.js` 顶部两个选择器需实测调整：

- `CANDIDATE_NAME_SEL` —— 候选人姓名元素
- `CHAT_INPUT_SEL` —— 聊天输入框（textarea 或 contenteditable）

## 合规与边界

- 坚持"人确认发送"，不做无人值守群发——规避平台风控与骚扰体验。
- 自动化程度定位在**半自动**（见 `../docs/ROADMAP.md` 里程碑 2）。
