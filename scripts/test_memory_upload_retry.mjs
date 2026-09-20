// #20 · 会话记忆上传失败进入现有 pendingOps，补传时保留追溯字段并完成本地 id 对账。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const requests = []
let responseStatus = 500
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), body: JSON.parse(String(init.body ?? '{}')) })
  return new Response(
    JSON.stringify(responseStatus === 200
      ? { id: 88, content: '记住这件事', createdAt: '2026-09-20T08:00:00.000Z' }
      : { error: '服务器忙' }),
    { status: responseStatus, headers: { 'Content-Type': 'application/json' } },
  )
}

const {
  addPendingOp,
  flushPendingOps,
  getMemoriesCache,
  getPendingOps,
  saveMemoriesCache,
} = await import('../src/lib/sessionStore.ts')

console.log('\n[1] 失败留队，成功补传后清队并对账')
saveMemoriesCache('69', [{
  id: 'local-memory-1',
  text: '记住这件事',
  createdAt: 1,
  source: '这是我的原话',
  taReply: '好，我记住了。',
  pendingSync: true,
}])
addPendingOp({
  id: 'memory-op-1',
  type: 'memory',
  sessionId: '69',
  payload: {
    content: '记住这件事',
    source: '这是我的原话',
    taReply: '好，我记住了。',
    localMemoryId: 'local-memory-1',
  },
  ts: 1,
})

await flushPendingOps('token')
assert.equal(getPendingOps().length, 1, '500 后保留补传任务')
assert.equal(getMemoriesCache('69')[0].pendingSync, true, '失败时本地记忆继续标记待同步')

responseStatus = 200
await flushPendingOps('token')
assert.equal(getPendingOps().length, 0, '补传成功后移除任务')
assert.deepEqual(requests.at(-1).body, {
  content: '记住这件事',
  source: '这是我的原话',
  taReply: '好，我记住了。',
}, '补传保留 source / taReply，不把 localMemoryId 发给后端')
assert.equal(getMemoriesCache('69')[0].id, '88', '成功后换成服务端 id')
assert.equal(getMemoriesCache('69')[0].pendingSync, undefined, '成功后清掉待同步标记')

console.log('\n[2] Chat 写入出口先入队，再调用 postMemory')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8')
const memoryOpAt = chatSource.indexOf("type: 'memory'")
const queueAt = chatSource.indexOf('addPendingOp(op)', memoryOpAt)
const postAt = chatSource.indexOf('postMemory(token, activeSessionId, payload)', memoryOpAt)
assert.ok(memoryOpAt >= 0 && queueAt > memoryOpAt && postAt > queueAt, '记忆任务必须先入 outbox 再直传')
assert.match(chatSource.slice(memoryOpAt, postAt), /localMemoryId: item\.id/)

console.log('\n记忆上传补传 #20：全部通过')
