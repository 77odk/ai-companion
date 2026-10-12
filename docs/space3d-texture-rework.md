# 空间页 3D · 第一批质感返工

分支 `fix/space-3d-texture-rework`，base `feat/space-3d-reference-desk`（#258，`afc4855f0e89fac643c356a034158fef554645eb`）。继续继承 sandbox `010f4710` 的 AGENTS.md v3.3，不改规则。此批不做拖动/摆放持久化、房间扩展、首页 3D、SDF 或多角色改动。

## 结果与指标口径

相同固定条件：北京 / Asia/Shanghai、2026-06-21T04:00Z、晴天码0、云量15%、DPR1、reduced-motion、Chromium154 SwiftShader、同一合成消息与照片输入。全张原生 PNG（包含原 UI）计算，不缩放、不裁剪。亮度0.299R+0.587G+0.114B；饱和度(max-min)/max（黑=0）；亮度中心差分梯度模长>8，图像边界单侧差分；3×3总体标准差<1.2，边界reflect。四项与项目方旧基准数字复现一致。

色数另列为RGB右移5位、全像素去重；同时输出固定5×5采样的辅助色数。项目方“抽样”的步长尚未明确，不能把本表全像素色数与原卡119/79/34混称同口径；不以色数作为本次达标依据。

| 场景 | 亮度 | 饱和度 | 细节 | 近平坦 | 全像素量化色数 |
|---|---:|---:|---:|---:|---:|
| phone-overview.png · before | 162.1 | 0.261 | 16.2% | 68.9% | 86 |
| phone-overview.png · after | 135.3 | 0.399 | 24.4% | 14.5% | 103 |
| phone-reading.png · before | 205.1 | 0.117 | 22.7% | 66.0% | 35 |
| phone-reading.png · after | 169.8 | 0.257 | 26.7% | 15.5% | 45 |
| phone-drawer.png · before | 176.9 | 0.244 | 13.9% | 77.2% | 49 |
| phone-drawer.png · after | 142.4 | 0.410 | 19.4% | 13.2% | 86 |

同条件总览达到135–155 / 0.35–0.50 / ≥22% / ≤50%的目标。午后晴天（2026-12-21T05:30Z）总览约135.7 / 0.394 / 25.5% / 14.3%；返工前同刻为163.8 / 0.256 / 17.6% / 66.5%。阅读午后约130.4 / 0.386，六月正午为169.8 / 0.257（原205.1 / 0.117），不能声称所有时刻、所有机位都达到总览的饱和度区间。

关闭颗粒与暗角的午后材质实拍仍为136.0 / 0.394 / 24.5% / 45.6%，四项仍达标；不是靠颗粒把材质不足藏起来。实际墙体标识渲染统计可见裸墙为画布26.64%（不计纸片与摆件）；顶部40%区的近平坦占比由原基准约72%降至约7.9%。两种面积定义分别记录，不混用。

[总览并排](space3d-validation/texture-rework/phone-overview-comparison.png) · [阅读并排](space3d-validation/texture-rework/phone-reading-comparison.png) · [抽屉并排](space3d-validation/texture-rework/phone-drawer-comparison.png)。左为原参考480×853，右两栏为返工前/后390×844，原生尺寸，不拉伸。其余尺寸见九图基准与本批36张固定时刻实拍。

## 改了什么

- 实际旧曝光是1.35；改为日间总览/抽屉0.95、阅读0.85、夜间1.02，仍用ACES，按原过渡时长lerp。日间ambient0.18、漫射倍率2.8、直射倍率3.2保持原值，没有抬高暗部。太阳方位、高度、PCF类型/radius1、bias−0.0005、normalBias0.003未改。
- 暖木基色#A9744F，程序化木纹尺度、明暗条带与非均匀扭曲可见；法线0.16、roughness0.58附近。反射源改为暖木/奶油间接色，生成与PMREM仍只在初始化进行。纸#F5F0E4、缓存纤维/轻微色差、局部黄纸边；墙面细颗粒可见，各材质保持独立噪声与粗糙度，非金属metalness0。
- 星星与绿植用更明确的纸色/绿色，照片仍在独立2mm纸片上；未把整张照片、桌面、墙光斑、玻璃固定反光作为场景贴图。既有打印照片内容及真实用户照片的只读覆盖链路保留。
- 总览由远景收近，扩大书桌与书的比例，收拢左侧盆器、藤蔓和播放器位置。桌1.4×0.6m、高0.75m、厚0.03m；固定墙/窗洞/桌体与离线UV1未变。书封落到桌面，播放器底落到桌面，纸仍1.5mm厚、16横向分段，增加0.5mm微圆边；桌沿3mm、2段倒角保留。
- 书、罐、盆器/笔筒、播放器的桌面接触、纸片的墙面接触用接收面材质中的近场遮挡，跟随真实mesh的世界transform，抬离表面即淡出。仍有原真实动态投影；没有烘焙移动摆件对桌面的影子。移动书0.75m后原脚下18个样本无残影；抬起0.12m两页接触权重均0。
- 暗角强度0.075、静态颗粒0.024接入既有材质片元输出；没有额外渲染pass、纹理逐帧上传或动画。开/关实测均93 calls /51240 triangles；无bloom、SSAO、DOF、SDF、物理库。
- 夜间仍只由原台灯SpotLight投动态影：#FFCF98、40°、penumbra0.6；ambient0.05、间接环境0.035、lightMap0.06、窗外弱冷点光0.08。太阳直射0，台灯阴影独立，夜间曝光不与白天共用。

## 素材来源、规格和色彩空间

| 项 | 来源 / 规格 | 运行时色彩空间 |
|---|---|---|
| wood | 本地程序生成1024²、重复、aniso4 | color SRGB；normal/roughness NoColor |
| wall / paper / linen / floor | 各自程序生成512²、独立seed/尺度 | color SRGB；normal/roughness NoColor |
| 书页 | 字体ready后，真实消息分页；1024×2048，只映射1024×1468，不拉伸；字号55px→约16CSSpx；mip/aniso4 | SRGB |
| 纸纤维底 | 程序生成1024×2048，缓存一次，不含太阳/外物阴影 | SRGB |
| 播放器 | 既有音频snapshot，512×256；复用原音频实例 | SRGB |
| 独立照片纸片 | 既有照片内容/只读用户照片、512²；原文件不改 | SRGB |
| reflection | 程序1024×512，缓存一次；原PMREM流程 | 输入SRGB、PMREM线性 |
| 原22张AO/lightMap | reference-baked目录逐字节保留，512/1024²；UV1；ImageBitmap禁止隐式色彩转换 | LinearSRGB；PNG gAMA1.0 |
| 验收PNG | 9基准、36四时刻×三机位×三尺寸、前后并排；仅docs，不进入生产包 | 显示用sRGB，不是lightMap |

单纹理边长不超2048，尺寸取2的幂；透明玻璃为真实几何/材质。没有网络图片或新字体库。复用原中文子集与系统字体回退，`document.fonts.ready`仍保留。投影页宽280–320CSSpx契约通过。实体尺寸详情仍见基础资产表和源几何。

## 动效自查

原镜头/焦距/光照lerp、320ms单页翻动、沿导轨抽屉、小幅轨道±18°/±8°及原手势全部保留。新增颗粒/暗角是静态显示处理，没有呼吸、风动或装饰动画。原reduced-motion实时监听、hidden停渲染、静止停RAF、雨雪数量三档及四级降档全部复验。布置骨架不新增拖动或持久化。

## 验证

返工前本次npm test271/0，返工后271/0；原scripts/test_*.mjs与断言未改。app tsc、build、oxlint exit0，旧警告不修。无依赖/锁文件变化，three仍0.180.0（第十七节）；3D懒加载块588.52kB、gzip155.76kB（含场景代码），相较上批gzip153.88kB增加约1.88kB。

WebGL2不可用、初始化失败、上下文丢失均回原2D且五入口可用；连续低帧完整阶梯：关阴影→DPR1→关粒子/风动→2D。相同输入的DOM搜索/字号/消息ID+偏移保存、布置进出不写聊天/记忆/照片、夜间唯一台灯、窗背向太阳无直射、static/hidden/reduced-motion均通过。满内容8照片/48星/5信/200雨/1024阴影：95 calls /52020 triangles，0 shader错误。

下表仅为云机SwiftShader软件渲染、DPR1、固定雨天与受控机位活动；不是手机性能结论。诊断中仅raw-FPS段固定画质，真实降级另行验证。

| 软件场景 | 场景fps | 整页fps |
|---|---:|---:|
| phone | 0.85 | 0.42 |
| desktop | 0.47 | 0.47 |
| integrated-phone | 0.93 | 0.93 |

真实中低端手机：待七七；6×CPU+机型模拟：项目方执行。本批没有冒充这两项来源，默认关闭和完整回落继续保留。

## 复现

全程仅既有Node、Chromium、Vite/three，不安装新工具依赖：

```sh
node scripts/screenshot_space3d.mjs --update-baselines
node scripts/screenshot_space3d.mjs
node scripts/capture_space3d_texture.mjs
node scripts/validate_space3d_texture.mjs
node scripts/validate_space3d_polish.mjs
node scripts/validate_space3d_runtime.mjs
node scripts/measure_space3d_texture.mjs --comparisons --output docs/space3d-validation/texture-rework/metrics.json public/space/space-desk.webp docs/space3d-validation/texture-rework/before/*.png docs/space3d-validation/baselines/*.png docs/space3d-validation/texture-rework/*-*-*.png docs/space3d-validation/texture-rework/finish-*.png
# 原固定场景的离线烘焙命令；本批固定几何未变，不重写旧PNG
node scripts/bake_space3d.mjs
```

指标脚本自动略过`*-comparison.png`，始终以原生场景PNG计算。本批完整输入列表和逐图结果保存在metrics.json；calibration-metrics.json复现了项目方旧值。36张PNG及manifest固定时间/天气/DPR；原生九图固定时刻保持六月正午以便前后同比。

## 顺手修（仅本批验收工具）

- 软件渲染桌面采样超过一分钟，夹具天气定时刷新把手动雨天改回晴天：开发夹具新增weather=63/cloud=75固定参数，性能脚本引用并新增“采样结束仍为雨天”断言。生产天气缓存、请求、开关均不改。见tools/space3d-visual/visual.tsx和scripts/validate_space3d_runtime.mjs。
- raw-FPS采样等待贴图前就设置诊断的固定画质标记，避免慢软件初始化先触发真实降档；采样异常用reject传播，避免只留下120sCDP超时。Page.bringToFront确保采样目标可见。生产默认降级没有关闭，原降级断言保留。
- 隐藏指标层后补双RAF排空合成绘制，再拷贝截图；原严格比较断言不改。此前抽屉复拍偶现顶部按钮边缘2像素/1色阶差异，失败日志保留。最终复拍结果在交付回执中写明，不掩盖。

## 任务外发现与保留边界

本批没有修数据、登录、聊天、同步等产品bug。既有lint/build警告、受保护photo-board.svg内嵌WEBP长度异常、最新main旧记忆日期格式测试失败的历史记录均不动。source与新基线的AGENTS.md逐字一致，依赖例外不重复登记。生产2D、旧素材、文案、上传/合并/去重、聊天/记忆写入、天气缓存与开关均无diff。未合并、未部署Eluvin正式站；私密评审预览沿用所有者先前的单独授权与访问范围。
