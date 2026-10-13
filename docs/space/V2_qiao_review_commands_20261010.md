# PR #233：乔本地执行，凭据不出口

这一轮检查本地未签收的候选场景。不开正式门禁，不部署，不修改后端。
专用测试账号只在乔自己的环境登录；不导出或传递 storage-state/密码/token。

## 1. 更新并启动本地评审构建

确认当前工作区没有需要保留的未提交改动，停止占用 5173 的旧预览后，在仓库目录执行：

```bash
git switch fix/space-mobile-visual-baseline
git pull --ff-only origin fix/space-mobile-visual-baseline
npm run build
node scripts/space_v2_app_review.mjs --serve
```

最后一条只输出到新建的 OS 临时目录，并在 `http://localhost:5173` 启动本地预览。
它沿用原始 main/App、登录墙、同意门和业务逻辑，画面显示“本地美术候选 · 未签收”。
源码和构建包的 manifest 两个开关仍为 false。正常 `npm run build` 不选评审模式。
这不是部署或美术签收；不要把临时构建上传正式站。

## 2. 本地登录并检查三档

另开终端，在仓库目录执行。若有图形界面：

```bash
mkdir -p /tmp/eluvin-g1-233
python3 scripts/g1_space_mobile_smoke.py \
  --url http://localhost:5173 \
  --interactive-login \
  --screenshots /tmp/eluvin-g1-233/space \
  > /tmp/eluvin-g1-233/g1-result.json
```

在打开的浏览器里正常登录专用账号、完成同意页面。最多等待 3 分钟。
三档共用内存上下文，结束关闭，不创建登录状态文件。

若没有图形界面，但乔已有自己管理的、正常登录的专用测试 Chromium：

```bash
mkdir -p /tmp/eluvin-g1-233
python3 scripts/g1_space_mobile_smoke.py \
  --url http://localhost:5173 \
  --cdp-url http://localhost:9222 \
  --screenshots /tmp/eluvin-g1-233/space \
  > /tmp/eluvin-g1-233/g1-result.json
```

9222 只是示例，请使用该专用测试浏览器已有的**本地**调试端口，不向外开放。
连接只借用已有上下文、创建并关闭自己的测试页；不导出状态，不关闭原浏览器/上下文。
借用模式只改变视口，不冒称更改了原上下文的移动触摸配置；报告会明确标注。
如果没有本地登录条件，返回 BLOCKED 即可，不造账号或改登录门。

## 3. 回传与人工检查

回传 JSON、三张专用测试账号截图，记录使用的提交和构建版本；不回传任何凭据。
含私人内容的图片先在本地审查，不公开上传。

期望 `sourceCommit` 与 `servedBuildVersion` 一致，`unapprovedReviewBuild=true`，
`layered=true`，无错误/可见破图/横向溢出。应报告
`UNAPPROVED_LAYERED_REVIEW_SMOKE_ONLY`，不是视觉签收。
若仍是 FALLBACK_SMOKE_ONLY，先回传结果，不改 manifest 强行开启。

在同一个本地候选版本检查并截图/录屏：

- 完整房间、植物待机及减少动态效果切换。
- 抽屉 0/25/50/75/100% 拖动、短拉回弹、打开书信后返回。
- 照片墙、记忆罐、思绪书、播放器的入口/返回及物件遮挡。
- 如专用账号已有真实测试内容，检查照片查看/拖动恢复、记忆对应、思绪翻页、实际音乐播放和书信展示。

没有对应内容的项目明确记为未验收；不自动添加或伪造内容。
脚本只做运行预检，图片的空间、材质、透视和动态仍由执行者自行检查。
Codex 收到截图后也会逐张检查和修复。

本地浏览器尺寸模拟不等于实体手机性能，真实天气缺失时应保持中性。
结束后关闭本地预览；不提交凭据或用户内容，不合并、不部署。
