# PR #233 本轮已登录 App / 非空内容检查

凭据只留在乔本地；不开正式门、不发布候选、不修改后端。先更新到 PR 最新 HEAD，
重新构建本地评审包，不能沿用 55ab4d4c / aaf7ca1 的旧服务。

## 启动

沿用乔已验证的本地登录方式，详细说明见
[原执行命令](V2_qiao_review_commands_20261010.md)。无需导出或传来任何账号文件。

```bash
git switch fix/space-mobile-visual-baseline
git pull --ff-only origin fix/space-mobile-visual-baseline
git rev-parse HEAD
npm run build
node scripts/space_v2_app_review.mjs --serve
```

服务仅在 localhost:5173。源码/打包 manifest 两门仍 false，页面显示未签收。

## 新增详情预检

在原 G1 命令上加 `--details`。例如已有专用测试浏览器的本地调试端口为 9222：

```bash
mkdir -p /tmp/eluvin-native-detail-233
python3 scripts/g1_space_mobile_smoke.py \
  --url http://localhost:5173 \
  --cdp-url http://localhost:9222 \
  --details \
  --screenshots /tmp/eluvin-native-detail-233/screens \
  > /tmp/eluvin-native-detail-233/g1-result.json
```

端口请用乔自己的实际本地端口。也可沿用已有本地临时登录态的运行方式，仅加
`--details`；不新建/导出/提交凭据。三种登录方式不能组合使用。

每档先查整房间，再进罐子、播放器并通过真实 App 返回空间。空音乐库只打开文件
选择器，不选择文件；不启动/暂停播放、不改音量、不写内容。
JSON 的 sourceCommit/servedBuildVersion 应匹配本次最新 HEAD；状态仍是
UNAPPROVED_LAYERED_REVIEW_SMOKE_ONLY，不作为美术批准。
details 应记录 nativeFocus=true、破图 0、场景铺满、播放器 projectedScreen=true、
returnedToSpace=true。截图应各包含房间/罐子/播放器，共 9 张。

## 在已有真实内容上手动回归

| 检查 | 执行与记录 |
| --- | --- |
| 返回与状态 | 各物件进出两次；确认真实 App 的历史返回没有跳错页，空间位置、播放状态恢复正常。 |
| 已存照片 | 查看原有照片；拖动一张专用账号照片后刷新/重开，确认位置保留。只操作专用测试账号，记录前后位置；不上传示例照片填满画面。 |
| 非空记忆 | 抽取一颗星星，打开后与已有真实记忆逐字核对，折回后再抽取；内容不丢、星星不越过玻璃。私密正文不放公开报告。 |
| 非空思绪 | 既有内容向前/向后翻页，首尾页与快速翻页；检查纸张遮挡、接缝、文字顺序及返回后内容。没有内容就记未验收。 |
| 真实音乐 | 在乔已有且授权使用的本地音乐上播放、暂停、切曲、拖进度、调音量、切模式；检查屏幕和耳机位置、触摸命中、离开/返回状态。G1 本身不替你选择文件。 |
| 已存书信 | 看已有书信并返回；检查抽屉 0/25/50/75/100% 和短拉回弹。不触发生成以补齐空账号。 |
| 天气 | 只在已有同意、真实天气状态有效时观察；没有有效信号应是中性。不要造天气或改后端。 |
| 实体手机 | 若已有授权本地评审通路，记录机型、系统、浏览器，检查触摸、动画卡顿、切后台/恢复、横向溢出。没有通路标未验收；不为测试改白名单或发布站点。 |

各项写通过 / 失败 / 未验收及原因，不把空账号入口通过等同非空业务通过。
含真实内容的截图只在本地审查或通过已有私下附件途径返回，不公开提交 GitHub。
回传 JSON、必要截图/录屏、各项结果即可，凭据不出口。结束关闭本地评审服务。
