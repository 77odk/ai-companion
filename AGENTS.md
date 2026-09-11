# 忆文 Eluvin · AI 编码助手红线与提交规范

版本 v1，文档建立时的参考基线 main = ae44308b（2026-09-12）
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

## 一、绝对不能动的文件 / 模块

- src/lib/memory.ts（记忆读写与数据结构）
- src/lib/sessionStore.ts（会话数据层）
- src/lib/sessionApi.ts（后端接口封装，401 会触发 logout）
- src/lib/sync.ts（同步协议与 account/token 存储）
- src/lib/migrateLocal.ts（老数据迁移）
- src/lib/memoryWall.ts（记忆墙只读映射）
- src/lib/weeklyReview.ts（周记）
- src/lib/eventStore.ts 与 src/lib/eventDetector.ts（Event 数据层与识别）
- src/components/AISpace.tsx（空间页）
- src/components/Chat.tsx（聊天页，只有明确列出的挂载点允许改，见第四节）
- src/components/ConsentGate.tsx、src/components/LoginGate.tsx（合规与登录墙）
- src/lib/consentState.ts、src/lib/auth.ts、src/lib/token.ts（登录态与同意版本）
- Event 相关文件整体
- public/ 下已有的图片资产（不许重新生成、裁切、压缩、改色、改尺寸，只许原样新增）
- backend/ 整个目录、backend/data.db、任何 .env / key / token 文件、systemd unit

---

## 二、可以改，但必须先满足前置条件

1. 先读现状：改任何模块前，先读该模块代码与它引用的数据层，说清现状再动手。
2. 先说范围：写清要改哪几个文件、为什么、影响什么，确认后再改。
3. 一次一件事：拆小批量，跑完一批验收一批，绝不并行开多个改造。
4. 视觉类改动：先定结构（块、顺序、交互、文案），视觉稿确认后再写代码。
5. 文案类改动：逐字对照第七节与第十一节红线。
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
4. 同步只走现有 `/api/sync` 全量 blob；新数据要同步就并进这个 blob。
5. 不许删减、裁剪、清空任何用户聊天记录。「刷新对话」只清当前上下文，历史一条不少。
6. 不许把用户模型 key 上传服务器；所有 AI 调用在用户浏览器里用用户自己的 key。
7. 不许加游客直进聊天（登录墙必须在前），不许绕过 ConsentGate 的同意与年龄门。

---

## 四、各模块保护边界

- Chat：只允许动「Event 候选识别挂载」和「记忆注入旁挂载」两处；上传/合并/去重链路不许改；分条与显示顺序不许改。
- Memory：展示层可改；注入逻辑、隔离规则、生成逻辑不许改。
- Event：独立对象、按 sessionId 隔离、软删、走全量同步——这四点不变；识别必须「共同主体 + 已发生动作」双命中，未来时间硬拒；每 session 每本地日最多 3 次 LLM 精判；不许从 Memory 聚类生成，不许从旧数据回填。
- Session / Role：数据按 sessionId 隔离；「关于我」是全局 explicit（所有角色共享），聊天中记下的内容只属于当前角色，绝不互相注入；切换角色只覆写 persona，聊天记录与记忆绝不动。
- Anniversary：按会话隔离，默认「认识 TA 的日子」，可增删改、可设首页展示；不许改成本地全局单例。
- 展示层（Home / TaOrb / HomeScene）：可改，但场景图只按 `/home-scenes/{morning|day|night}.webp` 取，不许改路径与文件名，缺图用 gradient fallback，不许引入网络图片或生成占位图。

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

1. `npm test`，必须全绿（当前基线：49 通过、0 失败）。
2. 按改动模块额外跑对应脚本：
   - 改 Event：`node scripts/test_event_detector.mjs`、`test_event_store.mjs`、`test_event_e3.mjs`
   - 改记忆：`node scripts/test_memory_recall.mjs`、`test_memory_recency.mjs`、`test_memory_saved.mjs`、`test_memory_summary.mjs`、`test_memorywall.mjs`
   - 改人设/注入：`node scripts/test_persona_memory_fix.mjs`、`test_fabricated.mjs`、`test_your_moment.mjs`、`test_aiBusy.mjs`
   - 改纪念日：`node scripts/test_anniversary.mjs`
   - 改会话/角色：src/lib/*.test.ts（npm test 覆盖）+ `scripts/test_session*.mjs`
3. 涉及后端接口的，跑 backend/ 下对应测试（test_consent_api.mjs 等）。

测试不通过，不许提 PR。

---

## 十、验收最低要求

- build：`npm run build` 必须成功，涉及资产时确认 dist 下有对应文件。
- test：见第九节。
- diff：逐文件核对 diff，确认没有顺手改动；文案类逐字比对红线。
- runtime：上线前必须在无头浏览器里以 390 宽 iPhone 视图走完相关流程，确认 0 pageerror、0 console error、无横向溢出。
- 部署前后必须比对：本地 dist 与线上同名文件 md5 完全一致（JS、CSS、图片都比）。

任何一项没过，不许报「完成」。

---

## 十一、其他禁令

- 不许新增或升级任何 npm 依赖。
- 不许大重构，不许为了架构更漂亮去改已经正常工作的模块。
- 不许顺手修任务外 bug、不许顺手改文案、不许顺手调样式。
- 不许改目录结构、不许重命名现有文件。
- 不许用 emoji 当图标（全站图标用极简线条 SVG）。
- 用户可见文案指代 AI 一律用「TA」，禁止「AI」「它」（功能名「AI 工作台」「我的 AI」除外）。
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

## 十三、部署前后检查清单

部署前：

- `npm test` 全绿
- `npm run build` 成功，确认 dist 产物清单

部署：

```
cd frontend
rm -rf ~/yiwem-web/assets ~/yiwem-web/home-scenes && cp -r dist/* ~/yiwem-web/
```

部署后：

- `systemctl is-active yiwem-web.service`（须 active）
- `systemctl is-active eluvin-tunnel`（须 active）
- `curl -s -o /dev/null -w "%{http_code}" https://eluvin.space/`（须 200）
- 线上 /assets 下 JS、CSS 的 md5 与本地逐字节一致
- 有图片资产时 `/home-scenes/*.webp` 三个路径都 200 且 md5 一致
- 浏览器 runtime 检查：0 pageerror、0 console error
- 后端改动还要 `systemctl is-active yiwem-backend` + `curl https://api.eluvin.space/api/health`

---

## 十四、安全基线

- 本文档建立时的参考基线：main = `ae44308b`（feat: add official home scene assets，2026-09-12）。
- 重要：这个 commit 只是建立文档时的参考，不是永久的最新 main。每次新任务开始前必须先 `git fetch`，并以当时最新的 `origin/main` 为实际安全基线；不得把本文档记录的历史 commit 当成当前 main 使用。
- 线上前端：https://eluvin.space（静态，~/yiwem-web，yiwem-web.service + eluvin-tunnel）
- 线上后端：https://api.eluvin.space（yiwem-backend 本机 8787；后端不在 GitHub 仓库，只有项目方可改）
- 代码仓库：github.com/77odk/ai-companion，main 分支，git 根在 frontend/ 子目录

---

## 十五、其它项目级红线

- 产品主线是单角色，多角色是进阶能力（入口在「我的 → 角色管理」），不要再往主界面加多角色入口。
- 能力长在人格上，不做独立的工具/工作台干活入口。
- 聊天体验是命根子，任何改动不能牺牲对话连贯与记忆准确。
- 记不住宁可空着，不许编造共同经历、不许造假数据填满界面。
- 缺资源宁可降级（gradient fallback），绝不引入网络图片。
- 文案两轨制：门面/营销要有调性有意境，教程/功能说明要极简直给。
- 不确定就停：任何红线拿不准，先问，别凭感觉做。
