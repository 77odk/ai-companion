# TASK_ENGLISH_MODE：忆文英文模式（2026-09-05 七七拍板）
## 目标
让 TA 会说英文。提示词语言跟用户走，一次检测，全套切换。中文用户零回归。
## 范围（一期）
- TA 对话层全套 lang 化（提示词、记忆、注入段、质检）
- 内心戏灰条标签按 lang 切换
- 内心戏翻译（中文用户看英文思考链时懒翻译）
- 不做：UI 菜单全站 i18n、英文 busy 句式、双语并行聊天
## 一、语言检测
### 1. detectLang 纯函数（新增 lib/langDetect.ts）
```typescript
export type Lang = 'zh' | 'en'
export function detectLang(text: string): Lang
```
- 实现：`[\u4e00-\u9fff]` 中文字符数 / 总字符数 > 0.25 → zh，否则 en
- 空字符串 / 纯标点 → en（保守，英文用户不会被误判成中文）
- 纯函数，可 Node 单测
### 2. 判定优先级
- 人设优先：人设 detectLang → 会话 lang
- 人设为空：最近 5 条用户消息多数语言
- 新会话全空：默认 zh（现有用户全是中文）
### 3. 存储
- lang 存 sessionStore，按会话隔离（`xxx(sessionId)` 模式）
- 每次 send 时算一次存下来，不落云端
- MessageBubble 读会话 lang 显示内心戏标签
## 二、提示词 lang 化（全套切换）
### 4. CHAT_RULES → EN 版（lib/api.ts）
现有 4 句中文，加 EN 版 4 句，约束等价：
- 不说自己是 AI
- 短句口语化
- 有自己的日子在过
- 对方冷淡就递话题
### 5. DEFAULT_IDENTITY → EN 版（lib/api.ts）
无人设兜底时用，加 EN 版。
### 6. buildSystemPrompt 加 lang 参数（lib/api.ts）
```typescript
export function buildSystemPrompt(persona: string, name: string, milestoneText?: string, sessionId?: string, lang: Lang = 'zh'): string
```
- 默认 zh，不传=zh，老调用零改动
- 根据 lang 选 CHAT_RULES / DEFAULT_IDENTITY 的对应版本
### 7. 身份记忆规则文案 → EN 版
"你是我的男朋友"那条规则，加 EN 版。
## 三、记忆系统 lang 化
### 8. 记忆输出标记 EN 格式
- 中文：`【记忆·主题】内容`
- 英文：`[Memory: Topic] content`（例：`[Memory: Food] I like spicy food`）
- 两套并存，模型根据 lang 输出对应格式
### 9. extractMemories 加 EN 格式提取（lib/memory.ts）
- 同时支持中文 `【记忆·主题】` 和英文 `[Memory: Topic]` 两种格式
- EN 格式正则：`/^\s*\[Memory(?::\s*([^\]]+))?\]\s*(.+?)\s*$/`
### 10. stripMemoryMarkers 加 EN 标记剥离（lib/memory.ts）
- 进上下文前剥掉 `[Memory: X]` 标记行，防污染
- 中文 `【记忆】` 剥离逻辑保留
### 11. 记忆指令 EN 关键词（lib/memory.ts）
- EN 关键词：remember this / note this / keep this in mind / don't forget / memorize this / write this down
- 中文关键词保留，两套都检测（英文用户偶尔说中文也能命中）
- MEMORY_INSTRUCTION_KEYWORDS 加 EN 版，detectMemoryInstruction 同时检测两套
## 四、注入段 lang 化
### 12. 记忆注入段 → EN 版格式
- zh："关于对方你已经记住的事实：\n- ..."
- en："Facts you've remembered about them:\n- ..."
### 13. 状态块头部 → EN 版（lib/selfTimeline.ts）
- zh："你最近说过的话"
- en："Things you recently said"
### 14. 记忆指令确认句 → EN 版
- zh："用户刚要求你记住：..."
- en："They just asked you to remember: ..."
### 15. 周记注入 → EN 版框架
- 框架文字翻译，title 和 excerpt 不翻译（TA 自己写的内容原样用）
- zh："你最近写给对方的周记是「title」..."
- en："Your recent weekly note for them: 「title」..."
### 16. 动态注入 → EN 版框架
- 框架文字翻译，动态正文不翻译
- zh："你最近发过的动态：\n- ..."
- en："Your recent posts:\n- ..."
### 17. LIFE_BASELINE → EN 版（lib/spaceChatInject.ts）
- 加 EN 版，按 lang 切换
- 内容等价：住在城市、自己做饭、爱看书
### 18. 忙完回来 prompt → EN 版（lib/aiBusy.ts）
- buildBusyReturnPrompt 加 lang 参数
- 虽然英文 busy 不触发，但函数要兼容 lang
### 19. 时间/关系注入 → EN 版
- "今天是你们认识的第 X 天" → EN 版
## 五、质检 lang 化
### 20. ROBOTIC_PATTERNS / FABRICATED_PATTERNS 加英文 AI 腔（lib/api.ts）
- 英文模式：As an AI / I'm just an assistant / I hope this helps / Feel free to ask 等
### 21. 质检重写 prompt → EN 版（lib/api.ts）
- 豆包写 EN 版，乔审语气
- 要求：口语自然、别正式，约束和中文版等价（不说自己是 AI、没依据就说不知道、不编共同经历）
## 六、内心戏 lang 化 + 翻译
### 22. 内心戏灰条标签按 lang（components/MessageBubble.tsx）
- zh："TA 想了想"
- en："TA was thinking"
- 从 sessionStore 读会话 lang
### 23. 内心戏懒翻译（components/MessageBubble.tsx）
- 触发：会话 lang=zh + thinking 是英文（复用 detectLang 判断）→ 用户点开灰条时翻译
- 翻译：用 TA 自己的 key 调一次小模型，浓缩 3-5 句、≤150 字、口语、去技术味，配 few-shot
- 缓存：本地 localStorage，按消息 id 做 key，下次点开直接显示不重复烧钱
- 输入截断：翻译前截前 ~2000 字省 token
- 降级：翻译失败 / 无 key → 显示英文原文
- 不翻译：会话 lang=en → 英文用户直接看原文
- 展示统一限 600 字
## 七、测试
### 24. detectLang 单测
- 中文 >25% → zh
- 英文 / 空 → en
- 边界：25% 整算 en（> 不是 >=）
### 25. test_life_moment 拆 zh/en 两条路径
- buildSystemPrompt 加 lang 参数
- zh 路径断言含"你有自己的日子在过"/"你是对方的人"
- en 路径断言含对应英文子串
### 26. EN 记忆标记提取+剥离测试
- 模型输出 `[Memory: Food] I like spicy food` 能被 extractMemories 提取
- stripMemoryMarkers 能剥掉 `[Memory: Food]` 行
- 两端测试都覆盖
### 27. 中文用户零回归
- 默认 zh，所有现有测试保持绿
- npm test 全绿 + npm run build 过
## 八、红线
- 不碰 gh-pages（部署归乔）
- 不删函数不删测试
- 不碰 busy 触发逻辑（英文 busy 二期做）
- 人设原文不翻译不改造（用户自己写的直接用）
- 注入段内容（title/excerpt/动态正文）不翻译，只翻译框架
- 推 main 别碰 gh-pages
## 九、文件改动清单
| 文件 | 改动 |
|---|---|
| lib/langDetect.ts | 新增（detectLang 纯函数） |
| lib/api.ts | CHAT_RULES/DEFAULT_IDENTITY EN 版、buildSystemPrompt 加 lang、质检词表加英文、质检重写 EN prompt |
| lib/memory.ts | 记忆指令 EN 关键词、EN 标记格式、stripMemoryMarkers 加 EN 剥离、extractMemories 加 EN |
| lib/spaceChatInject.ts | LIFE_BASELINE EN 版、动态注入 EN 版格式 |
| lib/selfTimeline.ts | 状态块头部 EN 版 |
| lib/aiBusy.ts | buildBusyReturnPrompt 加 lang |
| components/Chat.tsx | lang 检测存 sessionStore、所有注入按 lang 切换、buildSystemPrompt 传 lang |
| components/MessageBubble.tsx | 内心戏标签按 lang、懒翻译触发+缓存 |
| sessionStore | lang 存储按会话隔离 |
| scripts/test_lang_detect.mjs | 新增（detectLang 测试） |
| scripts/test_life_moment.mjs | 拆 zh/en 两条路径 |
| scripts/test_memory.mjs | 加 EN 记忆标记提取/剥离测试 |
