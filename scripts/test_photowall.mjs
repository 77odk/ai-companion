// 照片墙前端层 · 纯逻辑自测（TASK-UI-BATCH7，2026-09-10 乔定接口契约）
// 覆盖：等比缩放尺寸 / 图片 URL 拼接 / 本地缓存读写 / 本地+云端合并去重 / dataUrl 字节估算
// 跑法：node scripts/test_photowall.mjs
import {
  calcScaleSize,
  photoUrl,
  loadLocalPhotos,
  saveLocalPhotos,
  saveLocalPhotoMetadata,
  addLocalPhoto,
  removeLocalPhoto,
  mergePhotos,
  dataUrlBytes,
  photoKey,
  normalizePhotoListData,
} from '../src/lib/photoWall.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

// 简易 localStorage mock（Node 无 localStorage）
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
}

function photo(id, createdAt, extra = {}) {
  return { id, sessionId: 's1', width: 800, height: 600, createdAt, ...extra }
}

// ---- 等比缩放 ----
ok(JSON.stringify(calcScaleSize(800, 600)) === '{"width":800,"height":600}', '小图（≤1024）不放大')
ok(JSON.stringify(calcScaleSize(2048, 1024)) === '{"width":1024,"height":512}', '超限等比缩放（横向）')
ok(JSON.stringify(calcScaleSize(1024, 3072)) === '{"width":341,"height":1024}', '超限等比缩放（纵向）')
ok(JSON.stringify(calcScaleSize(1024, 1024)) === '{"width":1024,"height":1024}', '恰好等于上限保持')
ok(JSON.stringify(calcScaleSize(0, 500)) === '{"width":1,"height":500}', '0 宽兜底为 1')
ok(calcScaleSize(5000, 2500, 800).width <= 800, '自定义 maxSide=800 生效')

// ---- 图片 URL ----
ok(
  photoUrl('abc_123', 'tok en') === 'https://api.eluvin.space/api/photos/abc_123?token=tok%20en',
  'photoUrl 带 token 且 encodeURIComponent',
)
ok(
  photoUrl('abc/def') === 'https://api.eluvin.space/api/photos/abc%2Fdef',
  'photoUrl 无 token 也编码 id',
)

// ---- 本地缓存读写 ----
ok(loadLocalPhotos('s1').length === 0, '空缓存读空')
saveLocalPhotos([photo('p1', 100), photo('p2', 200)], 's1')
const loaded = loadLocalPhotos('s1')
ok(loaded.length === 2 && loaded[0].id === 'p1', '写入后读回')
ok(photoKey('s2') === 'ai_space_photos_s2' && photoKey(undefined) === 'ai_space_photos_global', '会话隔离 key')
ok(loadLocalPhotos('s2').length === 0, '会话隔离：s2 读不到 s1')
saveLocalPhotoMetadata([photo('cloud-1', 400, { dataUrl: 'data:image/jpeg;base64,AAAA' })], 'cloud-s1')
const cachedMeta = loadLocalPhotos('cloud-s1')
ok(cachedMeta.length === 1 && cachedMeta[0].id === 'cloud-1', '登录用户元数据可本地缓存')
ok(cachedMeta[0].dataUrl === undefined, '登录用户本地缓存不长期保存 dataUrl')
saveLocalPhotoMetadata([
  photo('placed-1', 410, { scenePlacement: { x: 22, y: 31, rotate: -4 } }),
], 'placed-s1')
const placedMeta = loadLocalPhotos('placed-s1')
ok(placedMeta[0]?.scenePlacement?.x === 22 && placedMeta[0]?.scenePlacement?.y === 31, '空间页自定义摆放复用现有照片缓存')
const afterAdd = addLocalPhoto(photo('p3', 300), 's1')
ok(afterAdd.length === 3 && afterAdd[0].id === 'p3', 'addLocalPhoto 追加到最前')
ok(loadLocalPhotos('s1').length === 3, 'addLocalPhoto 持久化')
const afterRemove = removeLocalPhoto('p2', 's1')
ok(afterRemove.length === 2 && afterRemove.every((p) => p.id !== 'p2'), 'removeLocalPhoto 只删除指定照片')
ok(loadLocalPhotos('s1').every((p) => p.id !== 'p2'), 'removeLocalPhoto 持久化删除结果')
mem.set('ai_space_photos_s1', '{bad json')
ok(loadLocalPhotos('s1').length === 0, '损坏 JSON 读空')

// ---- 本地 + 云端合并 ----
const local = [photo('p1', 100), photo('p2', 200)]
const cloud = [photo('p2', 200), photo('p3', 300)]
const merged = mergePhotos(local, cloud)
ok(merged.length === 3, '合并去重后 3 条')
ok(merged[0].id === 'p3' && merged[2].id === 'p1', '合并后 createdAt 倒序')
// 云端照片 + 本地同 id 有 dataUrl → 保留本地 dataUrl（游客本地图登录后不丢）
const localWithData = [photo('p9', 100, { dataUrl: 'data:image/jpeg;base64,xx' })]
const cloudNoData = [photo('p9', 100)]
const merged2 = mergePhotos(localWithData, cloudNoData)
ok(merged2.length === 1 && merged2[0].dataUrl === 'data:image/jpeg;base64,xx', '本地 dataUrl 在合并后保留')
// 云端覆盖同 id 尺寸（以云端为准）
const merged3 = mergePhotos([photo('p5', 100, { width: 10 })], [photo('p5', 100, { width: 800 })])
ok(merged3[0].width === 800, '同 id 云端信息优先')
const mergedPlacement = mergePhotos(
  [photo('placed-cloud', 120, { scenePlacement: { x: 61, y: 44, rotate: 3 } })],
  [photo('placed-cloud', 120, { width: 1200 })],
)
ok(mergedPlacement[0].scenePlacement?.x === 61, '云端元数据刷新不覆盖本机空间摆放')

// ---- 云端列表边界校验 ----
ok(normalizePhotoListData({ photos: [] })?.photos.length === 0, '合法空 photos 数组正常通过')
ok(normalizePhotoListData({ photos: null }) == null, 'photos=null 按畸形响应拒绝')
ok(normalizePhotoListData({}) == null, '缺 photos 字段按畸形响应拒绝')
ok(normalizePhotoListData({ photos: 'bad' }) == null, 'photos 非数组按畸形响应拒绝')
ok(normalizePhotoListData({ photos: [{ id: 'p1' }] }) == null, '畸形照片项整体拒绝')
const normalizedCloud = normalizePhotoListData({
  photos: [{ id: 'p1', sessionId: 's1', width: 800, height: 600, createdAt: '2026-09-28T12:00:00+08:00' }],
})
ok(typeof normalizedCloud?.photos[0]?.createdAt === 'number' && normalizedCloud.photos[0].createdAt > 0, '云端 createdAt 字符串在数据层归一成时间戳')

// ---- 组件接线契约 ----
const { readFileSync } = await import('node:fs')
const aiSpaceSource = readFileSync(new URL('../src/components/AISpace.tsx', import.meta.url), 'utf8')
const archiveSource = readFileSync(new URL('../src/components/PhotoWallArchive.tsx', import.meta.url), 'utf8')
const photoWallSource = readFileSync(new URL('../src/lib/photoWall.ts', import.meta.url), 'utf8')
ok(aiSpaceSource.includes('setPhotos(local)'), '切换 session 先切回该 session 本地照片，不沿用上一角色')
ok(aiSpaceSource.includes('saveLocalPhotoMetadata(next, sid)'), '上传/云端合并后缓存登录用户元数据')
ok(aiSpaceSource.includes('dataUrl: scaled.dataUrl'), '上传成功后先用本地压缩图即时展示')
ok(aiSpaceSource.includes('await deletePhoto(token, photo.id)'), '登录照片先确认云端删除成功再移出界面')
ok(aiSpaceSource.includes('removeLocalPhoto(photo.id, sid)'), '游客照片删除会同步移出本地缓存')
ok(archiveSource.includes("window.confirm('确定删除这张照片吗？删除后无法恢复。')"), '照片删除有明确二次确认')
ok(archiveSource.includes("deletingId === sorted[selectedIndex].id ? '删除中…' : '删除'"), '删除按钮有进行中状态，避免重复提交')
ok(aiSpaceSource.includes('照片暂时没加载出来，稍后再试。'), '列表读取失败不再静默伪装空墙')
ok(aiSpaceSource.includes("const PHOTO_IMAGE_LOAD_ERROR = '有照片暂时没显示出来，照片还在，稍后再试。'"), '单图加载失败文案集中维护')
ok(aiSpaceSource.includes('setPhotoError((current) => current === PHOTO_IMAGE_LOAD_ERROR ? current : null)'), '列表/上传成功不会覆盖已发生的图片加载失败提示')
ok(photoWallSource.includes('normalizePhotoListData'), '云端照片列表校验下沉到 photoWall 数据层')
ok(photoWallSource.includes("message: '照片列表格式异常，请稍后再试'"), '畸形 200 响应被数据层转换成失败结果')
ok(photoWallSource.includes("method: 'DELETE'"), '云端照片删除使用现有照片资源 DELETE 契约')
ok(archiveSource.includes("loading={index < 6 ? 'eager' : 'lazy'}"), '首屏前 6 张 eager，其余 lazy，避免 12 张同时抢加载')
ok(archiveSource.includes("const retryDelays = [350, 1200, 2500]"), '云端图片瞬时失败会做有限退避重试')
ok(archiveSource.includes("_retry=${Date.now()}"), '图片重试绕过失败缓存，不改原照片地址')
ok(archiveSource.includes('onPhotoLoadError?.(photo)'), '重试后仍失败才回传错误状态')
ok(archiveSource.includes('onPhotoLoadSuccess?.(photo)'), '图片恢复后会回传成功状态')
ok(aiSpaceSource.includes('failedPhotoIdsRef.current.delete(photo.id)'), '图片恢复会移出失败集合')
ok(aiSpaceSource.includes('failedPhotoIdsRef.current.size === 0'), '全部失败图片恢复后才清掉全局提示')
ok(archiveSource.includes('const preview = sorted.slice(0, 12)'), '首页照片墙预览最多 12 张')
ok(archiveSource.includes('style={previewStyle(photo, index, preview.length)}'), '首页预览使用确定性散开样式')
ok(!archiveSource.includes('index % 5'), '首页预览不再按 5 个槽位循环重叠')
ok(!archiveSource.includes('Math.random()'), '首页预览刷新后位置稳定，不使用随机布局')
ok(archiveSource.includes('className="photo-archive-empty" onClick={() => setArchiveOpen(true)}'), '空照片墙从空间先进入照片墙，不直接触发添加')
ok(aiSpaceSource.includes("openDeskObject('photos', openPhotoWall)"), '空间照片墙只负责进入照片墙')
ok(aiSpaceSource.includes('scenePhotoDragRef'), '空间照片支持直接拖动自定义摆放')
ok(aiSpaceSource.includes('persistScenePhotoPlacements'), '自定义摆放写回现有照片缓存')
ok(photoWallSource.includes('scenePlacement?: PhotoScenePlacement'), '照片元数据允许保存可选空间摆放')
ok(photoWallSource.includes('prev?.scenePlacement'), '云端照片刷新时保留本机自定义摆放')
ok(archiveSource.includes('onClick={() => setArchiveOpen(true)}'), '空照片墙先进入照片墙，不在空间页直接弹选择器')
ok(aiSpaceSource.includes('scenePhotoDragRef'), '空间页照片支持拖动摆放')
ok(aiSpaceSource.includes('persistScenePhotoPlacements'), '空间页照片摆放会持久化')
ok(aiSpaceSource.includes('if (drag.moved) finishScenePhotoDrag()'), '拖动照片只做摆放')
ok(aiSpaceSource.includes('openPhotoWallFromScene()'), '轻点空间页照片仍会进入照片墙')

// ---- dataUrl 字节估算 ----
ok(dataUrlBytes('data:image/jpeg;base64,AAAA') === 3, 'base64 长度 ×0.75 估算（4 字符 → 3 字节）')
ok(dataUrlBytes('no-comma') === 8, '无逗号按全长度')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
