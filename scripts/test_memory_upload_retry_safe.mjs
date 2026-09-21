// #20 · memoryUploadRetry 专项测试：pendingSync 驱动、安全去重、删除不复活、并发防重入。
import assert from 'node:assert/strict'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}
globalThis.window = { dispatchEvent() {} }
globalThis.Event = class Event { constructor(type) { this.type = type } }

const { retryPendingMemoryUploads } = await import('../src/lib/memoryUploadRetry.ts')
const { getMemoriesCache, saveMemoriesCache } = await import('../src/lib/sessionStore.ts')

const SID = '69'
const TS = Date.parse('2026-09-21T06:00:00.000Z')
const cloudMemory = (id, content = '记住这件事', offsetMs = 1000) => ({
  id,
  content,
  createdAt: new Date(TS + offsetMs).toISOString(),
  source: '这是我的原话',
  taReply: '好，我记住了。',
})
const localMemory = () => ({
  id: 'local-memory-1',
  text: '记住这件事',
  createdAt: TS,
  source: '这是我的原话',
  taReply: '好，我记住了。',
  pendingSync: true,
})

function reset() {
  store.clear()
  saveMemoriesCache(SID, [localMemory()])
}

let requests = []
let handler = async () => {
  throw new Error('fetch handler not set')
}
globalThis.fetch = async (url, init = {}) => {
  const req = { url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null }
  requests.push(req)
  return handler(req)
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

console.log('\n[1] 云端已存在唯一同一条：只对账，不 POST')
reset()
requests = []
handler = async (req) => {
  assert.equal(req.method, 'GET')
  return json({ memories: [cloudMemory(88)] })
}
let result = await retryPendingMemoryUploads('token', SID)
assert.equal(result.reconciled, 1)
assert.equal(result.uploaded, 0)
assert.equal(requests.length, 1)
assert.equal(getMemoriesCache(SID)[0].id, '88')
assert.equal(getMemoriesCache(SID)[0].pendingSync, true, '对账后暂留 pendingSync，等下一次新鲜 hydration 清')

console.log('\n[2] 两次云端确认都没有：才 POST，并保留追溯字段')
reset()
requests = []
let getCount = 0
handler = async (req) => {
  if (req.method === 'GET') {
    getCount += 1
    return json({ memories: [] })
  }
  assert.equal(req.method, 'POST')
  assert.deepEqual(req.body, {
    content: '记住这件事',
    source: '这是我的原话',
    taReply: '好，我记住了。',
  })
  return json(cloudMemory(99))
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(getCount, 2, 'POST 前必须二次拉云端')
assert.equal(result.uploaded, 1)
assert.equal(requests.filter((r) => r.method === 'POST').length, 1)
assert.equal(getMemoriesCache(SID)[0].id, '99')
assert.equal(getMemoriesCache(SID)[0].pendingSync, true)

console.log('\n[3] 第二次确认时另一设备已经补上：不再 POST')
reset()
requests = []
getCount = 0
handler = async (req) => {
  assert.equal(req.method, 'GET')
  getCount += 1
  return json({ memories: getCount === 1 ? [] : [cloudMemory(101)] })
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(getCount, 2)
assert.equal(result.reconciled, 1)
assert.equal(result.uploaded, 0)
assert.equal(requests.some((r) => r.method === 'POST'), false)
assert.equal(getMemoriesCache(SID)[0].id, '101')

console.log('\n[4] 云端出现多个候选：不猜、不 POST，留待下次')
reset()
requests = []
handler = async (req) => {
  assert.equal(req.method, 'GET')
  return json({ memories: [cloudMemory(201, '记住这件事', 1000), cloudMemory(202, '记住这件事', 2000)] })
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(result.ambiguous, 1)
assert.equal(requests.length, 1)
assert.equal(getMemoriesCache(SID)[0].id, 'local-memory-1')
assert.equal(getMemoriesCache(SID)[0].pendingSync, true)

console.log('\n[5] 补传开始前本地已删除：绝不 POST')
reset()
requests = []
getCount = 0
handler = async (req) => {
  assert.equal(req.method, 'GET')
  getCount += 1
  if (getCount === 2) saveMemoriesCache(SID, [])
  return json({ memories: [] })
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(requests.filter((r) => r.method === 'POST').length, 0)
assert.deepEqual(getMemoriesCache(SID), [])
assert.ok(result.skipped >= 1)

console.log('\n[6] POST 在途时本地被删：成功后 best-effort 删除刚创建的服务端行，不回写本地')
reset()
requests = []
handler = async (req) => {
  if (req.method === 'GET') return json({ memories: [] })
  if (req.method === 'POST') {
    saveMemoriesCache(SID, [])
    return json(cloudMemory(303))
  }
  assert.equal(req.method, 'DELETE')
  assert.match(req.url, /\/api\/memories\/303$/)
  return json({ ok: true })
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(requests.filter((r) => r.method === 'POST').length, 1)
assert.equal(requests.filter((r) => r.method === 'DELETE').length, 1)
assert.deepEqual(getMemoriesCache(SID), [])

console.log('\n[7] 没有 pendingSync：零请求')
store.clear()
saveMemoriesCache(SID, [{ ...localMemory(), pendingSync: undefined }])
requests = []
handler = async () => { throw new Error('不该请求') }
result = await retryPendingMemoryUploads('token', SID)
assert.equal(requests.length, 0)
assert.equal(result.uploaded, 0)
assert.equal(result.reconciled, 0)

console.log('\n[8] 已对账成 server id 后，即使 server createdAt 与本地相差数小时，也只认 id 不重复 POST')
store.clear()
saveMemoriesCache(SID, [{ ...localMemory(), id: '404', pendingSync: true }])
requests = []
handler = async (req) => {
  assert.equal(req.method, 'GET')
  return json({ memories: [cloudMemory(404, '记住这件事', 6 * 60 * 60 * 1000)] })
}
result = await retryPendingMemoryUploads('token', SID)
assert.equal(result.reconciled, 1)
assert.equal(requests.length, 1)
assert.equal(requests.some((r) => r.method === 'POST'), false)

console.log('\n[9] 本机时间偏差 >5 分钟：完整 payload 全云端唯一时只对账，不重复 POST')
reset()
requests = []
handler = async (req) => {
  assert.equal(req.method, 'GET')
  return json({ memories: [cloudMemory(450, '记住这件事', 12 * 60 * 60 * 1000)] })
}
result = await retryPendingMemoryUploads('token-clock-skew', SID)
assert.equal(result.reconciled, 1)
assert.equal(result.uploaded, 0)
assert.equal(requests.length, 1)
assert.equal(requests.some((r) => r.method === 'POST'), false)
assert.equal(getMemoriesCache(SID)[0].id, '450')

console.log('\n[10] 跨时间窗出现多个完整 payload 候选：判 ambiguous，绝不猜、绝不 POST')
reset()
requests = []
handler = async (req) => {
  assert.equal(req.method, 'GET')
  return json({
    memories: [
      cloudMemory(451, '记住这件事', 12 * 60 * 60 * 1000),
      cloudMemory(452, '记住这件事', 24 * 60 * 60 * 1000),
    ],
  })
}
result = await retryPendingMemoryUploads('token-clock-skew-ambiguous', SID)
assert.equal(result.ambiguous, 1)
assert.equal(result.reconciled, 0)
assert.equal(requests.length, 1)
assert.equal(requests.some((r) => r.method === 'POST'), false)
assert.equal(getMemoriesCache(SID)[0].id, 'local-memory-1')

console.log('\n[11] 跨时间窗只有 content 相同但 source 不同：不能误认旧记录，仍按正常流程 POST')
reset()
requests = []
getCount = 0
handler = async (req) => {
  if (req.method === 'GET') {
    getCount += 1
    return json({
      memories: [{
        ...cloudMemory(453, '记住这件事', 12 * 60 * 60 * 1000),
        source: '另一段旧原话',
      }],
    })
  }
  assert.equal(req.method, 'POST')
  return json(cloudMemory(454))
}
result = await retryPendingMemoryUploads('token-clock-skew-source-mismatch', SID)
assert.equal(getCount, 2)
assert.equal(result.uploaded, 1)
assert.equal(requests.filter((r) => r.method === 'POST').length, 1)
assert.equal(getMemoriesCache(SID)[0].id, '454')

console.log('\n[12] 同 token + session 并发调用只跑一套网络请求')
reset()
requests = []
let releaseFirstGet
const firstGetGate = new Promise((resolve) => { releaseFirstGet = resolve })
getCount = 0
handler = async (req) => {
  if (req.method === 'GET') {
    getCount += 1
    if (getCount === 1) await firstGetGate
    return json({ memories: [] })
  }
  assert.equal(req.method, 'POST')
  return json(cloudMemory(505))
}
const p1 = retryPendingMemoryUploads('same-token', SID)
const p2 = retryPendingMemoryUploads('same-token', SID)
releaseFirstGet()
const [r1, r2] = await Promise.all([p1, p2])
assert.equal(getCount, 2, '并发调用共享同一轮：只有两次预检 GET')
assert.equal(requests.filter((r) => r.method === 'POST').length, 1)
assert.equal(r1.uploaded, 1)
assert.equal(r2.uploaded, 1)

console.log('\nmemory upload retry safe: all passed')
