# 素材规格与色彩空间

three 精确锁定 **0.180.0**（r180）：固定 uv1/色彩空间 API 和 WebGL2 行为，阴影类型由同版本 radius 像素探针决定。只新增此运行时包；现有锁文件条目经逐项比较保持原样。没有 @types/three、R3F、SDF、物理引擎或 CDN。

## 程序化与内容贴图

| 文件/来源 | 尺寸 | 色彩空间 | 用途 |
|---|---|---|---|
| materials.js · wood color | 1024²，可重复 | SRGBColorSpace | 暖木 |
| materials.js · wood roughness / normal | 1024²，可重复 | NoColorSpace | 独立粗糙度/法线 |
| materials.js · wall / paper / linen color | 512²，可重复 | SRGBColorSpace | 墙、纸、亚麻；各自独立种子 |
| materials.js · wall / paper / linen roughness / normal | 512²，可重复 | NoColorSpace | 各自独立纹理与强度 |
| bookPages.ts · 当前两页 CanvasTexture | 1024×2048 | SRGBColorSpace | 仅映射 1024×1468 有效区，实体比例 0.30×0.43m |
| scene.js · 播放器屏幕 CanvasTexture | 512×256 | SRGBColorSpace | 复用现有播放快照；不新建音频 |
| scene.js · 用户照片重采样 CanvasTexture | 512²，有效区 512×354 | SRGBColorSpace | 原照片只读，UV 保留 .13×.09m 的比例；透明/纸边由 canvas alpha 表达 |

大摆件材质 512–1024，小摆件内容贴图 256–512；透明离线资产采用 PNG，不引入 JPEG 透明件。所有纹理尺寸取二的幂、单边不超过 2048；颜色与数据纹理分开，生成后缓存，不每帧重画。书页等待 fonts.ready，55px 物理字号、mipmap、LinearMipmapLinearFilter、anisotropy 4；复用现有 3.8KB 字体子集并允许系统中文字体回退。

## 入库烘焙 PNG（每个文件）

| 文件 | 尺寸 | 色彩空间 / PNG 编码 | UV |
|---|---|---|---|
| public/space3d/baked/desktop-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/desktop-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/desk-leg-front-left-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/desk-leg-front-right-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/desk-leg-back-left-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/desk-leg-back-right-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/drawer-left-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/drawer-right-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/drawer-back-ao.png | 512² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/back-wall-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/back-wall-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-bottom-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-bottom-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-top-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-top-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-back-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-back-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-front-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/window-wall-front-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/floor-ao.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |
| public/space3d/baked/floor-light.png | 1024² | LinearSRGBColorSpace / gAMA=1.0 | uv1 |

lightMap 全部线性编码，ImageBitmapLoader 使用 colorSpaceConversion:none 加载，禁止浏览器对 PNG 做隐式颜色转换，不按 sRGB 解码。AO 同样为线性数据。manifest.json 记录逐文件 SHA-256。只有固定墙、地板、桌面使用 lightMap；桌腿与抽屉固定接缝只有 512² AO。移动抽屉、信件、书、罐、播放器与照片板不进入烘焙。

## 生成与复现

运行环境：Node 24.19.0、本机 Chromium、npm ci 后的 Vite 与 three 0.180.0；没有额外构建期 npm 包。

```sh
node scripts/probe_space3d_shadow.mjs
node scripts/bake_space3d.mjs
node scripts/screenshot_space3d.mjs --update-baselines # 明确更新入库基准
node scripts/screenshot_space3d.mjs # 复拍并逐图比较 SHA，不覆盖基准
node scripts/validate_space3d_runtime.mjs
node scripts/validate_space3d_home.mjs
```

烘焙使用共享固定几何、只有环境光的离线场景：128² 低频采样、每点 12 条确定性半球 AO 射线、9 个漫射窗洞采样点，输出 1024² lightMap/墙地桌面 AO 与 512² 桌体 AO。毫米倒角用同尺寸实体代理做遮挡，保留窗洞与接缝。太阳与移动物体阴影均不参与。脚本清除浏览器 PNG 的 sRGB/ICC 标记，并写入 gAMA=1.0，像素值为线性强度。

截图使用纯合成文字，固定 2026-06-21T04:00:00Z、北京/Asia/Shanghai、晴/云量15%、DPR1、hardwareConcurrency=8、1024 阴影、reduced-motion。390×844、360×800、1280×800，各输出总览/阅读/抽屉。只在开发验证入口挂载组件，不修改生产登录与同意门。首次或显式 --update-baselines 输出 docs/space3d-validation/baselines；已有基准时默认复拍到临时目录并逐图比较 SHA。环境变量 SPACE3D_SCREENSHOT_DIR 可指定复拍目录，不能静默覆盖基准。工具与 fixtures 不进入生产包。

截图像素复现要求相同 Chromium、字体、操作系统与软件渲染后端；跨设备图像可能不同。manifest 记录浏览器版本和条件，真实性能必须分别报告。
