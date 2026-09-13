// UI2-03 PATCH-01 · Source Traceability Closure 测试
// 覆盖（任务书测试清单）：
//   1. 20+ 字用户原话完整保存，不截断
//   2. source 含换行/中文/英文 round-trip
//   3. taReply round-trip
//   4. old backend Memory 无 source/taReply 正常读取
//   5. post → reload/cloud read → merge 后 source/taReply 仍存在（含换设备：本地缓存为空）
//   6. session A/B 不串
//   7. 去重命中不破坏现有语义
//   8. postMemory payload：source/taReply 有值才带；空不带

import { upsertMemoryCache, getMemoriesCache, saveMemoriesCache, reconcileMemoryCacheId, mergeSessionMemories, sessionMemoryToItem } from '../src/lib/sessionStore.ts'
import { postMemory } from '../src/lib/sessionApi.ts'

// ---- Node mock：storage / fetch ----
const memStore = new Map()
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => memStore.set(k, String(v)),
  removeItem: (k) => memStore.delete(k),
  clear: () => memStore.clear(),
}
globalThis.window = { dispatchEvent: () => {} }
function resetStore() {
  memStore.clear()
}

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
function dateOf(y, m, d) {
  return new Date(y, m - 1, d, 12, 0, 0).toISOString()
}

// ---- fetch mock：捕获 postMemory 请求并回显后端（模拟后端持久化 + 回显） ----
const captures = []
let echoBackend = true
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url)
  const method = String(opts.method ?? 'GET')
  if (u.includes('/api/sessions/') && u.includes('/memories') && method === 'POST') {
    const body = JSON.parse(String(opts.body ?? '{}'))
    captures.push({ url: u, body })
    if (!echoBackend) return { ok: false, status: 500, json: async () => ({ error: 'mock down' }) }
    // 后端回显：echo 请求里的 source/taReply（模拟未来后端持久化并返回）
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 900 + captures.length,
        content: body.content,
        createdAt: dateOf(2026, 9, 13),
        ...(body.source ? { source: body.source } : {}),
        ...(body.taReply ? { taReply: body.taReply } : {}),
      }),
    }
  }
  return { ok: true, status: 200, json: async () => ({}) }
}

const LONG_SOURCE = '都一个多小时了你还在刷牙吗你怎么不看时间呀我就一直等着呢'
check('前置：长原话 > 20 字', LONG_SOURCE.length > 20, `len=${LONG_SOURCE.length}`)

console.log('\n[1] source 不截断：40+ 字原话完整保存')
{
  resetStore()
  captures.length = 0
  const item = upsertMemoryCache('sess-1', '喜欢话梅味的排骨', LONG_SOURCE, '饮食', true, '那我明天试着给你做一份尝尝。')
  check('缓存保存完整原话（=传入长度）', item?.source === LONG_SOURCE, `got len=${item?.source?.length}`)
  check('缓存完整原话长度正确', item?.source?.length === LONG_SOURCE.length)
  const cached = getMemoriesCache('sess-1')
  check('重读缓存仍是完整原话', cached[0]?.source === LONG_SOURCE)
}

console.log('\n[2] source 含换行/中文/英文 round-trip（后端回显 → sessionMemoryToItem）')
{
  const mixed = '第一行中文\nSecond line with English words\n第三行，标点：。！？'
  const item = sessionMemoryToItem({ id: 5, content: '测试记忆', createdAt: dateOf(2026, 9, 1), source: mixed })
  check('换行/中英 source 完整恢复', item.source === mixed, JSON.stringify(item.source))
}

console.log('\n[3] taReply round-trip')
{
  const item = sessionMemoryToItem({ id: 6, content: '测试记忆', createdAt: dateOf(2026, 9, 1), source: '原话', taReply: '那我给你做一份。' })
  check('taReply 完整恢复', item.taReply === '那我给你做一份。')
  check('source 同步恢复', item.source === '原话')
}

console.log('\n[4] old backend Memory 无 source/taReply 正常读取')
{
  const item = sessionMemoryToItem({ id: 7, content: '旧记忆', createdAt: dateOf(2025, 11, 3) })
  check('旧记录可读', item.id === '7' && item.text === '旧记忆')
  check('source 缺省 undefined', item.source === undefined)
  check('taReply 缺省 undefined', item.taReply === undefined)
  check('createdAt 解析正常', item.createdAt === Date.parse(dateOf(2025, 11, 3)))
}

console.log('\n[5] post → cloud read → merge：source/taReply 跨设备保留')
{
  resetStore()
  captures.length = 0
  // 设备 A：本机会话写入 + 上传
  const item = upsertMemoryCache('sess-1', '喜欢话梅味的排骨', LONG_SOURCE, '饮食', true, '那我明天试着给你做一份尝尝。')
  const res = await postMemory('tok', 'sess-1', {
    content: '喜欢话梅味的排骨',
    ...(item.source ? { source: item.source } : {}),
    ...(item.taReply ? { taReply: item.taReply } : {}),
  })
  check('postMemory 成功', res.ok === true)
  check('POST payload 含完整 source（不截断）', captures[0]?.body?.source === LONG_SOURCE, `len=${captures[0]?.body?.source?.length}`)
  check('POST payload 含 taReply', captures[0]?.body?.taReply === '那我明天试着给你做一份尝尝。')
  if (res.ok) reconcileMemoryCacheId('sess-1', item.id, res.data.id)

  // 设备 B（换设备/清缓存）：只从后端拉回
  const backendItem = { id: res.data.id, content: '喜欢话梅味的排骨', createdAt: res.data.createdAt, source: res.data.source, taReply: res.data.taReply }
  const cloudItem = sessionMemoryToItem(backendItem)
  const merged = mergeSessionMemories([], [cloudItem])
  check('换设备：cloud source 保留', merged[0]?.source === LONG_SOURCE)
  check('换设备：cloud taReply 保留', merged[0]?.taReply === '那我明天试着给你做一份尝尝。')

  // 本机场景：本地缓存有增强字段 + 后端回显 → 也不丢
  const mergedLocal = mergeSessionMemories(getMemoriesCache('sess-1'), [cloudItem])
  check('本机：本地+后端合并后 source 保留', mergedLocal[0]?.source === LONG_SOURCE)
  check('本机：本地+后端合并后 taReply 保留', mergedLocal[0]?.taReply === '那我明天试着给你做一份尝尝。')
}

console.log('\n[6] session A/B 不串（postMemory payload 各自正确）')
{
  resetStore()
  captures.length = 0
  const a = upsertMemoryCache('sess-a', '用户每周三调休', '周三我想调休一天', '工作', true, '好，周三留给你。')
  const b = upsertMemoryCache('sess-b', '用户不喜欢太甜的东西', '我不喜欢特别甜的', '饮食', true, undefined)
  await postMemory('tok', 'sess-a', { content: '用户每周三调休', source: a.source, taReply: a.taReply })
  await postMemory('tok', 'sess-b', { content: '用户不喜欢太甜的东西', source: b.source })
  const pa = captures.find((c) => c.url.includes('/sessions/sess-a'))
  const pb = captures.find((c) => c.url.includes('/sessions/sess-b'))
  check('A payload source/taReply 正确', pa?.body?.source === '周三我想调休一天' && pa?.body?.taReply === '好，周三留给你。')
  check('B payload source 正确', pb?.body?.source === '我不喜欢特别甜的')
  check('B payload 无 taReply（空不带）', pb?.body?.taReply === undefined)
  check('A/B 请求路径隔离', !!pa && !!pb)
}

console.log('\n[7] 去重命中不破坏现有语义')
{
  resetStore()
  captures.length = 0
  const first = upsertMemoryCache('sess-1', '喜欢话梅味的排骨', '原话A', '饮食', true, '回应A')
  const dup = upsertMemoryCache('sess-1', '喜欢话梅味的排骨', '原话B', undefined, undefined, '回应B')
  check('重复文本不新增', dup === null)
  const cached = getMemoriesCache('sess-1')
  check('仍只有 1 条', cached.length === 1)
  check('原条 source/taReply 未被破坏', cached[0]?.source === '原话A' && cached[0]?.taReply === '回应A')
  check('createdAt 未变', cached[0]?.createdAt === first?.createdAt)
}

console.log('\n[8] payload：source/taReply 空值不带键')
{
  resetStore()
  captures.length = 0
  const item = upsertMemoryCache('sess-1', '没有来源的记忆', undefined, undefined, true, undefined)
  await postMemory('tok', 'sess-1', { content: '没有来源的记忆' })
  const payload = captures[0]?.body ?? {}
  check('payload 无 source 键', !('source' in payload), JSON.stringify(payload))
  check('payload 无 taReply 键', !('taReply' in payload), JSON.stringify(payload))
  check('payload 有 content', payload.content === '没有来源的记忆')
}

console.log(`\n结果: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
