// 照片墙前端层 · 纯逻辑自测（TASK-UI-BATCH7，2026-09-10 乔定接口契约）
// 覆盖：等比缩放尺寸 / 图片 URL 拼接 / 本地缓存读写 / 本地+云端合并去重 / dataUrl 字节估算
// 跑法：node scripts/test_photowall.mjs
import {
  calcScaleSize,
  photoUrl,
  loadLocalPhotos,
  saveLocalPhotos,
  addLocalPhoto,
  mergePhotos,
  dataUrlBytes,
  photoKey,
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
const afterAdd = addLocalPhoto(photo('p3', 300), 's1')
ok(afterAdd.length === 3 && afterAdd[0].id === 'p3', 'addLocalPhoto 追加到最前')
ok(loadLocalPhotos('s1').length === 3, 'addLocalPhoto 持久化')
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

// ---- dataUrl 字节估算 ----
ok(dataUrlBytes('data:image/jpeg;base64,AAAA') === 3, 'base64 长度 ×0.75 估算（4 字符 → 3 字节）')
ok(dataUrlBytes('no-comma') === 8, '无逗号按全长度')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
