# Eluvin UI 2.0 · 视觉母版 V1（冻结）+ 工程边界

母版作者：GPT。工程边界与验收：乔。
冻结日期：2026-09-12。事实源：`origin/main`。

## 冻结范围（不冻结像素）

冻结：Material / Warm / Accent 的职责划分；四页信息层级；Home 场景优先；连续空间而非卡片堆叠；Transparent Nav；「我 / TA / 我们 / 时间」的视觉关系。

不冻结：`#F7F4EF`、`22px`、`36px`、Nav 渐变强度、blur 数值——允许在 UI2-02 真实 390px 截图后微调一次。token 不是经文，不好看就调。

---

# 一、颜色三层

## A. Eluvin Material（属于忆文，不随用户主题变）

| Token | 默认值 | 用途 |
| --- | --- | --- |
| `--ui2-canvas` | `#F7F4EF` | 非 Home 页基础画布 |
| `--ui2-surface` | `rgba(255,255,255,.58)` | 少量需要承载的轻 surface |
| `--ui2-surface-elevated` | `rgba(255,255,255,.82)` | modal / detail 等真正浮层 |
| `--ui2-text` | `#332B28` | 主文字 |
| `--ui2-text-secondary` | `#817773` | 次级文字 / 日期 / meta |
| `--ui2-hairline` | `rgba(51,43,40,.10)` | 极轻分隔线 |
| `--ui2-glass` | `rgba(248,246,242,.46)` | 必须使用玻璃时 |
| `--ui2-nav-material` | `rgba(247,244,239,.76)` | Nav 底部渐隐终点（不是整块 Nav 背景） |
| `--ui2-shadow` | `0 12px 40px rgba(38,31,28,.08)` | 真浮层阴影 |
| `--ui2-blur` | `16px` | 局部 glass，禁止到处使用 |
| `--ui2-page-x` | `22px` | 手机页水平安全留白 |
| `--ui2-section-gap` | `36px` | 一级 section 节奏 |
| `--ui2-item-gap` | `18px` | 内容项节奏 |

## B. Eluvin Warm（属于品牌，不是用户主题）

`--eluvin-warm: #D8875F` / `--eluvin-warm-soft: rgba(216,135,95,.12)`
只出现在 Welcome、Logo、极少量关系温度。禁止拿它重新铺满按钮 / 卡片 / 导航。

## C. TA Accent（属于这个 TA）

`--ta-accent: var(--color-primary)` / `--ta-accent-soft` / `--ta-accent-deep`
直接吃现有 ThemeState，不迁移数据。只用于：TaOrb glow / Nav active / timeline node / progress / selected / focus / 小状态。

**母规则：Material 属于忆文；Warm 属于品牌；Accent 属于这个 TA。**

---

# 二、四页结构线框（文字版）

## TA（Home 无传统 page canvas，Scene 就是画布）

```
                    ↻
ELUVIN
早安
和 TA 的第 N 天

        ◯ TaOrb
       TA 此刻
      正在……

── 重要的日子 ──────
10.01 · 还有 18 天

和 TA 说说话

最近的生活痕迹…
────────────────────
 TA   空间   记忆   我的   ← morning/day/night 一直延伸到 Nav 后
```

要点：主要内容不套 Card；文字靠位置、阴影、局部渐变获得可读性；TaOrb 是视觉中心，Accent 最明显处；Important Date 是「时间关系」不是白色纪念日卡；Home 最多允许极少量真 surface，不重新玻璃卡化。

## 空间（连续生活页，不是四张功能卡）

```
空间 / 我们留下的生活痕迹

周记        ───────────  本周文字… 继续阅读 →
                            （大留白）
照片墙      [真实照片][真实照片][真实照片]
                            （大留白）
重要的日子   08.17 ── 第一次…
            09.24 ── ……
一起经历过   ● 09.08 一段真实 Event
            ● 08.26 一段真实 Event
```

Section 之间靠 32–40px 留白 + 标题层级 + hairline 分隔，不每块套框。照片墙是唯一自然拥有大面积图片的区域，且只显示真实照片。Accent 只出现在时间节点、当前状态、小链接反馈。

## 记忆（四页里最克制图片与 Card 的一页）

```
记忆 / TA 记得的时间

2026
 SEP
 │
 ●  你说你最近……
 │  9月12日
 │
 ●  你一直很喜欢……
 │  9月08日
 AUG
 ●  ……
```

视觉主体 = 年份 → 月份 → 线 → 节点 → 记忆文字 → 时间 → 留白。Accent 只给时间节点、当前年月、极轻 focus。点进 Detail 才是安静阅读面；Source quote 保留；Memory Book 保留。不给每条 Memory 圆角矩形。

## 我的

```
我的
 (头像) 77odk
 个人简介……
 编辑资料 →
──────────────
TA       TA 的样子 › / 角色管理 ›
记忆     关于我 ›
我们     纪念日 › / 一起经历过 › / 慢信 ›
其他     账号与同步 › / 外观 › / AI 服务 › / 工作台 › / 使用指南 ›
关于忆文   ……
```

顶部必须先让用户看到「我」，不从设置菜单开始；Identity Region 不做巨大 Profile Card。列表用 section title + row + hairline + whitespace，不用五张圆角大卡套五组菜单。

四句话就是 UI2 的信息架构：**我的 = 我；TA 小空间 = TA；空间 = 我们；记忆 = 时间。**

---

# 三、六批施工计划

## UI2-01 · Foundation（阻塞批）

- 文件：新增 `src/styles/ui2.css`；`src/main.tsx` 最小 import；必要时 `src/App.tsx` 最小 shell/class
- 内容：Material / Warm / Accent tokens、双轨 Theme、Transparent Nav、safe-area、pointer-events、统一 bottom spacing
- 不碰：`index.css`、具体页面视觉、Protected 业务逻辑
- 验收：390px 五个 nav view 全过；Chat 输入正常；Nav 后内容可存在；最后一项可滚出遮挡；0 overflow / pageerror / console error；默认 preset、另一 preset、custom Theme 不塌色；test + build 全绿
- **不 PASS，不准进入后面**

## UI2-02 · Visual Motherboard — Home + Welcome（依赖 01）

- 文件：`Home.tsx`、HomeScene / TaOrb / HomeAnniversary（展示层）、`Welcome.tsx`、`ui2.css`
- Web 更新入口只复用既有 `forceRefresh()`，不造第二套
- Home：Scene 到底、去大面积 Card / blur、Presence、Important Date、Chat entrance、透明 Nav
- Welcome：品牌之门、「忆过往，成文思」、去 SaaS feature pills、无人物、CSS 时间 / 轨迹 / 光
- 绝不动：Busy → Runtime → Space Post → fallback 链路；Runtime 推进；Anniversary 算法；Consent / Auth；scene 文件
- 验收：真实 390px morning / day / night + Welcome 截图；**按视觉一致性验收，不按代码完成验收**；必须人工看图通过

## UI2-03 · Memory（依赖 01 + 02 母版确认）

- 文件：`Memory.tsx` 展示层、`ui2.css`
- 年 / 月连续记忆流、去卡化、时间节点体系、Detail / Book 统一 Material
- 禁止：Memory schema、storage、recall、explicit、source 语义、生成逻辑
- 验收：有 / 无 source、多月份、长文字、空态全部正常；数据顺序不变；Accent 不大面积染色；390px；test / build

## UI2-04 · Space（依赖 01 + 02）

- 文件：`AISpace.tsx` 仅限授权 render 区域的 JSX / class、`ui2.css`
- 授权范围（逐个点名，不许笼统写「改 AISpace」）：`renderHomePage` / `renderPhotoWall` / `renderDays` / `renderSharedTimeline`
- 顺序（周记 → 照片墙 → 重要的日子 → 一起经历过）、数据源、子页 route 全不动
- 验收：逐项对照修改前的顺序与数据源；无照片正常空态；不出现假图片；Events 只来自现有 Event；390px + test / build

## UI2-05 · Identity — 我的 + TA 小空间（依赖 01 + 02）

- 文件：`Settings.tsx`、`ChatProfile.tsx` presentation、必要的展示型子页、`ui2.css`
- 建立一对 Identity：「我」↔「TA」
- 我的顶部头像 / nickname / bio / edit 保留；ChatProfile 顶部 TA identity，「TA 是谁」去卡化，生活 / 记录 / 背景入口
- 「刷新对话」视觉与 Web ↻ 完全分离，保留二次确认与 `setSessionStart` 原行为
- 验收：用户资料数据不变；TA 数据不变；角色隔离不变；聊天历史不删；入口全部可达；刷新对话语义正确；390px + test / build

## UI2-06 · Convergence / Cleanup（依赖 02–05 全通过）

- 只处理 UI2 自己产生的视觉收口：共享 DetailHeader、section title、list row、empty state 等真正重复的 presentation primitive；统一 spacing / token 消费；四页 Nav / 标题 / 返回层级；reduced-motion；全站 390px 回归
- **禁止顺手清旧 index.css**（旧 CSS 清理属于之后的 REPO-DIET，必须先证明 selector 已死亡再删）
- 最终验收：TA / Space / Memory / My / Welcome / ChatProfile / Chat 全链路；默认 + preset + custom Theme；PWA safe area；0 overflow / pageerror / console error；test + build 全绿

---

# 四、乔的工程边界补充（评审通过项 + 收紧项）

1. **UI2-01 零组件改动**：现有 `.app` / `.app-main` / `.app-nav` / `.nav-btn` class 已存在，纯 CSS 覆盖即可，本批不需要改 App.tsx——把 01 批的改动面压到最小。
2. **`ui2.css` 的 import 位置固定**：`main.tsx` 里 `import './index.css'` 之后，靠层叠顺序生效；`index.css` 一行不动。
3. **UI2-04 授权范围必须逐个 render 函数点名**（见上），不允许写「改 AISpace 展示层」这类笼统授权。
4. **Web ↻ 与「刷新对话」三处区分**：位置不同（页头右上 vs 个人页底部）、图标不同（环形箭头 vs 现有）、确认文案不同；且 ↻ 绝不出现在 ChatProfile 内部。
5. **截图由乔出**：豆包交付代码 → 乔落地 → 乔用真实 390px 渲染 morning / day / night + Welcome + 四页截图 → 项目方与 GPT 看图定稿。UI2-02 不靠文字验收。
6. **主题三档验收固定**：默认 peach / 另一 preset（如 dusk）/ custom 一色，检查「Material 层不变、只有 accent 变」。
7. **Protected 清单（施工期绝不动）**：`Chat.tsx`（仅两处挂载 + 样式层）、`AISpace.tsx`（仅授权 render 区）、`Memory.tsx`（展示层）、`WeeklyPage`、`SpaceLife`、`RolesPage` 数据行为；`memory.ts` / `sessionStore.ts` / `sessionApi.ts` / `sync.ts` / `migrateLocal.ts` / `memoryWall.ts` / `weeklyReview.ts` / `eventStore.ts` / `eventDetector.ts` / `taRuntime.ts` / `aiSpace*.ts` / `anniversary.ts` / `photoWall.ts`；`auth.ts` / `token.ts` / `consentState.ts` / `LoginGate` / `ConsentGate` / `LoginForm` / `Account` 业务；`theme.ts` 只允许改 `applyTheme` 的变量映射。
8. **每批固定验收动作**：`npm test` + `build` + 本地产物与线上 md5 逐字节比对 + 390px 的 overflow / pageerror / console error 三项归零。

---

# 五、当前状态

- 母版 V1：已冻结（2026-09-12）
- UI2-01 任务书：`TASK_UI2-01.md`（待豆包产出）
- 阻塞关系：01 → 02 →（03 / 04 / 05 并行可）→ 06
