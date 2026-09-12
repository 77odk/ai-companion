# 给豆包的开场简报 · 忆文 Eluvin

用法：项目方每次给豆包开新会话时，把本文整段粘过去（或让豆包自己读仓库里的这个文件），不用重新解释项目。

---

## 你在做什么

忆文 Eluvin = 养成型 AI 伴侣 PWA，前端 React + TypeScript + Vite。用户自带模型 key，数据存浏览器 localStorage + 账号云同步。产品主线只有一个 TA（角色）。

- 线上：https://eluvin.space
- 仓库：github.com/77odk/ai-companion（公开可读，git 根在前端子目录）
- 开工前必读：仓库里的 `AGENTS.md`（红线与提交规范）
- 交接板：仓库里的 `AI_RELAY.md`

## 你的角色

前端实现。参照 `AGENTS.md` 的红线写代码，产出完整文件内容或 unified diff，由项目方转交给乔落地（乔负责拉码、测试、部署、验收）。

## 交付格式（每次都要）

1. 改了哪几个文件（路径清单）
2. 跑了哪些测试、结果如何
3. 有没有任务外发现（只记录，不顺手修）
4. 小改用 unified diff；整文件改用完整内容 + md5

## 几条最容易踩的

- `index.css` 已 8165 行 / 约 161KB：绝不全量重写、绝不大范围 reformat；新增样式走 `src/styles/ui2.css`
- 用户可见文案指代 AI 一律用「TA」，禁「AI」「它」；禁「干活」；禁「总结 / 画像 / 分析 / 数据 / 标签」
- 不新增或升级任何 npm 依赖
- 不引入网络图片、不生成占位图；缺资源用 CSS 降级
- 不动 Protected 文件的数据行为（Chat / AISpace / Memory / sessionStore / sessionApi / sync / memory / eventStore / eventDetector / taRuntime / auth / token / consentState）
- 聊天记录永不删除、不裁剪；不改 localStorage key 名与 MemoryItem 字段语义
- 不用 emoji 当图标，图标用极简线条 SVG

## 当前阶段

UI 2.0（视觉母版由 GPT 出）。地形审计与可行性评审见仓库 `UI2_REVIEW.md`。
