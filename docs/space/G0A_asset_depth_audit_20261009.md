# Space V2 G0-A · 素材表与桌面试绘门禁 (2026-10-09)

**基线**：PR #233 `fix/space-mobile-visual-baseline`，核对 HEAD `e683a6b5`。先读过 AGENTS.md。只登记，不覆盖已有 public/ 图片；不改 JS/CSS/后端/数据层、依赖、部署。

## 文件格式审计

- `public/space/layered/`：28 PNG + `room-closed.webp` + `room-cavity.webp` + manifest = 31 文件。
- 28 PNG 的 IHDR 均为 color type 6 (RGBA)，并核对图像尺寸和 Git blob 字节；**这不等于验证透明边缘质量**。
- `room-closed.webp`：1170×2080 / 153,958 B；`room-cavity.webp`：1170×2080 / 138,552 B。原始 864×1536 JPEG 衍生的底图不能算原生高清。
- manifest `enabled:true`，12 个必须预加载文件。资源可解码 ≠ 几何/遮挡/真机视觉通过。

## 逐件元数据

下表的可交互物件坐标来自现有 `src/styles/space.css`，对应同一 **941×1672** 世界平面的百分比交互矩形，**不是 alpha 轮廓，也未获得定稿视觉批准**。其余 22 件只给承托面分组，禁止编造具体坐标。

| PNG 物件 | 像素 | 字节 | 入口 | 表面/物理层 | CSS left,top,width,height |
|---|---:|---:|---|---|---|
| amber_flowers.png | 138×207 | 53871 | — | 桌面候选(未定位) | 未对位 |
| cat_ornament.png | 247×154 | 62698 | — | 桌面候选(未定位) | 未对位 |
| ceramic_mug.png | 169×156 | 44631 | — | 桌面候选(未定位) | 未对位 |
| ceramic_tray.png | 261×137 | 60876 | — | 桌面候选(未定位) | 未对位 |
| drinking_glass.png | 135×216 | 62400 | — | 桌面候选(未定位) | 未对位 |
| glass_memory_jar.png | 212×305 | 119255 | desk | 5 | (19%, 47%, 27%, 19%) |
| hanging_plant.png | 224×488 | 207451 | — | 墙/花架；背景烘焙藤叶 | 未对位 |
| knit_blanket.png | 272×191 | 110881 | — | 桌前；背景已有椅子/毯子 | 未对位 |
| leafy_vine.png | 107×207 | 42850 | — | 墙/花架；背景烘焙藤叶 | 未对位 |
| open_book.png | 480×223 | 159696 | desk | 4 | (14%, 66%, 73%, 19%) |
| open_drawer.png | 359×249 | 140609 | cabinet/front | 7 | (48%, 82%, 55%, 17%) |
| origami_blue.png | 113×112 | 21105 | — | 罐内/折纸 | 未对位 |
| origami_coral.png | 81×105 | 15300 | — | 罐内/折纸 | 未对位 |
| origami_pink.png | 112×111 | 19630 | — | 罐内/折纸 | 未对位 |
| origami_purple.png | 114×112 | 20356 | — | 罐内/折纸 | 未对位 |
| origami_red_pattern.png | 90×109 | 18813 | — | 罐内/折纸 | 未对位 |
| origami_yellow.png | 116×112 | 20826 | — | 罐内/折纸 | 未对位 |
| photo_wall_board.png | 373×358 | 266820 | wall | 3 | (29%, 10%, 59%, 29%) |
| right_potted_plant.png | 299×371 | 198605 | — | 桌面右侧；背景已有盆栽 | 未对位 |
| stacked_books.png | 221×224 | 75432 | — | 桌面候选(未定位) | 未对位 |
| stationery_holder.png | 135×227 | 62988 | — | 桌面候选(未定位) | 未对位 |
| table_lamp.png | 173×200 | 43674 | — | 桌面候选(未定位) | 未对位 |
| tablet_player.png | 337×222 | 82979 | desk | 6 | (54%, 51.5%, 40%, 15%) |
| tied_letters.png | 262×160 | 84871 | — | 抽屉/桌面待核 | 未对位 |
| white_flowers.png | 146×204 | 55980 | — | 桌面候选(未定位) | 未对位 |
| wired_earphones.png | 294×192 | 96352 | desk | 7 | (69%, 60%, 24%, 10%) |
| wood_picture_frame.png | 194×223 | 60317 | — | 桌面候选(未定位) | 未对位 |
| woven_chair.png | 224×237 | 99074 | — | 桌前；背景已有椅子/毯子 | 未对位 |

### 已挂载层的深度/接触阴影要求

| Sprite | CSS z | 世界平面矩形 px（x,y,w,h） | 阴影与遮挡 |
|---|---:|---|---|
| photo_wall_board.png | 6 | (272.9, 167.2, 555.2, 484.9) | photos |
| glass_memory_jar.png | 5 | (178.8, 785.8, 254.1, 317.7) | jar |
| open_book.png | 4 | (131.7, 1103.5, 686.9, 317.7) | book |
| tablet_player.png | 6 | (508.1, 861.1, 376.4, 250.8) | player |
| open_drawer.png | 6 | (451.7, 1371.0, 517.5, 284.2) | weekly_letter |
| wired_earphones.png | 7 | (649.3, 1003.2, 225.8, 167.2) | none |

**烘焙遮挡门**：`room-closed.webp` 和 `room-cavity.webp` 中仍可见垂藤、右盆栽、椅子/毯子。使用相应 PNG 运动前必须把背景里的重影问题解决；空腔态不能叠两层柜体。

## 桌面局部高清试绘结果：**FAIL**

独立产出一张 1133×1388 的高清美术尝试，但试绘引入了**圆形抽屉把手和不同柜体结构/桌沿厚度/木纹**，未守住 941×1672 的画面视觉结构，因此只作为废案对照，**不作为任何 public 资源提交，不改变 manifest，不修改 AISpace**。

### 尚未通过的门禁

- 941×1672 的可编辑定稿文件未取得，无法精确相同裁切/像素 diff。
- 本环境无法 clone 仓库运行 `npm test`/`npm run build`，本轮仅做 GitHub 资产头/源码检查。
- 未做真实已登录 App 390×844、0 console/pageerror/横溢以及同条件 PR #233 性能 A/B。
- **不进入 G0-B**；PR 保持 Draft，不合并、不部署。
