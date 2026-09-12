# Eluvin UI 2.0 · 前置评审（只读，不改代码）

事实源：`origin/main` = `31f15eba`（TA-RUNTIME-V1 合并后）。
评审方式：只读代码审计，未改任何文件、未建分支、未提交、未部署。
红线基准：`AGENTS.md`（v1，公开安全版）。

---

# 第一部分 · 地形审计

## A. 四个一级 Tab 组件树

路由：`App.tsx` 没有 router，单个 `useState<View>`（14 个 view）。`isNavView` 决定底部导航常显（home / chat / aispace / settings / memory），`navTabActive` 决定高亮。

TA（view=home）→ `Home.tsx`(126)
- `HomeScene`（`.home-page.home-scene-{morning|day|night}` > `.home-scene-overlay` + children）
  - `.home-inner`：`.home-brand` / `.home-time` / `HomeAnniversary` / `.home-companion`（h2「X 此刻」+ p + `TaOrb` + `.home-talk`）/ `.home-shortcuts`
- 数据：getFirstSeen / computeDaysKnown / pickHomeBigDay / getMilestoneProgress / loadCurrentPosts / getOrAdvanceTaRuntime / getBusyState / getSessionLang

TA 聊天（view=chat）→ `Chat.tsx`(1093) + `.app-header`；内部 `MessageBubble`、空态、输入区

空间（view=aispace）→ `AISpace.tsx`(553, Protected)
- `renderHomePage`：周记 → `renderPhotoWall` → 重要的日子 → `renderSharedTimeline` → 底部注脚
- 子页：`page='events'` / `page='weekly'`（复用 WeeklyPage）
- 另有 view='spacelife' → `SpaceLife.tsx`（从 Home 快捷入口进，属 TA tab 高亮）

记忆（view=memory）→ `Memory.tsx`(264)
- river：`memory-hero` + `memory-river`（年 → 月 → 条）
- detail：`memory-local-bar` + `memory-detail-sheet`（+ 来源 quote + 读成记忆书）
- book：`memory-book`（‹N/M› 翻页）

我的（view=settings）→ `Settings.tsx`(1060)
- main：ProfileGroup ×5（TA / 记忆 / 我们 / 其他 / 关于忆文）
- 子页：appearance / provider / work / anniversary / account
- 独立 view：aboutme / roles / chatprofile / weekly / guide

## B. App Shell / Bottom Nav

- `.app`：flex column，height 100dvh，max-width var(--max-width)=480px，居中
- `.app-header`：view!=='home' 才渲染，position:relative（非 sticky）
- `.app-main`：flex:1，min-height:0（内部滚动）
- `.app-nav`：flex-shrink:0，border-top，padding 6px 8px calc(6px + env(safe-area-inset-bottom))，gap 8px；已有 z-index:10 + 半透明 card + backdrop-filter blur(18px) + @supports 兜底
- 内容避让靠 flex 布局，不是 fixed + padding-bottom → 不存在各页各自补 bottom padding 的重复规则；独立 env(safe-area-inset-bottom) 仅 4 处（nav、ai-space 子页、部分全屏弹窗、UI2.0 home 页）
- 顶部 safe-area 仅 1 处（`.home-page` 的 `max(24px, env(safe-area-inset-top))`）
- active state = `.nav-btn.active`（纯 class，无 token）
- 四个一级页共用同一个 shell

## C. index.css 地图（禁改）

8165 行 / 164,692 字节（约 161KB），单文件未拆。

分区（注释行号）：
1 全局 + `:root` / 47 应用外壳 / 185 底部导航 / 213 聊天页 / 615 通用页面（设置 + 记忆共用）/ 1039 旧记忆页 / 1575 纪念日 / 2064 首页（旧）/ 2273 工作台 / 2514 欢迎页 / 2615 AI 空间 / 2990 TA 详情页 / 4125 我的页 / 4435 使用指南 / 4589 选角色 / 4755 自定义角色弹窗 / 4867 登录墙 / 4998 换个 TA 弹窗 / 5109 崩溃兜底 / 5173 全屏角色列表 / 5528 周记页 / 5940 里程碑卡 / 6011 关于我 / 6646 TA 的生活动态 / 6846 外观子页 / 7018 思考链 / 7071 独立 Memory（记忆长河 + 记忆书）/ 7556 批一批导航返回 / 7637 首页纪念日区 / 7809 UI 2.0 沉浸首页 / 7917 时间轴 / 7982 Event E3 / 8066 角色管理独立页 / 8150 HOME-BIG-DAY-V2 / 8159 SPACE-DAYS-V2

重复度：border-radius 211 处、`-card` 类 151 处、box-shadow 55 处、backdrop-filter 6 处。
media query 仅 3 个（min-width 640 ×1、prefers-reduced-motion ×2）；无 390px 断点。

- 可以安全覆盖：追加新规则段（7809 之后的 UI 2.0 段层级最新，冲突最少）
- 高度耦合：615–1038（设置 + 记忆共用表单）、2064–2272（老首页，与 7809 两套并存）、2615–3318（`.ai-space-*` 互相引用一大片）
- 一改连坐：`.app-*` / `.page` / `.btn` / `.hint` 等基础类

## D. Theme token 现状

- `ThemeState = {type:'preset'|'custom', presetId?, customColor?}`；5 预设 + `deriveThemeFromPrimary` 派生
- `applyTheme()` 只写 7 个变量：`--color-primary` / `-soft` / `-deep` / `--color-bg` / `--color-card` / `--color-border` / `--color-on-primary`
- 不随主题变：`--color-text`(#3d2c29)、`--color-text-muted`(#9a7d74)（`:root` 写死）；`--radius*` / `--shadow` 也是静态值；无 spacing / typography / blur token
- accent 当前影响：所有 `var(--color-primary*)` 消费点（按钮、标题、nav active、软底、进度、气泡强调）；大面积背景吃 `--color-bg` / `--color-card`（这两个也随主题变）
- 判断：若要「accent 只做光/状态」，现有 7 变量够 accent 用；真正的视觉母版必须新增 token（surface 层级 / text 层级 / 暗场景 / 玻璃 / 间距）

## E–I. 各页可改范围（摘要）

- TA 页：`.home-inner` 五块可纯视觉重排；`HomeScene` / `TaOrb` / `HomeAnniversary` 可保留逻辑只换外观；不可碰 momentText 优先级链、Runtime 推进、milestone 算法。Chat 仅两处挂载点 + 样式层。
- Space：顺序（周记 → 照片墙 → 重要的日子 → 一起经历过）+ 数据源（getWeeklyReviews / photoWall / getSpaceDays / getSharedExperiences）+ 子页路由不动；`AISpace.tsx` 只动 render JSX / class。
- Memory：现有已是年→月→条目 + detail（source quote）+ book；无 topic UI、无编辑/删除/置顶入口；改「年份→月份→连续流/记忆书」不需要数据层变化。
- 我的：UserProfile {nickname, avatar, bio} 已够；四组 + 关于忆文入口全是现成回调；`EntryRow` / `ProfileGroup` 定义在 `Settings.tsx` 内部（未导出，单点使用）。
- 共享 primitive 候选：page header / 返回栏（`DetailHeader` 在 Settings 与 Account 各写一份）、section title（四种写法）、list row、card（151 处）、empty state、icon button、bottom sheet。不宜抽象：Chat 气泡、Home 沉浸块、Memory 记忆流。

## J. Protected / 高风险

- A 可放心纯视觉：`index.css`（追加覆盖）、Home / HomeScene / TaOrb / HomeAnniversary 的 class 与结构、新建展示型组件
- B 可改 markup 不改数据行为：AISpace 展示层、Settings 四组、SpaceLife 动态卡、AboutMe / AnniversaryManager / WeeklyPage 外观
- C Protected：`Chat.tsx`（两处挂载 + 外壳样式）、`Memory.tsx`（展示层）、`AISpace.tsx`（render）、`WeeklyPage`、`memory.ts` / `sessionStore.ts` / `sessionApi.ts` / `sync.ts` / `migrateLocal.ts` / `memoryWall.ts` / `weeklyReview.ts` / `eventStore.ts` / `eventDetector.ts` / `ConsentGate` / `LoginGate` / `auth` / `token` / `consentState`
- D 不该碰：后端目录、`public/` 既有资产（只许原样新增）、key / token、同步协议与 API 路径、`taRuntime.ts` 的推进逻辑

---

# 第二部分 · UI 2.0 可行性评审（A–O）

## A. 总判断

**可实现，但需局部基础改造。**

四个一级页都是薄组件 + lib 数据层，路由是 `useState` 而非框架路由，presentation 与数据边界清楚；Theme 已是 CSS 变量驱动，缺的是变量职责重映射。需要动的基础层只有两块：App Shell / Bottom Nav 透视化（牵动所有贴底元素）、CSS 文件组织方式（161KB 单文件不能再全量改）。其余全部是 presentation。

## B. Theme

**兼容。可以做到「主题数据兼容、视觉职责改变」。**

最小修改点：

1. 新增一组 Material token（canvas / surface / surface-elevated / text / text-secondary / hairline / glass / shadow / nav-material），静态，不进 ThemeState
2. 新增 TA Accent 变量（可映射自 `--color-primary`，或新起 `--accent` 由 applyTheme 同步写），只被 glow / active / 节点 / 进度 / 选中态消费
3. 现有 `--color-primary` / `-soft` / `-deep` 从「大面积填充」降级为「accent 用途」，原染色容器改吃 Material
4. Eluvin Warm（暖橘）作为固定品牌常量保留，只用于 Welcome / Logo / 极少量关系温度

不碰：ThemeState 结构、`deriveThemeFromPrimary`、存储 key、老用户已存 presetId / customColor（`resolveThemeVars` 输出保持原样，只改消费方）。
硬要求：过渡期双轨——老变量继续存在且默认值不变，否则老用户主题整体塌色。

## C. Transparent Nav

现有 flex shell：`.app` → `.app-header` → `.app-main` → `.app-nav`，互不重叠。要「内容延伸到 Nav 后方」，Nav 必须脱离文档流：

1. `.app` 加 `position:relative`；`.app-nav` 改 `position:absolute; left:0; right:0; bottom:0`（不要 sticky——sticky 仍占位）
2. `.app-main` 加 `padding-bottom` = nav 高度 + safe-area，保证内容滚到底不被永久遮住
3. Nav 容器 `pointer-events:none`，内部按钮 `pointer-events:auto`——否则透明区吞点击（最容易翻车的一点）
4. Nav 背景改透明 → surface 的纵向渐变；保留 `env(safe-area-inset-bottom)`；保留 prefers-reduced-motion 分支
5. z-index 统一梳理（Home 沉浸层现在 z-index 10）

最大连坐：Chat 输入区、Space 子页、全屏弹窗等贴底元素。建议批次 1 只做 shell + nav、不改页面内容。

## D. Home

足以 presentation-only 完成。

可纯视觉：`.home-inner` 五块的结构/顺序/文案/class；HomeScene 层级（背景靠 `--home-scene-image` 指 `/home-scenes/{morning|day|night}.webp`，路径不可改）；TaOrb；HomeAnniversary（全 props 驱动）。

必须调整设计才能不触碰逻辑的地方：

- 「TA 此刻」取值链 Busy → Runtime → Space Post → fallback 一个字不能动，视觉上只能改呈现，不能拆成两个元素或加动画条件
- 里程碑进度只吃 progress 一个 0–1 数值，任何「节点分段/刻度」要在前端由一个数换算，不能要求新数据
- 无卡化后文字可读性只能靠 text-shadow / 局部 gradient / 轻微暗化（三张场景图明暗不同），不能大面积磨砂卡、不能新增图片
- 「场景铺到屏幕最底部、Nav 后仍可见」依赖 C，Home 自身不需要改图或层级

## E. Welcome

纯视觉范围：`Welcome.tsx`(52) 全部内容可重做，只依赖 `onStart` / `onGoGuide`。
边界：App 开机判定（BOOT_INTERVAL_MS 6h）、ConsentGate、LoginGate、onStart 后续流程不动。
提醒：现有三个标签「对话 / 长期记忆 / AI 编程」是早先拍板文案，新设计去掉 feature pills 等于删它们——属已拍板文案变更，需产品方确认（口径问题，不是技术问题）。

## F. TA 小空间 / ChatProfile

可改：头部 identity 区排版、`TA 是谁`（现为 `.ai-who-card`）去卡化、三行入口（TA 的生活 / 聊天记录 / 聊天背景）、底部刷新对话区块呈现。

刷新对话现状（真实代码）：入口文案「好像 OOC 了？点击一下一键修复」，二次确认「刷新后聊天框内容清空，聊天记录内仍可查看」，行为 = `setSessionStart`。新文案（「重新开始这段对话」+「只刷新当前对话上下文，聊天记录不会删除」）在这个组件里只是改字符串与 class，行为零改动。

防语义混淆建议：

- Web 更新：固定在页头右上，环形箭头图标，文案只有一个词「更新」，绝不出现在 ChatProfile 内
- 刷新对话：保留页面底部独立区块 + 二次确认 + 明确「聊天记录不会删除」
- 三者（图标 / 位置 / 确认文案）都区分，不靠颜色区分

「我的顶部身份区」与「TA 小空间顶部身份区」可共享视觉 primitive（头像 + 名字 + 一行 meta 的排版骨架），但取值不同源（UserProfile vs ai_profile / session persona），只共享 class 与布局。

## G. Space

**可以，仅 JSX + class + CSS 即可完成。**

约束：`AISpace.tsx` 只动 `renderHomePage` / `renderPhotoWall` / `renderDays` / `renderSharedTimeline` 的 JSX 与 class；顺序、数据源、子页路由不动。空态文案已在（周记 / 照片墙 / 重要的日子 / 一起经历过）。
「极淡环境光」只能用 CSS 渐变，不能把 HomeScene 大图铺到 Space。

## H. Memory

**presentation-only 足够，不需要任何数据架构变化。**

现状已具备：年 → 月 → 条目（`groupMemories`）+ detail（source quote）+ book（‹N/M›）；数据 = `loadMemory().filter(explicit)` + `getMemoriesCache(sid)`，倒序；无 topic UI、无编辑/删除/置顶操作入口。
要做的只是把记忆条从卡感改成「时间轴 + 文字」（CSS 段 7071–7555 自成一区，隔离度最好）。

## I. 我的

顶部身份区数据够用：`UserProfile {nickname, avatar, bio}`（头像可 dataURL，缺失走 DefaultAvatar）+ 现有编辑入口。
四组入口全是现成回调，不需要新数据。
最小统一方案：`ProfileGroup` + `EntryRow`（现定义在 `Settings.tsx` 内部）的 class 体系升级为 UI 2.0 列表层级（去卡、hairline 分隔、留白节奏）；AboutMe / AnniversaryManager / WeeklyPage / Account 各有老样式，按批次跟随，不要求一次统一。

## J. Web 更新按钮

PWA 现状：vite-plugin-pwa，`registerType:'autoUpdate'`，workbox generateSW（globPatterns 含 html/js/css，navigateFallback=index.html），`registerSW({immediate:true})`；已有 `forceRefresh()`（清 Cache Storage + 注销全部 SW + `location.reload()`），当前挂在 Welcome 按钮与顶栏「忆文」连点三下。

结论：普通 reload 在 autoUpdate 下「通常够」，但卡旧版本时不可靠（旧 SW 仍控制页面、index.html 可能命中旧 precache）。
最合理实现：直接复用现有 `forceRefresh()`——cache-aware reload，零新增依赖，不碰 SW 配置与部署逻辑。
明确会涉及 service worker（主动注销 + 清缓存），副作用是下次访问重新注册、短暂失去离线缓存（可接受）。

## K. CSS 落地策略

不新建 Vite 入口，不改构建配置。

建议新增 `src/styles/ui2.css`，在 `main.tsx` 里 `index.css` 之后 import（顺序决定层叠）。ui2.css 只写「新增 token + 覆盖规则」，`index.css` 一行不动。

理由：index.css 已 8165 行 / 161KB，任何一次全量读写都是截断事故入口；新建文件在 git 里是纯新增。

内部按节组织并与批次一一对应：00 material tokens / 01 shell+nav / 02 home / 03 welcome / 04 memory / 05 space / 06 chatprofile / 07 mine。每批只追加自己那一节，便于单独回滚。

提交继续走本地 git（fetch → 分支 → push），不走 GitHub contents API。
禁止为 UI 2.0 重排 index.css 的 615–1038 与 2615–3318 两段（耦合最深）。

## L. Protected（施工期绝不能动）

- `Chat.tsx`（只允许两处挂载 + 样式层）、`AISpace.tsx`（render JSX/class 内）、`Memory.tsx`（展示层）、`WeeklyPage`、`SpaceLife`、`RolesPage` 的数据行为
- lib：`memory.ts` / `sessionStore.ts` / `sessionApi.ts` / `sync.ts` / `migrateLocal.ts` / `memoryWall.ts` / `weeklyReview.ts` / `eventStore.ts` / `eventDetector.ts` / `taRuntime.ts`（推进逻辑）/ `aiSpace*.ts` / `anniversary.ts` / `photoWall.ts`
- Auth / Consent：`auth.ts` / `token.ts` / `consentState.ts` / `LoginGate` / `ConsentGate` / `LoginForm` / `Account` 的业务逻辑
- `theme.ts` 只允许改 `applyTheme` 的变量映射，不允许改 ThemeState 结构、派生算法、存储 key
- 后端、`public/` 既有资产（含三张 home-scenes）、API 路径与同步协议

## M. 分批（最小 + 依赖）

1. token 层 + `ui2.css` 骨架 + App Shell / Nav 透视化（无依赖）→ 全站回归一次
2. Home 2.0（依赖 1）
3. Welcome 2.0 + Web 更新按钮铺到四个一级页（依赖 1，可与 2 并行）
4. Memory 2.0（依赖 1）
5. Space 2.0（依赖 1）
6. ChatProfile / TA 小空间 2.0（依赖 1）
7. 我的 2.0 + 子页列表逐步跟随（依赖 1）
8. 收尾：共享 primitive（DetailHeader / section title / entry row / empty state）+ 全站 390px 回归（依赖 2–7）

每批结束固定跑：`npm test` + `build` + 线上产物与本地 md5 逐字节比对 + 390px 的 overflow / pageerror / console error 三项归零。

## N. 风险

高
- Nav 透视化牵动所有贴底元素（Chat 输入区、Space 子页、全屏弹窗）→ 内容被压 / 点击被吞；Chat 是产品命根子
- index.css 161KB 单文件，任何非追加式编辑都有截断/冲突风险
- Chat 改动影响面最大，视觉误伤直接掉聊天体验

中
- Theme 职责重映射影响所有 `--color-primary*` 消费点，必须双轨过渡
- Home 去卡化后文字可读性依赖三张场景图明暗，浅场景需单独调
- Nav 渐变与 Home 场景在底部的连续性需要精确配合

低
- Welcome 删标签属已拍板文案变更，需产品方确认
- Web 更新按钮会短暂清掉离线缓存
- 新增动效需沿用现有 prefers-reduced-motion 分支

## O. 最终三问

1. **能在不改变核心数据架构的前提下完成。**
2. **不需要新增任何运行时图片或人物生成能力**；三张 scene + 真实用户照片 + 头像 + CSS 足够。
3. **建议进入施工**，但先冻结视觉母版（token 表 + 各页线框），且批次 1（token + shell）单独跑一轮、验证通过再往下。
