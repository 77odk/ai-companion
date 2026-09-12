# TASK UI2-02 · Visual Motherboard｜Home + Welcome

任务卡作者：GPT。仓库：77odk/ai-companion

> 注记（乔）：本卡假设执行方有 git 写权限（开分支 / 开 PR）。豆包当前没有本仓库写权限，交付形式改为：**文件内容或 unified diff + 交付说明**，由项目方转交乔落地成分支。其余要求全部照卡执行。

UI2-01 已完成并上线。本任务是 UI 2.0 第二批，也是整套 UI 2.0 的“视觉母版批”：只改 Home + Welcome 的 presentation，让真实 390px 页面先把 Eluvin UI 2.0 的视觉语言跑出来。后续 Memory / Space / 我的 / TA 小空间都要以这一批实际效果为母版。

开工前必须先完整阅读仓库根目录 AGENTS.md 和 UI2_MASTERPLAN.md，并 git fetch，以当时最新 origin/main 为唯一事实源。先回报：基线 SHA、工作区是否干净、预计修改文件、是否触及 Protected Systems。不得把文档里的历史 SHA 当最新 main。

━━━━━━━━━━━━━━━━━━
一、这一批允许修改的范围
━━━━━━━━━━━━━━━━━━

允许修改：

1. Home.tsx
   仅 presentation：JSX 结构、class、纯展示文案布局。

2. HomeScene
   仅展示层 / class / overlay / presentation。
   必须继续原样使用：
   /home-scenes/morning.webp
   /home-scenes/day.webp
   /home-scenes/night.webp

3. TaOrb
   仅 presentation / class / SVG 外观 / glow。
   不改变任何业务语义。

4. HomeAnniversary
   仅 presentation。
   现有 props、日期选择、milestone progress 语义不变。

5. Welcome.tsx
   可重做 presentation 结构。
   onStart / onGoGuide 等既有行为不变。

6. src/styles/ui2.css
   本批所有新增 Home / Welcome UI2 样式写在这里。
   在现有 00 Material / 01 Shell/Nav 后新增清晰 section，例如：
   02 Home
   03 Welcome

7. 如显式 Web 更新入口确实需要接线，可在上述展示组件中复用现有 src/lib/forceRefresh.ts。
   不得新造第二套刷新实现。

除此之外不要扩大修改范围。

src/index.css：
【一行都不许改。】
当前约 8165 行 / 161KB，有历史截断事故；禁止全量重写、整理、reformat、搬迁、删除旧 CSS。

如发现必须修改范围外文件才能完成，先停并报告，不得自行扩大 scope。

━━━━━━━━━━━━━━━━━━
二、视觉母版
━━━━━━━━━━━━━━━━━━

必须沿用 UI2-01 已建立的三层体系：

Eluvin Material
= 产品自己的 canvas / surface / text / hairline / glass / shadow。

Eluvin Warm
= 忆文固定品牌温度，只用于 Welcome / Logo / 极少量关系温度。

TA Accent
= 当前 TA 的光，来自现有 ThemeState，只用于 TaOrb glow / active / focus / progress / selected / 小状态。

母规则：

Material 属于忆文；
Warm 属于品牌；
Accent 属于这个 TA。

不要让用户切主题后整个 Home 场景、Welcome 背景、Card、Nav 全部被主题色染色。

本批允许根据真实 390px 视觉微调 UI2_MASTERPLAN 中尚未冻结的具体像素/token 数值，例如 page-x、section gap、blur、Nav 渐变强度等；但不得改变三层职责。

━━━━━━━━━━━━━━━━━━
三、Home 2.0
━━━━━━━━━━━━━━━━━━

Home 是整套 UI2 的视觉核心。

核心定义：

【Scene 就是 Home 的画布。】
不是“图片后面垫着 UI”，而是“UI 活在图片里面”。

必须继续使用现有 morning / day / night 三张 HomeScene，不新增、不替换、不裁切、不压缩、不改色、不改尺寸、不重新生成 public 资产。

场景必须视觉上一直延伸到屏幕最底部，包括 Transparent Nav 后方。

Home 主要层级：

1. 品牌 / 时间关系
   ELUVIN
   时段问候
   和 TA 的第 N 天

2. TA Presence
   TaOrb
   TA 此刻
   当前 momentText

3. Important Date / relationship progress
   表达成“时间关系”，避免重新做成厚重白色纪念日 Card。

4. Chat entrance
   “和 TA 说说话”
   必须是明确可点击的主交互，但不要变成巨大主题色按钮。

5. 现有真实生活入口/内容
   只使用现有真实数据，不制造假动态、假照片、假共同经历。

Home 的视觉原则：

- 首屏必须明显看得到场景主体；
- 不允许大面积磨砂玻璃遮住 scene；
- 不允许高 opacity 大 Card 覆盖主要画面；
- 不允许为了文字可读性铺一整块半透明白板；
- 优先使用 typography、text-shadow、局部 gradient、局部暗化/亮化保护；
- morning / day / night 可以针对明暗使用 scoped presentation class，但不能改业务；
- TaOrb 是主要 TA Accent 使用点，可以有克制的呼吸/光晕；
- 动效必须尊重 prefers-reduced-motion；
- 不新增人物；
- 不新增人物模型；
- 不新增运行时图片生成；
- 不使用网络随机图/占位图。

重要修正：

UI2 的原则不是“绝对禁止 Card”。

允许在真正需要承载交互/信息时使用少量 surface。
禁止的是“Card 成为页面本身”和廉价网页式 Card Stack。

Home 尤其严格：
能靠排版解决就不要 Card；
能靠局部渐变解决就不要整块 glass；
surface 必须是例外，不是默认容器。

━━━━━━━━━━━━━━━━━━
四、Home 业务红线
━━━━━━━━━━━━━━━━━━

以下一个字都不要改：

1. TA 此刻的取值/优先级：
   Busy → Runtime → Space Post → fallback

不得：
- 调整优先级；
- 拆成新的业务状态；
- 额外调用 LLM；
- 点击 Home 导致 Runtime 推进；
- 因视觉动画改变 Runtime；
- 新增 timer/background loop；
- 自动生成 Space Post。

2. taRuntime 推进逻辑不动。
   taRuntime.ts 不动。

3. Busy 逻辑不动。

4. Anniversary / HomeBigDay / milestone 的选择和计算逻辑不动。

现有 milestone progress 只有既有 progress 数据。
如果视觉需要进度线/节点，只能由已有 presentation 数值表现，不得要求新业务数据。

5. getFirstSeen / computeDaysKnown 等认识天数逻辑不动。

6. Home 使用的数据源全部保持原样。

本批的目标是：
【同一份真实数据，换成新的视觉呈现。】

━━━━━━━━━━━━━━━━━━
五、Transparent Nav 在 Home 的验收
━━━━━━━━━━━━━━━━━━

UI2-01 已完成 Nav Foundation，本批不要重做 App Shell。

Home 必须实际验证：

- scene 延伸到 Nav 后方；
- Nav 后能继续看见场景；
- 不出现“内容结束 → 一块独立导航底板开始”的断层；
- Nav active 只使用克制 TA Accent；
- Nav 透明区域不吞 Home 点击；
- safe-area 正常；
- 不出现双 bottom padding；
- 不因为 Home CSS 覆盖破坏其他一级页 Nav。

若发现 UI2-01 Foundation 本身存在阻塞 Home 的问题：
只报告，不要趁本批大改 Shell/App。

━━━━━━━━━━━━━━━━━━
六、Welcome 2.0
━━━━━━━━━━━━━━━━━━

Welcome 定位：

【进入 Eluvin 世界之前的一扇门。】

Welcome 与 Home 必须明显属于同一个产品、同一种视觉母语，但 Welcome 不需要复制 Home 的完整场景结构。

必须保留：

Eluvin / 忆文

官方 slogan 必须逐字保持：

「忆过往，成文思」

整体表达：
这里会有一个 TA，和你一起经过时间，并记得。

可以使用：

- Eluvin Warm 品牌光；
- CSS gradient；
- CSS 光；
- 时间轨迹；
- 两条逐渐靠近的线/轨迹；
- 微弱节点/记忆痕迹；
- 现有静态品牌视觉；
- typography；
- 极轻 motion。

不要使用：

- 人物；
- 默认生成 TA 形象；
- 运行时 AI 大图；
- 网络占位图；
- SaaS landing page 式 feature pills；
- 工具能力堆叠；
- “AI 编程”作为 Welcome 主卖点；
- AI 紫色霓虹科技页；
- 大量 glass 卡片。

现有「对话 / 长期记忆 / AI 编程」三个 feature pill：
UI2 Welcome 允许移除其展示。
这只是 Welcome 品牌入口不再展示这些 feature pills，不代表删除对应真实功能。

主 CTA 保留“开始遇见 TA”/现有等价进入行为，必须继续调用既有 onStart。

已有账号登录入口必须保留其既有行为。

使用指南入口如当前存在，行为不变。

━━━━━━━━━━━━━━━━━━
七、Welcome 绝对不能碰
━━━━━━━━━━━━━━━━━━

不要修改：

BOOT_INTERVAL_MS / boot seen 逻辑
ConsentGate
LoginGate
LoginForm
Auth
Token
Consent state
年龄门
登录墙顺序
onStart 后续业务流程
onGoGuide 行为
账号数据

不得为了让 Welcome 更“顺滑”绕过任何 Gate。

━━━━━━━━━━━━━━━━━━
八、Web 更新 ↻
━━━━━━━━━━━━━━━━━━

项目已有 canonical 能力：

src/lib/forceRefresh.ts

其行为包含清 Cache Storage、注销 SW、location.reload。

如本批实现显式 Web 更新入口：

必须直接复用现有 forceRefresh()。

禁止：
- 新造 location.reload 版本；
- 修改 forceRefresh.ts；
- 修改 Service Worker；
- 修改 vite-plugin-pwa 配置；
- 自动轮询版本；
- 自动刷新；
- 点击更新触发 LLM；
- 点击更新生成 Space；
- 点击更新推进 Runtime；
- 点击更新改变 Memory/Event。

视觉上：
小型、克制、页头级 Web affordance。
不要做巨大刷新按钮。

并明确：

Web 更新 ↻
≠
ChatProfile 的“重新开始这段对话”。

本批不修改 ChatProfile，也不碰 setSessionStart。

如果现有 Welcome 已有强刷入口，可重新设计它的 presentation，但复用同一 forceRefresh。

━━━━━━━━━━━━━━━━━━
九、视觉参考与实现原则
━━━━━━━━━━━━━━━━━━

目标不是把概念图当 PNG 像素级硬抄。

目标是：
真实数据变化、昵称变化、TA 名变化、日期变化、390px 内容长度变化以后，仍保持同一种视觉。

禁止为了“像设计稿”：

- hardcode 假昵称；
- hardcode “第182天”；
- hardcode 假 Runtime；
- hardcode 假纪念日；
- hardcode 假 Space 内容；
- 固定高度导致长文溢出；
- 加假照片；
- 加假人物；
- 把视觉稿里的装饰内容当业务数据。

视觉一致性优先看：

层级
比例
留白
光影
材质
字体关系
场景可见度
Accent 使用面积
Nav 深度感

而不是某一句假内容是否和概念图一致。

━━━━━━━━━━━━━━━━━━
十、Protected Systems
━━━━━━━━━━━━━━━━━━

本任务绝对不要修改：

src/components/Chat.tsx
src/components/AISpace.tsx
src/components/Memory.tsx
src/components/ChatProfile.tsx
Settings 业务
WeeklyPage 数据行为
SpaceLife 数据行为
RolesPage 数据行为

src/lib/memory.ts
src/lib/sessionStore.ts
src/lib/sessionApi.ts
src/lib/sync.ts
src/lib/migrateLocal.ts
src/lib/memoryWall.ts
src/lib/weeklyReview.ts
src/lib/eventStore.ts
src/lib/eventDetector.ts
src/lib/taRuntime.ts
src/lib/aiSpace*.ts
src/lib/anniversary.ts
src/lib/photoWall.ts

src/lib/auth.ts
src/lib/token.ts
src/lib/consentState.ts
LoginGate
ConsentGate
LoginForm
Account 业务

backend/
API 路径
同步协议
storage schema
ThemeState schema
现有 public 图片资产
任何 .env / key / token

theme.ts：
本批原则上不需要修改。
UI2-01 已建立三层 token；不要借本批重新设计 Theme。

━━━━━━━━━━━━━━━━━━
十一、代码与 CSS 纪律
━━━━━━━━━━━━━━━━━━

1. index.css 0 change。
2. 新样式全部进 src/styles/ui2.css。
3. 不整理旧 CSS。
4. 不删除旧 selector。
5. 不做 Repo Diet。
6. 不重构目录。
7. 不新增/升级 dependency。
8. 不为了“组件更漂亮”大拆 Home。
9. 可以抽非常小的纯展示结构，但若不是完成本批必须，不要抽。
10. 不使用 emoji 当 UI 图标；需要图标使用现有极简 SVG 体系。
11. 不顺手修任何任务外 bug。
12. 任务外问题只记录。

━━━━━━━━━━━━━━━━━━
十二、Git 纪律
━━━━━━━━━━━━━━━━━━

这是 src/ + 用户可见视觉/文案改动。

严格遵守 AGENTS.md：

- 从最新 origin/main 开分支；
- 分支建议：feat/ui2-home-welcome
- commit / push 自己分支；
- 开 PR；
- 不直接 push main；
- 不替项目方 merge；
- 不部署；
- 不 force push main；
- 不 reset/rebase main。

本任务完成到：
【代码 + PR + 交付说明】
为止。

（乔注记：豆包无本仓库写权限，交付形式 = 文件内容 / unified diff + 交付说明，由项目方转交乔落地成分支与 PR。其余照旧。）

━━━━━━━━━━━━━━━━━━
十三、测试
━━━━━━━━━━━━━━━━━━

必须运行：

1. npm test
   以开工时最新 main 的实际测试基线为准，全部通过。
   不允许删测试换绿。

2. npm run build

3. diff 检查：
   确认只有授权文件变化；
   index.css 必须 0 change；
   public 既有资产 0 change；
   Protected 数据逻辑 0 change。

4. Theme 三档：
   - 默认 peach
   - 另一 preset，例如 dusk
   - custom 一色

验收：
Material 层基本不变；
Home Scene 不被 Theme 染色；
主要只看到 TA Accent 改变。

5. 390px runtime：
   Home morning
   Home day
   Home night
   Welcome

并检查：
horizontal overflow = 0
pageerror = 0
console error = 0

6. Home interaction：
   Chat 入口正常；
   Important Date 现有入口正常；
   TA life/shortcut 现有入口正常；
   Nav 正常；
   所有原 Home 点击行为正常。

7. Welcome：
   onStart 正常；
   已有账号登录入口正常；
   Guide 入口正常（若当前页面存在）；
   Web ↻ 正常（若本批落地）。

━━━━━━━━━━━━━━━━━━
十四、视觉截图是本批核心交付
━━━━━━━━━━━━━━━━━━

本批不能只交：

“UI2-02 已完成。”

必须产出真实浏览器 390px 截图。

按 UI2_MASTERPLAN 的工程约定：
豆包完成代码/PR后，由项目侧/乔落地并输出真实截图也可以。

最终必须拿到：

1. Welcome
2. Home morning
3. Home day
4. Home night

最好同时提供：
默认 Theme + 至少一个非默认 TA Accent 的 Home 对照。

视觉验收重点：

A. 第一眼是不是一个完整的 Eluvin 世界，而不是普通网页。

B. HomeScene 是否是视觉主体。

C. 大面积 blur/Card 是否真的消失。

D. TA Presence 是否清楚，但没有压过 Scene。

E. Important Date 是否像“关系里的时间”，而不是后台功能卡。

F. 暖橘是否只剩品牌温度，没有重新成为 UI 油漆。

G. TA Accent 是否主要表现为 TA 的光/状态。

H. Nav 后是否真的还能看到 Scene。

I. morning/day/night 三张图上的文字是否都清楚。

J. Welcome 与 Home 是否像“门外 → 世界里面”。

【本批最终是否 PASS，由真实截图人工确认，不以代码完成自动判定。】

━━━━━━━━━━━━━━━━━━
十五、交付格式
━━━━━━━━━━━━━━━━━━

完成后请严格按以下格式回传：

1. 基线 origin/main SHA
2. 分支名
3. 最终 commit SHA
4. PR 链接/编号
5. 修改文件列表
6. diff stat
7. index.css 是否 0 change
8. public 既有资产是否 0 change
9. Protected Systems 是否 0 behavior change
10. Home JSX/结构改了什么
11. Welcome JSX/结构改了什么
12. ui2.css 新增哪些 section
13. 是否修改 theme.ts（预期：否）
14. 是否修改 forceRefresh.ts（必须：否）
15. Web ↻ 是否落地；若是，确认复用哪个既有函数
16. Busy → Runtime → Space Post → fallback 是否原样
17. Runtime/Busy/Anniversary 数据逻辑是否原样
18. npm test 结果
19. npm run build 结果
20. Theme 三档结果
21. 390px Home morning/day/night 结果
22. 390px Welcome 结果
23. overflow / pageerror / console error
24. 原 Home/Welcome 交互回归
25. 任务外发现（只记录，不修改）
26. 是否存在阻塞人工视觉验收的问题

最后只回答：

A. UI2-02 代码侧是否完成
B. 是否满足进入真实 390px 截图人工验收的条件
C. 是否建议现在进入 UI2-03/04/05

注意：
即使 C=是，也不要自行开始下一批。
UI2-02 必须先经过真实截图人工确认，后续批次等新任务。
