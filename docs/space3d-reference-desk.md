# 原桌面构图的真实 3D 重建

承接 PR #257，基准是项目所有者给出的原桌面参考图：左窗藤蔓、错落照片、带木盖的彩色折纸星星罐、立式播放器、近景打开的书和右侧抽屉。本批纠正陈设、比例与机位；没有把参考图作为背景、桌面纹理或整场景贴片。

## 几何与构图

- 桌面仍为 1.4×0.6m，高 0.75m、厚 0.03m；墙厚 0.14m、窗台 0.9m。左墙靠近桌边，背墙靠近桌后；窗洞仍由周围实体组成，玻璃不投不透明阴影。
- 总览为桌面近景，裁掉外围桌腿；阅读仍单页正面约 300 CSS px；抽屉机位跟随右侧的实体抽屉、底板、导轨和信件。
- 照片是 8 个独立、有 2mm 厚度的纸片几何，尺寸各异、错落旋转并直接贴墙；木钉是实例化圆柱。原背景里的猫、花与夕阳等装饰照片只采样其内部图案，分别重投影到各张纸片，纹理不含原墙、桌、光斑或摆件。已有用户照片只读覆盖对应纸片，装饰图案不新增照片记录、不计入照片档案；按物理纸片比例反向映射 512² 画布，原图片不拉伸。
- 罐体是旋转生成的双壁玻璃实体，木盖、陶瓷底与口沿各有厚度。最多 48 个实例化折纸星星有 3D 凹凸面及不同纸色，显示数量仍来自真实记忆。
- 播放器由立式框体与独立屏幕组成，屏幕纹理只读现有播放标题、进度和播放状态，复用原音频实例。
- 藤蔓使用曲线管状茎、曲面挤出的实体叶片和实例化颜色；花瓣、陶瓷花瓶、笔筒、铅笔、花盆、书签与架板均为真实几何。叶片投影，装饰按材质合批，生成一次。
- 书页仍是有厚度和 16 段横向分段的独立几何；文字分页、消息 ID+偏移、DOM 阅读与翻页链路不改。书签移到书脊处，避免遮挡正文。

## 资产与烘焙

固定窗墙位置改变后，新线性产物放在语义目录 public/space3d/reference-baked；原 public 素材、原 baked 目录及其 manifest 原样保留。没有 CDN、网络素材、运行时路径追踪、物理引擎、SDF 或新增依赖。three 精确版本仍为 0.180.0。

```sh
node scripts/bake_space3d.mjs
node scripts/validate_space3d_polish.mjs
node scripts/screenshot_space3d.mjs --update-baselines
node scripts/screenshot_space3d.mjs
node scripts/validate_space3d_runtime.mjs
node scripts/validate_space3d_shadow_calibration.mjs
```

烘焙只读取 buildFixedScene：固定桌体/接缝 AO，以及墙、地板、桌面的低频窗洞漫射 lightMap。新增装饰、移动抽屉、书、罐、播放器和照片不进入烘焙；太阳直射不参与。共 22 张 PNG，uv1，gAMA=1.0，manifest 逐文件记录 SHA-256。窗框运行时合批不影响离线实体遮挡。

| 来源 | 尺寸 | 色彩空间 |
| --- | --- | --- |
| 原 wood color / paper color / wall color / linen color / floor color | 512–1024²，可重复 | SRGBColorSpace |
| 原 normal / roughness | 512–1024²，可重复 | NoColorSpace |
| 原装饰打印照片 / 实际照片的纸片纹理 | 512² | SRGBColorSpace |
| 播放器屏幕纹理 | 512×256 | SRGBColorSpace |
| 聊天分页纹理 | 1024×2048，按实际页面 UV 裁切 | SRGBColorSpace |
| reference-baked/*-ao.png，固定桌体 | 512² | LinearSRGBColorSpace，线性 PNG |
| reference-baked/*-ao.png，墙/地/桌面 | 1024² | LinearSRGBColorSpace，线性 PNG |
| reference-baked/*-light.png | 1024² | LinearSRGBColorSpace，线性 PNG |
| 实体叶片、星星及装饰 vertex / instance color | 几何属性 | Three Color 从 sRGB 输入转换为线性 |
| 缓存的间接 reflectionCanvas / PMREM | 1024×512 / 渲染目标 | 输入 SRGBColorSpace，输出线性 |

## 验证与边界

本批基线实际 npm test 为 270 pass / 0 fail，新增真实几何契约测试后为 271 / 0；原 scripts/test_*.mjs 断言不改。npx tsc -b 与 npm run build 均通过。22 张新线性 PNG 的 manifest 两次完全一致；三机位 × 390×844 / 360×800 / 1280×800 九张图复拍 SHA-256 全部一致，0 页面错误、0 横向溢出。阅读投影页宽仍为 280–320 CSS px。

8 张用户照片、48 颗星、5 封信、200 雨粒子、1024 阴影下，98 draw calls / 52508 triangles，留 1–2 calls 给天气雾幕/闪电；实际雨雪位置在玻璃外、天空平面前。WebGL2 不可用、初始化失败、上下文丢失分别回到原 2D，五入口可用；全阶梯、静止停渲染、夜间唯一台灯投影、背向太阳无直射、DOM 搜索/字号/位置与布置骨架无内容写入全部复验。

软件渲染场景/整页 FPS：390×844 为 1.12 / 0.56；1280×800 为 0.50 / 0.50；实际 AISpace 390×844 为 1.21 / 0.60。报告是 Chromium SwiftShader，不是手机性能验收。详见 space3d-validation/reference-runtime.json 和 reference-budget.json。

软件渲染、6× CPU 机型模拟与真实手机分开报告，后两项仍按既定分工由项目方/七七执行。3D 默认关闭；完整阴影 → DPR1 → 粒子/风动关闭 → 原 2D 的阶梯继续保留。reduced-motion、隐藏页停止渲染与故障回落继续适用。

## 顺手修与任务外发现

无受保护链路或任务外产品修复。现有 2D 源码、原素材、登录/同意门、聊天/记忆写入、上传/合并/去重、天气缓存与依赖锁文件不改。

配套渲染修正：雨雪位于新窗玻璃外、天空平面前，诊断按实际坐标校验；ImageBitmapLoader 补显式 colorSpaceConversion:none，与既有注释及线性 PNG 编码一致。原 loader 注释声明关闭转换但选项未设置，本 PR 将其补齐。截图等待固定贴图、两页和照片均就绪，并以双 rAF 排空待绘制帧；原测试断言不改。

既有 CI 的目标过滤仅覆盖 main/sandbox，本堆叠 PR 的绿色结果是本地检查。私密预览使用明确标注的合成内容；晨光条件只在隔离预览固定冬日北京时间，正式 App 的城市时区/当前时间与实时天气行为不改。不合并 PR、不部署正式站。

任务外只读发现：既有 public/space/generated/photo-board.svg 内嵌 WEBP base64 长度为 13473，解码失败；该受保护文件原样保留。本批只读取原始 space-desk.webp 中打印照片的局部图案，不使用该 SVG，也不把原始全图贴入场景。所有原 public 文件逐字节核验：53 个均未改变。

几何自检补充：折纸星星的 20 个三角面均朝外，每顶点具备纸纹 UV；新增契约断言按面法线与体积中心校验。藤蔓的叶柄位于心形叶基部，木架倒角 3mm。

午后 512 阴影实测校准：原 bias -0.0001 / normalBias 0.002 / sun radius 2 在薄纸片接收面有自遮挡条纹，阴影开/关对照确认来源。调到 bias -0.0005 / normalBias 0.003 / sun radius 1 后条纹消失，保留窗框、藤蔓及物件的真实投影；仍使用锁定 r180 下实测有效的 PCFShadowMap。对照与生成脚本见 shadow-calibration 和上述命令，不把阴影烘进照片纹理。
