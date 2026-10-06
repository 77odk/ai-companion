# 忆文 Eluvin · AI 编码助手红线与提交规范

版本 v2（公开安全版，2026-10-06 按《方向定论清单 v6》调整保护分级）
适用范围：豆包 / Codex / Claude / 任何外部或内部 AI 编码助手在本仓库工作时的强制规范。
★ 与 v1 的差别：不再把「空间页 / 记忆 / 聊天 / 同步」整类文件当成绝对禁区，改成 A 级（任何情况不许动）与 B 级（可按当轮已拍板清单改，一次一批、先说范围）。原先收紧的条款一条没删，只是把「按批次授权可动」的部分单独列出来。

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
- npm 依赖清单（不许新增或升级依赖）

### B 级：可按当轮已拍板清单改，一次一批、先说范围

- src/lib/memory.ts（记忆读写与数据结构）：结构与隔离规则不变，注入 / 召回 / 展示相关可按清单改
- src/lib/memoryWall.ts、src/lib/sessionStore.ts（仅新增字段与展示；上传 / 合并 / 去重链路仍按 A 级禁改）
- src/lib/sync.ts（只在现有 Cloud State kind 体系内注册新 kind，不许开第二套同步接口）
- src/lib/sessionApi.ts（后端接口封装；401 触发 logout 的行为不许改）
- src/lib/migrateLocal.ts（老数据迁移：只许加兼容分支，不许改既有迁移语义）
- src/lib/weeklyReview.ts、src/lib/eventStore.ts、src/lib/eventDetector.ts（Event 与周记）
- src/components/AISpace.tsx（空间页）
- src/components/Chat.tsx（聊天页，允许的挂载点见第四节）
- public/ 下【新增】的场景 / 素材文件（只许本地打包，不许网络图片）

---

## 二、可以改，但必须先满足前置条件

1. 先读现状：改任何模块前，先读该模块代码与它引用的数据层，说清现状再动手。
2. 先说范围：写清要改哪几个文件、为什么、影响什么，确认后再改。
3. 一次一件事：拆小批量，跑完一批验收一批，绝不并行开多个改造。
4. 视觉类改动：先定结构（块、顺序、交互、文案），视觉稿确认后再写代码。
5. 文案类改动：逐字对照第十一节与第十五节红线。
6. 涉及记忆、聊天记录、同步的改动：额外跑对应测试脚本，并在交付说明里列出跑过的测试名。

---

## 三、数据结构 / storage key / API / 同步红线

1. 不许改 MemoryItem 字段定义，不许加必填字段，不许改旧字段语义。
2. 不许新增 localStorage key 去绕开现有数据层。现有前缀统一 `ai_companion_`，关键的有：
   - `ai_companion_account`
   - `ai_companion_active_session_id`
   - `ai_companion_sessions_cache`
   - `ai_companion_memory`（全局 explicit 记忆）
   - `ai_companion_mem_<sessionId>`（会话记忆）
   - `ai_companion_msgs_<sessionId>`（会话消息）
   - `ai_companion_settings` / `ai_companion_persona` / `ai_companion_user_profile` / `ai_companion_ai_profile` / `ai_companion_theme` / `ai_companion_events` / `ai_companion_anniversaries_<sessionId>` / `ai_companion_photos`
3. 不许改后端 API 路径、请求体字段名、响应结构；不许新增后端表；不许开第二套同步接口。
4. 同步只走现有同步通道（当前主路径是 Cloud State 的 `/api/state/pull|push` 增量；老的 `/api/sync` 全量 blob 仍在兼容）；新数据要同步就注册成现有 kind，不许开第二套同步接口。
5. 不许删减、裁剪、清空任何用户聊天记录。「刷新对话」只清当前上下文，历史一条不少。
6. 不许把用户模型 key 上传服务器；所有 AI 调用在用户浏览器里用用户自己的 key。
7. 不许加游客直进聊天（登录墙必须在前），不许绕过 ConsentGate 的同意与年龄门。

---

## 四、各模块保护边界

> 本节的「允许动」都以「当轮任务书 + 已拍板清单」为前提；清单没写的一律不动，拿不准先问。

- Chat：允许动「Event 候选识别挂载」「记忆注入旁挂载」，以及「身份边界护栏」的限定薄挂载：身份模式可决定 Space 是否作为 SELF 事实注入、Busy 是否允许进入/恢复/Return，以及 finalization/retry 最终落库前的 detector + 一次 repair retry + 安全 fallback。**真人 Busy 只属于 immersive**；natural / ai 不得进入、恢复或补发 Busy Return，模型若输出“等我/稍后回来”只允许走身份 repair。用户主动 Stop 时不得为修复额外发模型请求，若 partial 已越过身份边界则不落该 assistant partial。上传/合并/去重链路不许改，分条与显示顺序不许改。
- Memory：展示层、召回与注入（按当轮清单：手动存记忆、回滚 / 审计留痕、关键词激活、承诺建档）可改；**隔离规则不许动**——「关于我」是全局 explicit、聊天中说的只属当前角色、绝不互相注入。
- Event：独立对象、按 sessionId 隔离、软删、走全量同步——这四点不变；识别必须「共同主体 + 已发生动作」双命中，未来时间硬拒；每 session 每本地日最多 3 次 LLM 精判；不许从 Memory 聚类生成，不许从旧数据回填。
- Session / Role：数据按 sessionId 隔离；「关于我」是全局 explicit（所有角色共享），聊天中记下的内容只属于当前角色，绝不互相注入；切换角色只覆写 persona，聊天记录与记忆绝不动。
- Anniversary：按会话隔离，默认「认识 TA 的日子」，可增删改、可设首页展示；不许改成本地全局单例。
- 展示层（Home / TaOrb / HomeScene / Space 场景）：可改。首页场景图仍只按 `/home-scenes/{morning|day|night}.webp` 取，不许改路径与文件名，缺图用 gradient fallback。新增场景素材（如空间页书桌）走新目录、只许本地打包：不许网络图片、不许生成占位图充数、单张建议 ≤300KB、优先 webp，且不许覆盖 A 级里的既有文件。

---

## 五、允许直接推 main

只有这三类可不经 PR 直推 main：

1. 纯静态资产原样新增（如 public/home-scenes/*.webp），commit message 由任务方指定；
2. 纯文档新增或更新（README / ROADMAP / *.md）；
3. 版本号、注释、拼写类零行为改动。

除此之外，所有代码改动一律走分支 + PR。

---

## 六、必须新分支 / PR

1. 任何 src/ 下的功能改动、修 bug、改样式逻辑；
2. 任何涉及 Chat / Memory / Event / Session / Role / Anniversary / Sync 的改动；
3. 任何新增或删除文件；
4. 任何触碰用户可见文案的改动。

分支命名建议 `fix/xxx`、`feat/xxx`、`codex/xxx`。PR 描述必须写：改了什么、动了哪几个文件、跑了哪些测试、有没有遗留。

---

## 七、自动 commit / push 权限

- 允许：在指定分支上提交并推送自己的分支、开 PR。
- 不允许：直接 push main（除第五节三类）；替别人合并 PR；未确认就部署。

合并 main 与部署必须由项目方执行。

---

## 八、force push / rebase / reset

- main 上一律禁止 force push、rebase、reset。
- 其它分支允许 rebase 自己的提交，但禁止 force push 已被用来开 PR 且有人在看的分支。
- 要回退 main 上的错误改动，只允许 revert 新提交，不许改写历史。

---

## 九、推 main 前必须跑的测试

1. `npm test`，必须全绿（当前基线：248 通过、0 失败）。★ 仓库已挂 GitHub Actions CI（push 自动跑 test / lint / build）；main 有 required status check「verify」，因此所有改动一律走「分支 + PR + 等 CI 绿 + 合并」，不许直推 main。
2. 按改动模块额外跑对应脚本：
   - 改 Event：`node scripts/test_event_detector.mjs`、`test_event_store.mjs`、`test_event_e3.mjs`
   - 改记忆：`node scripts/test_memory_recall.mjs`、`test_memory_recency.mjs`、`test_memory_saved.mjs`、`test_memory_summary.mjs`、`test_memorywall.mjs`
   - 改人设/注入：`node scripts/test_persona_memory_fix.mjs`、`test_fabricated.mjs`、`test_your_moment.mjs`、`test_aiBusy.mjs`
   - 改纪念日：`node scripts/test_anniversary.mjs`
   - 改会话/角色：`node --test src/lib/*.test.ts`（npm test 只跑 scripts/test_*.mjs，不覆盖这一支）+ `scripts/test_session*.mjs`
3. 涉及后端接口的，跑 backend 对应的既有测试脚本。

测试不通过，不许提 PR。

---

## 十、验收最低要求

- build：`npm run build` 必须成功，涉及资产时确认构建产物中包含对应文件。
- test：见第九节。
- diff：逐文件核对 diff，确认没有顺手改动；文案类逐字比对红线。
- runtime：上线前必须在无头浏览器里以 390 宽 iPhone 视图走完相关流程，确认 0 pageerror、0 console error、无横向溢出。
- 部署前后必须比对：线上静态资源与本地构建产物 md5 完全一致（JS、CSS、图片都比）。

任何一项没过，不许报「完成」。

---

## 十一、其他禁令

- 不许新增或升级任何 npm 依赖。
- 不许大重构，不许为了架构更漂亮去改已经正常工作的模块。
- 不许顺手修任务外 bug、不许顺手改文案、不许顺手调样式。
- 不许改目录结构、不许重命名现有文件。
- 不许用 emoji 当图标（全站图标用极简线条 SVG）。
- 用户可见文案指代陪伴对象一律用「TA」，禁止把 TA 泛称为「它」。只有在明确解释身份模式差异时可使用「AI」「AI 本体」等身份名称；既有功能名「AI 工作台」「我的 AI」同样保留。
- 用户可见文案禁出现「干活」二字。
- 不许出现「总结 / 画像 / 分析 / 数据 / 标签」这类后台味词。
- 不许把用户 key、聊天内容、通话记录、隐私信息提交到仓库或发给任何外部服务。
- 不许动 gh-pages 分支（历史遗留，已弃用）。
- 不许把 Memory / Event / Anniversary / FutureIntent 四套数据混用或互相生成。

---

## 十二、任务外 bug 怎么办

只记录，不修改：

1. 在 PR 描述或交付说明里单开一节「任务外发现」，写清现象、复现路径、涉及文件；
2. 不许顺手修，不许扩大 scope；
3. 严重问题（数据丢失、崩溃、登录异常）立刻停下单独报告，等指令。

---

## 十三、部署与交付纪律

- AI 编码助手不得自行部署。部署由项目方执行。
- 编码助手交付前必须完成本规范规定的 build、test、diff 和 runtime 验收；如涉及静态资产，应确认构建产物包含对应文件。
- 具体服务器路径、服务管理与部署命令不记录在公开仓库；编码助手的任务范围止于「代码提交 + PR + 交付说明」。
- 交付说明里应写清：改了哪些文件、跑了哪些测试、验收结果、有没有任务外发现。
- 项目方部署后需要满足的最低线上标准（由项目方执行或作为交付要求）：
  - 正式站返回 200
  - 线上静态资源与本地构建产物逐字节一致（md5 比对，JS / CSS / 图片都要比）
  - 浏览器 runtime 检查：0 pageerror、0 console error、无横向溢出
  - 涉及后端接口的改动，需确认后端健康检查接口正常

---

## 十四、安全基线与仓库信息

- 本文档建立时的参考基线：main = `ae44308b`（2026-09-12，feat: add official home scene assets）。
- 重要：该 commit 只是建立文档时的参考，不是永久的最新 main。每次新任务开始前必须先 `git fetch`，并以当时最新的 `origin/main` 为实际安全基线；不得把本文档记录的历史 commit 当成当前 main 使用。
- 代码仓库：github.com/77odk/ai-companion，main 分支，git 根位于前端项目子目录。
- 线上公开服务地址：前端 https://eluvin.space ；后端 API https://api.eluvin.space 。
- 后端服务代码不在本仓库内，由项目方维护，AI 编码助手不得访问、修改或部署后端。
- 服务器路径、服务管理方式、部署命令等运维细节不记录在公开仓库。

---

## 十五、其它项目级红线

- 产品主线是单角色，多角色是进阶能力（入口在「我的 → 角色管理」），不要再往主界面加多角色入口；多角色的最终形态是「同一个 TA 的多条故事线」，不是多个 TA。
- 能力长在人格上，不做「干活入口」式的独立工具页。工作台已拍板：它是「TA 能接触什么能力的地方」（能力清单 + 接入口 + 每项的授权状态），排在最末，动手前仍需当轮任务书。
- 聊天体验是命根子，任何改动不能牺牲对话连贯与记忆准确。
- 记不住宁可空着，不许编造共同经历、不许造假数据填满界面。
- 缺资源宁可降级（gradient fallback），绝不引入网络图片。
- 文案两轨制：门面/营销要有调性有意境，教程/功能说明要极简直给。
- 不确定就停：任何红线拿不准，先问，别凭感觉做。
