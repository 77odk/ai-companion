# TASK UI2-02 · Visual Motherboard（Home + Welcome）

依赖 UI2-01（已上线，main 含 `a9acacc1`）。母版见 `UI2_MASTERPLAN.md`，红线见 `AGENTS.md`。

## 目标

把 UI 2.0 真正的视觉母语跑出来。这一批定的是「以后的页面长什么样」，所以**按视觉验收，不按代码完成验收**。

## 允许改的文件

1. `src/components/Home.tsx`（只动展示：JSX 结构 / class / 文案位置）
2. `src/components/HomeScene.tsx`（只动外层结构与 class）
3. `src/components/TaOrb.tsx`（只动展示层）
4. `src/components/HomeAnniversary.tsx`（只动展示层）
5. `src/components/Welcome.tsx`（纯展示）
6. `src/styles/ui2.css`（**只追加 `02 · Home / Welcome` 一节**，不改 01 节）

## 绝对不许动

- Home 的取值链：`momentText` 优先级（Busy → Runtime → Space Post → fallback，一个字不能动）、`getOrAdvanceTaRuntime`、`getMilestoneProgress`、`pickHomeBigDay`、`getFirstSeen`
- Home 的 props 与回调（onGoChat / onGoLife / onGoAnniversary）
- **不新增任何数据源**：Home 现在没有「TA 的生活预览」数据块，只有 `.home-shortcuts` 里一个「TA 的生活」按钮——保持这个现状，不要新造数据、不要造假的动态内容
- `HomeScene` 的图片路径：仍然只取 `/home-scenes/{morning|day|night}.webp`，缺图必须保留 gradient fallback
- `index.css` 一行不改（Home / Welcome 的老规则全部在 ui2.css 里覆盖）
- ConsentGate / LoginGate / Auth / 路由（App.tsx 的 view 与回调）
- Protected：Chat / AISpace / Memory / sessionStore / sync / auth / consentState / taRuntime / eventStore
- 不新增依赖；不引入网络图片；不用 emoji 当图标

## 一、Home

### 1. 场景铺到底
- `.home-page` 现在自带底部 padding（约 24px），它和 Nav 的安全区叠加导致底部留白偏多：本批把 Home 的底部内边距统一改吃 `--ui2-nav-safe-height`，让 morning / day / night **真正铺到屏幕最底部、Nav 后面仍能明显看到场景**
- `.home-scene-overlay` 的层级保留，可按可读性需要微调梯度，但不能变成"盖住画面的磨砂层"

### 2. 去卡化（本批的核心）
- `.home-anniversary` 现在是「有背景的卡」：改成**时间关系排版**——`IMPORTANT DATE` 小标签 + 日期/倒数大字 + hairline 分隔；「查看」按钮保留；里程碑进度条保留（数据字段一律不动）
- `.home-companion` 现在也是有底的一块：改成以排版为主（`X 此刻` + 状态文案 + TaOrb + 聊天入口），不再是大面积磨砂卡
- `.home-shortcuts` 的按钮不要做成大白块
- 全页最多允许极少量真正的 surface（`--ui2-surface` / `--ui2-glass`），不要重新玻璃卡化

### 3. 文字可读性
- 三张场景图明暗不同（day 偏亮、night 偏暗），文字靠 `text-shadow` / 局部 gradient / 轻微暗化获得可读性；**不许用大面积不透明底**
- 三种时段都要能读清：`早上好` / `今天也辛苦了` / `夜深了` 三态各自成立

### 4. TaOrb
- 允许用 TA Accent：`--ta-accent` 做 glow / 呼吸（**注意 prefers-reduced-motion，动效要能关**）
- 有头像时用头像、无头像时用名字首字，两种都必须成立

### 5. Web 更新入口（新）
- 一级页（先做 Home）右上角一个小的 ↻ 按钮：轻透明，不要大白卡
- **直接复用现有 `src/lib/forceRefresh.ts`**（清缓存 + 注销 SW + reload），不要造第二套、不要加轮询、不要自动更新
- 语义必须与 ChatProfile 的「刷新对话」明显区分：位置在页头右上、图标是环形箭头、文案是「更新」；**不得出现在 ChatProfile 内部**

## 二、Welcome

- 保留：`忆文` / `Eluvin` / `忆过往，成文思` / 开始使用 / 教程链接 / 访问计数 / 强刷按钮
- 去掉：三个 feature pills（对话 / 长期记忆 / AI 编程）
- 视觉：CSS 光 + 两条逐渐靠近的轨迹 / 时间节点 / 微弱记忆痕迹；允许用 `--eluvin-warm`；**不用图片、不生成人物、不用网络图**
- Welcome 与 Home 必须像同一个世界（token、排版节奏一致）

## 三、交付格式

- 每个改动文件的完整内容或 unified diff（多文件建议分别给）
- `src/styles/ui2.css` 追加后的完整文件 + md5
- 跑了哪些检查（至少 `npm run build` 通过）、有无任务外发现（只记录不修改）

## 四、验收（乔执行）

1. `npm test` 全绿 + `npm run build` 通过
2. 390px 真实渲染截图：morning / day / night / Welcome 各一张（乔出图，项目方与 GPT 看图定稿）
3. 0 横向溢出、0 pageerror、0 console error
4. Runtime / Busy / Anniversary / 数据源逐项对照修改前，行为一致
5. 首屏必须明显看到场景主体；Nav 后仍可连续看到场景
