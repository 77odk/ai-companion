# 第一批验收记录（不合并、不部署）

视觉完善复验见 [本批说明](../space3d-visual-polish.md)；此处截图和 runtime.json 已更新为视觉完善版本。

基线 sandbox `01bd2205afaff7db08c7480bc243062b8c0fe9bd`。A 分支 `feat/space-environment-phase1`，B 分支 `feat/space-3d-phase1` 堆叠于 A。

## 自动检查

- 最终完整执行环境 npm test 实测：基线 255 pass / 0 fail；A 264 / 0；B 270 / 0。首次受限执行输出的 137/139/141 是脚本汇总，最终以相同完整子进程环境展开子测试后的实际输出为准。原有 scripts 逐字保留，追加环境/天气/手势/质量/真实几何测试。
- tsc -b、build、lint 通过；lint 66 条既有文件警告，新模块无警告。3D 为懒加载块，537007 字节（约 524.4 KiB），构建给出大块提示。
- 既有 lock 条目逐项一致，只新增 three 0.180.0；原 public 素材逐字节一致。AISpace 只增加 13 行挂载与只读命中转发，0 行删除。登录、同意、上传/合并/去重、聊天与记忆写入、播放器实现均未改。
- A PR #254 最新修复提交 eaa5218 的 CI success（run 38155163224）。既有 workflow 只监听 main/sandbox 目标；堆叠 B PR 目标为 A 分支，不会自动触发 CI。B 的结果是本地检查，不写成远端 CI 绿。

## 三机位 × 三尺寸

固定时间 2026-06-21T04:00:00Z，北京/Asia/Shanghai、晴/云量15%、DPR1、hardwareConcurrency8、1024 阴影、reduced-motion；内容为明确标注的合成文字，不含真实用户聊天。

[总览 390×844](baselines/phone-overview.png) · [阅读 390×844](baselines/phone-reading.png) · [抽屉 390×844](baselines/phone-drawer.png)

另含 360×800、1280×800 的三机位，共九图。[manifest](baselines/manifest.json) 记录逐图 SHA、条件与实测预算。阅读页宽约 300 CSS px；书页 1024×2048 使用 1024×1468 有效 UV，实体 0.30×0.43m，1.5mm 厚度，不拉伸。

两次截图 SHA 完全一致，九图 0 页面错误、0 横向溢出。烘焙 21 PNG 与整个 manifest 两次 SHA 一致，见 [复现结果](reproducibility.json)。

## 性能（只代表软件渲染）

Node 24.19.0、Chromium 154.0.8037.57、ANGLE SwiftShader。本机被运行时并发数启发式识别为低端画质：DPR1、512 阴影、60 雨粒子；这不是低端手机或 6× CPU 仿真。固定初始画质档、雨与受控机位变更、至少 12 秒/12 帧；仅开发验收入口暂停自然自适应，以单独衡量原始帧率。整页使用外层 rAF 计数，场景使用同窗口实际渲染帧数，详细数据见 [runtime.json](runtime.json)。

| 样本 | 场景 fps | 整页 fps | 帧数 / 时长 |
|---|---:|---:|---|
| phone / 390×844 | 1.81 | 1.81 | 22 / 12.17s |
| desktop / 1280×800 | 0.66 | 0.66 | 12 / 18.06s |
| integrated-phone / 390×844 | 2.03 | 2.03 | 26 / 12.81s |

phone/desktop 为 Space3DCanvas 合成内容 fixture；integrated-phone 为实际 AISpace + 原照片档案服务。软件帧率受云机负载影响，显著低于 25，不能作为手机性能通过证明。

| 来源 | 状态 / 负责人 |
|---|---|
| 真实中低端手机 | 尚未测试；七七在测试站验收 |
| 6× CPU + 中低端机型模拟 | 尚未测试；项目方执行 |
| 无头软件渲染 | 已测，数据如上；不能替代前两项 |

## 回落与状态行为

[runtime.json](runtime.json) 包含三种故障注入：WebGL2 不可用、初始化抛错、上下文丢失。每次恢复原 2D；五入口可用，四个原导航回调实际触发，照片墙仍打开原 DOM 档案。

完整阶梯以连续 60×50ms（3 秒平均 20fps）逐档验证：关阴影 → DPR1.5 降至1 → 正在运行的雨粒子关闭 → 整块退回原2D。每档等待渲染生效再取值，独立于原始帧率采样。

所有预算使用 renderer.info.autoReset=false 并逐帧 reset，包含主绘制及阴影 pass；最大 48 颗星 / 5 封信 + 雨实测 91 calls / 25026 triangles（无照片；满照片另见 polish-budget.json）。抽屉把手和导轨不投影，给天气与最大内容留余量。

另外验证：reduced-motion 变化后停止装饰与空闲 RAF；夜间直射0、仅台灯投影、ambient .05、lightMap .06；背向太阳窗口直射0；DOM 搜索、字号、消息 ID+偏移保存；布置进入/退出/选中无内容写入。长按500ms、灰区、命中锁定、双指、cancel/后台在原生事件单测中覆盖。本批不拖动、不保存摆放。

## 烘焙与截图命令

```sh
npm ci
node scripts/probe_space3d_shadow.mjs
node scripts/bake_space3d.mjs
node scripts/screenshot_space3d.mjs --update-baselines # 显式更新基准
node scripts/screenshot_space3d.mjs # 复拍 SHA 比较，不覆盖基准
node scripts/validate_space3d_runtime.mjs
node scripts/validate_space3d_home.mjs
node scripts/generate_space3d_solar_reference.mjs
```

工具使用本机 node + Chromium，无新构建期 npm 包；CHROMIUM_BIN 可指定可执行路径。各脚本共用本地端口，顺序运行。烘焙只含环境光、固定实体/接缝与窗洞低频漫射，不含太阳与移动摆件。PNG 线性编码、uv1，ImageBitmap 禁止隐式颜色转换；逐文件色彩空间见 [素材表](../space3d-assets.md)。工具、fixture、报告不进入生产入口。

[阴影探针](shadow-radius.json)：three r180 下 PCFSoftShadowMap radius1→6，0 字节变化；PCFShadowMap 3453 字节变化，因此使用 PCFShadowMap。没有4096阴影、后处理或运行时路径追踪。

## 顺手修

- 本批新增的首页环境反馈调用捕获无效城市时区，避免第三方天气元数据异常导致首页崩溃；不使用设备时区替代。
- 新增首页反馈开关与站内信保持 8px 间隔，高于天气空白行；实际完整 Home/现有样式在 390 宽检查两者不重叠，开/关、原站内信回调、异常时区都通过，见 [home-feedback.json](home-feedback.json)。两个首页修复已回填 A 分支，B 继承修复。
- 环境测试的参考值替换为独立 Julian-century NOAA 计算结果，误差断言仍为 ≤1°；原有基线断言未修改。

## 任务外发现

- 既有 npm mirror 需要当前环境代理才能安装；没有改 registry 配置或升级依赖。
- 既有 CI 目标过滤不覆盖堆叠分支，没有改运维/workflow 配置。
- 手机与 6× CPU 数据尚缺，不能宣告性能验收完成；保持默认关，等待项目方复验。
