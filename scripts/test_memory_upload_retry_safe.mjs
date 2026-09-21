// #20 · memoryUploadRetry 专项测试：pendingSync 驱动、安全去重、删除不复活。
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

console.log('\n[5] 补传过程中本地已删除：绝不复活、绝不 POST')
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

console.log('\n[6] 没有 pendingSync：零请求')
store.clear()
saveMemoriesCache(SID, [{ ...localMemory(), pendingSync: undefined }])
requests = []
handler = async () => { throw new Error('不该请求') }
result = await retryPendingMemoryUploads('token', SID)
assert.equal(requests.length, 0)
assert.equal(result.uploaded, 0)
assert.equal(result.reconciled, 0)

console.log('\nmemory upload retry safe: all passed')
