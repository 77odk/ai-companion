# TASK UI2-01 · Foundation（阻塞批）

给豆包的任务书。母版见 `UI2_MASTERPLAN.md`，红线见 `AGENTS.md`。

## 目标

只做三件事：Material token 层、Transparent Nav、底部安全间距。**不改任何页面视觉。**

这是阻塞批：本批没过，不准进入 UI2-02。

## 允许改的文件（只有两个）

1. **新增** `src/styles/ui2.css`（纯新增文件）
2. `src/main.tsx` —— 只允许加一行：在 `import './index.css'` 之后加 `import './styles/ui2.css'`

**本批不碰任何 .tsx 组件文件。** 现有 `.app` / `.app-main` / `.app-nav` / `.nav-btn` class 已存在，纯 CSS 覆盖即可完成，不需要改 App.tsx。

## ui2.css 本批只写两节

### 00 · tokens（只新增，不覆盖）

```
:root {
  --ui2-canvas: #F7F4EF;
  --ui2-surface: rgba(255,255,255,.58);
  --ui2-surface-elevated: rgba(255,255,255,.82);
  --ui2-text: #332B28;
  --ui2-text-secondary: #817773;
  --ui2-hairline: rgba(51,43,40,.10);
  --ui2-glass: rgba(248,246,242,.46);
  --ui2-nav-material: rgba(247,244,239,.76);
  --ui2-shadow: 0 12px 40px rgba(38,31,28,.08);
  --ui2-blur: 16px;
  --ui2-page-x: 22px;
  --ui2-section-gap: 36px;
  --ui2-item-gap: 18px;
  --eluvin-warm: #D8875F;
  --eluvin-warm-soft: rgba(216,135,95,.12);
  --ta-accent: var(--color-primary);
  --ta-accent-soft: var(--color-primary-soft);
  --ta-accent-deep: var(--color-primary-deep);
}
```

硬要求：
- 不覆盖、不删除任何现有 `--color-*` 变量（双轨过渡，老规则继续吃老变量）
- `--ta-accent*` 只做映射，不进 ThemeState、不改储存

### 01 · shell + transparent nav

- `.app` 加 `position: relative`
- `.app-nav` 脱离文档流：`position: absolute; left: 0; right: 0; bottom: 0`
- `.app-nav` 背景改「透明 → `--ui2-nav-material`」的纵向渐变，**不是整块不透明底**；保留 `env(safe-area-inset-bottom)`
- `.app-nav { pointer-events: none }`，`.app-nav .nav-btn { pointer-events: auto }`（透明区不许吞点击）
- `.app-main` 加底部 padding = nav 实测高度 + `env(safe-area-inset-bottom)`，保证最后一项能滚出遮挡
- 保留现有 `prefers-reduced-motion` 分支，新增动效（如有）一并遵守
- z-index：确保 nav 在内容之上，且不压住全屏弹窗

## 明确不做

- 不改 `index.css`（一行都不改，也不 reformat）
- 不改任何页面 JSX / 文案 / 视觉
- 不新增依赖
- 不碰 Protected 业务逻辑（Chat / AISpace / Memory / sessionStore / sync / auth / consentState / taRuntime）
- 不扩大改动范围，不顺手修别的 bug（发现的任务外问题只记录）

## 验收（由乔在真实环境执行）

1. `npm test` 全绿、`npm run build` 通过
2. 390px 下五个 nav view（TA / 空间 / 记忆 / 我的 / 聊天）全部：0 横向 overflow、0 pageerror、0 console error
3. 每个页面：内容能滚到底、最后一项不被 Nav 永久遮住
4. Nav 透明区点击穿透正确（点得中内容，点得中 nav 按钮）
5. Chat 页输入区不被 Nav 压住，能正常输入与发送
6. 三种主题（默认 preset / 另一个 preset / custom）切换后**不塌色**：Material 层不变，只有 accent 相关元素变化

## 交付格式

- `src/styles/ui2.css` 完整内容 + md5
- `src/main.tsx` 的 unified diff
- 跑了哪些检查、结果、有无任务外发现（只记录不修改）
