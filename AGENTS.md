# 忆文 Eluvin · AI 编码助手红线与提交规范

版本 v3.1（公开安全版，2026-10-09）。在 v2 基础上：①新增 C 级「受控拆分」；②修正第五节与第九节关于直推 main 的矛盾；③基线数字不再写死；④CSS 拆分单独约定验收；⑤Chat 拆分禁止状态提升；⑥拆分设终点与路径限制；⑦**按项目方要求放松三处限制**（依赖走准入评估、视觉类改动不再要求先上拍板清单、小 bug 可顺手修但要单列）。

v3.1 追加两条审查纪律：①「顺手修」必须写进 PR 描述的固定小节，审查时专门扫这一节；②后端接口改动必须附前后字段对照表。

适用范围：豆包 / Codex / Claude / 任何外部或内部 AI 编码助手在本仓库工作时的强制规范。

---

## 零、总则

本项目是养成型 AI 伴侣 PWA，用户自带模型 key，数据存浏览器 localStorage + 账号云同步，主线只有一个 TA。

最高优先级三条：

1. 不动用户数据
2. 不破坏聊天体验
3. 不擅自扩大改动范围

任何拿不准的改动，先停下来说明，不要先动手。

---

## 一、文件保护分级

### A 级：任何情况下都不许动

- backend/ 整个目录（后端代码不在本仓库），以及任何服务部署与运维配置
- 任何 .env / key / token / 凭据文件
- src/components/ConsentGate.tsx、src/components/LoginGate.tsx（同意门与登录墙）
- src/lib/consentState.ts（同意版本记录）、src/lib/auth.ts、src/lib/token.ts（登录态）
- 删除、裁剪、清空用户聊天记录的任何动作（含上传 / 合并 / 去重链路）
- public/ 下【已有的】图片资产：不许重新生成、裁切、压缩、改色、改尺寸，只许原样新增文件
- gh-pages 分支（历史遗留，已弃用）

### B 级：可按当轮任务书改，一次一批、先说范围

- src/lib/memory.ts（记忆读写与数据结构）：结构与隔离规则不变，注入 / 召回 / 展示相关可按任务书改
- src/lib/memoryWall.ts、src/lib/sessionStore.ts（仅新增字段与展示；上传 / 合并 / 去重链路仍按 A 级禁改）
- src/lib/sync.ts（只在现有 Cloud State kind 体系内注册新 kind，不许开第二套同步接口）
- src/lib/sessionApi.ts（后端接口封装；401 触发 logout 的行为不许改）
- src/lib/migrateLocal.ts（老数据迁移：只许加兼容分支，不许改既有迁移语义）
- src/lib/weeklyReview.ts、src/lib/eventStore.ts、src/lib/eventDetector.ts（Event 与周记）
- src/components/AISpace.tsx（空间页）
- src/components/Chat.tsx（聊天页，允许的挂载点见第四节；C 级拆分规则见下文）
- public/ 下【新增】的场景 / 素材文件（只许本地打包，不许网络图片）

### C 级：受控拆分，允许小步重构

以下文件因体积过大，允许按「拆分任务书」做纯机械性拆分：

- src/components/Chat.tsx
- src/App.tsx
- src/index.css

C 级通用规则：

1. 只许「剪切粘贴」式拆分：把已有代码块搬到新文件，不许改逻辑、不许改行为。
2. 拆分前必须先输出「拆分清单」：列出每个新文件的路径、从原文件哪一段搬走、导出什么、需要哪些入参。
3. 一个文件一个 PR，不许跟功能批次混在一起。
4. 拆分 PR 的 diff 必须是「原文件删块 + 新增文件」形态；禁止在搬迁过程中顺手格式化、改命名、调 import 顺序，否则没法逐行核。
5. 新文件只许放进已有目录（src/components、src/lib、src/styles），不许新建顶层目录。
6. 拆分有终点，达到即停，不许顺势继续重构：
   - Chat.tsx 降到 40KB 以内
   - App.tsx 降到 25KB 以内
   - index.css 拆成不超过 8 个文件，且每个不超过 40KB

Chat.tsx / App.tsx 额外禁令（禁止状态提升）：

- 只许把 JSX 子树和它自带的私有 props 搬走。
- 不许把 useState / useEffect 提到父层。
- 不许改编排顺序、改 key、改事件绑定顺序、改闭包依赖。
- 凡涉及状态或副作用的搬迁，一律算改行为，不做。
- 拆分任务书里要逐个新文件写清「搬走哪些函数和 JSX、需要哪些入参」。

index.css 额外验收（CSS 拆分不是零行为变化）：

把 CSS 块搬到新文件会改变加载顺序和层叠优先级；同特异性选择器、媒体查询覆盖、!important 都会受影响，而 npm test 不覆盖样式。因此 CSS 拆分的验收必须额外满足：

- 拆分前后用真头浏览器逐页比对关键元素的 computed style，数值一致才算过。
- 不允许只看测试绿。

所有 C 级拆分的共同验收：

- npm test 全绿（以 main 上实际输出为准）。
- 390 宽 iPhone 视图：0 pageerror、0 console error、无横向溢出。
- CSS 拆分另加 computed style 比对。

---

## 二、可以改，但必须先满足前置条件

1. 先读现状：改任何模块前，先读该模块代码与它引用的数据层，说清现状再动手。
2. 先说范围：写清要改哪几个文件、为什么、影响什么，确认后再改。
3. 一次一件事：拆小批量，跑完一批验收一批，绝不并行开多个改造。
4. 视觉与 UI 类改动：**不再要求先上拍板清单**。凭当轮任务书直接做，但交付必须附证据：①与设计稿的并排截图；②每件素材的来源与在页面上的实际尺寸；③动效逐条自查（写清哪一条动了、怎么动）。
5. 文案类改动：逐字对照第十一节与第十五节红线。
6. 涉及记忆、聊天记录、同步的改动：额外跑对应测试脚本，并在交付说明里列出跑过的测试名。

---

## 三、数据结构 / storage key / API / 同步红线

1. 不许改 MemoryItem 字段定义，不许加必填字段，不许改旧字段语义。
2. 不许新增 localStorage key 去绕开现有数据层。现有前缀统一 `ai_companion_`，关键的有：
   - ai_companion_account
   - ai_companion_active_session_id
   - ai_companion_sessions_cache
   - ai_companion_memory（全局 explicit 记忆）
   - ai_companion_mem_（会话记忆）
   - ai_companion_msgs_（会话消息）
   - ai_companion_settings / ai_companion_persona / ai_companion_user_profile / ai_companion_ai_profile / ai_companion_theme / ai_companion_events / ai_companion_anniversaries_ / ai_companion_photos
3. 后端接口**可以按当轮任务调整**（路径、请求体字段、响应结构、新增表都可以），但必须：①改动写进交付说明；②**附前后字段对照表**（旧字段 → 新字段、新增字段、移除字段，逐条列出）；③前端同步改到位；④不许开第二套同步接口。
4. 同步只走现有同步通道（当前主路径是 Cloud State 的 /api/state/pull|push 增量；老的 /api/sync 全量 blob 仍在兼容）；新数据要同步就注册成现有 kind。
5. 不许删减、裁剪、清空任何用户聊天记录。「刷新对话」只清当前上下文，历史一条不少。
6. 不许把用户模型 key 上传服务器；所有 AI 调用在用户浏览器里用用户自己的 key。
7. 不许加游客直进聊天（登录墙必须在前），不许绕过 ConsentGate 的同意与年龄门。

---

## 四、各模块保护边界

本节的「允许动」以当轮任务书为前提。视觉与 UI 类不再要求先上拍板清单，但必须按第二节第 4 条附证据交付。

- Chat：允许动「Event 候选识别挂载」「记忆注入旁挂载」，以及「身份边界护栏」的限定薄挂载：身份模式可决定 Space 是否作为 SELF 事实注入、Busy 是否允许进入/恢复/Return，以及 finalization/retry 最终落库前的 detector + 一次 repair retry + 安全 fallback。真人 Busy 只属于 immersive；natural / ai 不得进入、恢复或补发 Busy Return，模型若输出「等我/稍后回来」只允许走身份 repair。用户主动 Stop 时不得为修复额外发模型请求，若 partial 已越过身份边界则不落该 assistant partial。上传/合并/去重链路不许改，分条与显示顺序不许改。
- Memory：展示层、召回与注入可改；隔离规则不许动——「关于我」是全局 explicit、聊天中说的只属当前角色、绝不互相注入。
- Event：独立对象、按 sessionId 隔离、软删、走全量同步——这四点不变；识别必须「共同主体 + 已发生动作」双命中，未来时间硬拒；每 session 每本地日最多 3 次 LLM 精判；不许从 Memory 聚类生成，不许从旧数据回填。
- Session / Role：数据按 sessionId 隔离；「关于我」是全局 explicit（所有角色共享），聊天中记下的内容只属于当前角色，绝不互相注入；切换角色只覆写 persona，聊天记录与记忆绝不动。
- Anniversary：按会话隔离，默认「认识 TA 的日子」，可增删改、可设首页展示；不许改成本地全局单例。
- 展示层（Home / TaOrb / HomeScene / Space 场景）：可改。首页场景图仍只按 `/home-scenes/{morning|day|night}.webp` 取，不许改路径与文件名，缺图用 gradient fallback。新增场景素材走新目录、只许本地打包：不许网络图片、不许生成占位图充数、单张建议 ≤300KB、优先 webp，且不许覆盖 A 级里的既有文件。

---

## 五、分支与合并规则

所有代码与文档改动一律走 分支 + PR，等 CI 绿了再合并。main 有 required status check「verify」，**直推会被仓库规则直接拒**。

以下三类可以**免人工审查**（仍须走分支 + PR + CI 绿）：

1. 纯静态资产原样新增（如 public/home-scenes/*.webp），commit message 由任务方指定；
2. 纯文档新增或更新（README / ROADMAP / AGENTS.md / *.md）；
3. 版本号、注释、拼写类零行为改动。

除此之外的所有改动，必须经项目方审查后合并。

---

## 六、必须新分支 / PR

1. 任何 src/ 下的功能改动、修 bug、改样式逻辑；
2. 任何涉及 Chat / Memory / Event / Session / Role / Anniversary / Sync 的改动；
3. 任何新增或删除文件；
4. 任何触碰用户可见文案的改动；
5. 任何 C 级拆分任务（一个文件一个 PR）；
6. 任何新增依赖的改动（见第十一节）。

分支命名建议 `fix/xxx`、`feat/xxx`、`codex/xxx`、`refactor/split-xxx`。
PR 描述必须写：改了什么、动了哪几个文件、跑了哪些测试、有没有遗留。

---

## 七、自动 commit / push 权限

- 允许：在指定分支上提交并推送自己的分支、开 PR。
- 不允许：直接 push main；替别人合并 PR；未确认就部署。

合并 main 与部署必须由项目方执行。

---

## 八、force push / rebase / reset

- main 上一律禁止 force push、rebase、reset。
- 其它分支允许 rebase 自己的提交，但禁止 force push 已被用来开 PR 且有人在看的分支。
- 要回退 main 上的错误改动，只允许 revert 新提交，不许改写历史。

---

## 九、推 main 前必须跑的测试

1. `npm test` 必须全绿。基线以 main 上 `npm test` 的实际输出为准，**不写死具体数字**。
2. 仓库已挂 GitHub Actions CI（push 自动跑 test / lint / build）；main 有 required status check「verify」。所有改动一律走「分支 + PR + 等 CI 绿 + 合并」。
3. 按改动模块额外跑对应脚本：
   - 改 Event：`node scripts/test_event_detector.mjs`、`test_event_store.mjs`、`test_event_e3.mjs`
   - 改记忆：`node scripts/test_memory_recall.mjs`、`test_memory_recency.mjs`、`test_memory_saved.mjs`、`test_memory_summary.mjs`、`test_memorywall.mjs`
   - 改人设/注入：`node scripts/test_persona_memory_fix.mjs`、`test_fabricated.mjs`、`test_your_moment.mjs`、`test_aiBusy.mjs`
   - 改纪念日：`node scripts/test_anniversary.mjs`
   - 改会话/角色：`node --test src/lib/*.test.ts`（npm test 只跑 scripts/test_*.mjs，不覆盖这一支）+ `scripts/test_session*.mjs`
4. 涉及后端接口的，跑 backend 对应的既有测试脚本。
5. C 级拆分任务：npm test 全绿 + 390 宽 iPhone 视图 runtime 检查；CSS 拆分另加 computed style 比对。

测试不通过，不许提 PR。

---

## 十、验收最低要求

- build：`npm run build` 必须成功，涉及资产时确认构建产物中包含对应文件。
- test：见第九节。
- diff：逐文件核对 diff，确认没有顺手改动；文案类逐字比对红线；C 级拆分 diff 必须是「原文件删块 + 新增文件」形态。
- runtime：上线前必须在真头浏览器里以 390 宽 iPhone 视图走完相关流程，确认 0 pageerror、0 console error、无横向溢出。
- CSS 拆分：拆分前后关键元素 computed style 数值一致。
- 视觉与 UI 类：附设计稿并排截图、素材来源与尺寸、动效自查（见第二节第 4 条）。
- 后端接口改动：交付说明必须带前后字段对照表，前端同步改到位才算过。
- 顺手修的小 bug：PR 描述里必须有「顺手修」小节，逐条写清现象、原因、改了哪一行（见第十二节）。
- 部署前后必须比对：线上静态资源与本地构建产物 md5 完全一致（JS、CSS、图片都比）。

任何一项没过，不许报「完成」。

---

## 十一、依赖准入（替代原来的「一律不许加依赖」）

**允许新增依赖，但必须走准入评估，一次一个，不许 AI 自己挑。**

准入流程：

1. 先给候选（不超过 3 个），写清：用途、为什么现有手段做不到、gzip 后体积、许可证、最近维护时间、会不会接触用户数据或 localStorage。
2. 体积门槛：单个依赖 gzip 后 ≤30KB；超过要项目方单独同意。
3. 必须满足：纯 JS（无原生编译依赖）、许可证允许商用、近 12 个月有维护。
4. 不许引入：重 3D 引擎（three.js 之类）、任何会收集/上报数据的 SDK、来源不明或近一年无维护的包。
5. 加完必须：在 PR 描述里记一笔（包名 + 版本 + 体积 + 用途），并跑 `npm run build` 确认包体变化在预期内。
6. 升级现有依赖走同一套流程。

---

## 十二、其他禁令

- 不许大重构，不许为了架构更漂亮去改已经正常工作的模块（C 级受控拆分除外，且拆分有终点）。
- **顺手发现的小 bug 可以顺手修**，但必须：①在 PR 描述里固定写一节「顺手修」，逐条列出（现象 + 原因 + 文件:行）；②不影响数据、登录、聊天与同步；③不扩大范围。属于数据丢失 / 崩溃 / 登录异常 / 同步错乱的，一律只记录不修，立刻单独报告。
- ★ 审查纪律：项目方审查时专门扫「顺手修」这一节。没有这一节却出现了任务外改动，视为违规，直接退回。
- 不许顺手改文案、不许顺手调样式。
- 不许改已有目录结构、不许重命名现有文件（C 级拆分任务书里写明的新文件除外；新功能新增素材可以开新目录）。
- 不许用 emoji 当图标（全站图标用极简线条 SVG）。
- 用户可见文案指代陪伴对象一律用「TA」，禁止把 TA 泛称为「它」。只有在明确解释身份模式差异时可使用「AI」「AI 本体」等身份名称；既有功能名「AI 工作台」「我的 AI」同样保留。
- 用户可见文案禁出现「干活」二字。
- 不许出现「总结 / 画像 / 分析 / 数据 / 标签」这类后台味词。
- 不许把用户 key、聊天内容、通话记录、隐私信息提交到仓库或发给任何外部服务。
- 不许动 gh-pages 分支（历史遗留，已弃用）。
- 不许把 Memory / Event / Anniversary / FutureIntent 四套数据混用或互相生成。

---

## 十三、任务外 bug 怎么办

按第十二节执行：小 bug 可顺手修（必须单列），以下情况只记录、不修改，立刻报告：

1. 数据丢失、崩溃、登录异常、同步错乱；
2. 需要改 A 级文件才能修的问题；
3. 影响范围说不清、拿不准的问题。

---

## 十四、部署与交付纪律

- AI 编码助手不得自行部署。部署由项目方执行。
- 编码助手交付前必须完成本规范规定的 build、test、diff 和 runtime 验收；如涉及静态资产，应确认构建产物包含对应文件。
- 具体服务器路径、服务管理与部署命令不记录在公开仓库；编码助手的任务范围止于「代码提交 + PR + 交付说明」。
- 交付说明里应写清：改了哪些文件、跑了哪些测试、验收结果、有没有任务外发现、有没有新增依赖。
- 项目方部署后需要满足的最低线上标准：
  - 正式站返回 200
  - 线上静态资源与本地构建产物逐字节一致（md5 比对，JS / CSS / 图片都要比）
  - 浏览器 runtime 检查：0 pageerror、0 console error、无横向溢出
  - 涉及后端接口的改动，需确认后端健康检查接口正常

---

## 十五、安全基线与仓库信息

- 每次新任务开始前必须先 `git fetch`，以当时最新的 origin/main 为实际安全基线；不得把历史 commit 当成当前 main 使用。
- 代码仓库：github.com/77odk/ai-companion，main 分支，git 根位于前端项目子目录。
- 线上公开服务地址：前端 https://eluvin.space ；后端 API https://api.eluvin.space 。
- 后端服务代码不在本仓库内，由项目方维护，AI 编码助手不得访问、修改或部署后端。
- 服务器路径、服务管理方式、部署命令等运维细节不记录在公开仓库。

---

## 十六、其它项目级红线

- 产品主线是单角色，多角色是进阶能力（入口在「我的 → 角色管理」），不要再往主界面加多角色入口；多角色的最终形态是「同一个 TA 的多条故事线」，不是多个 TA。
- 能力长在人格上，不做「干活入口」式的独立工具页。工作台已拍板：它是「TA 能接触什么能力的地方」（能力清单 + 接入口 + 每项的授权状态），排在最末，动手前仍需当轮任务书。
- 聊天体验是命根子，任何改动不能牺牲对话连贯与记忆准确。
- 记不住宁可空着，不许编造共同经历、不许造假数据填满界面。
- 缺资源宁可降级（gradient fallback），绝不引入网络图片。
- 文案两轨制：门面/营销要有调性有意境，教程/功能说明要极简直给。
- 不确定就停：任何红线拿不准，先问，别凭感觉做。
