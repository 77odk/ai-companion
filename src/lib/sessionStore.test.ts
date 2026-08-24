// 会话状态 + 乐观缓存纯逻辑自测（B2c-1）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/sessionStore.test.ts
// 覆盖：activeSessionId 读写 / sessionsCache / 按会话分 key 的消息缓存 / pendingOps 增删 /
//       merge 逻辑（同 ts 去重、后端优先）/ 上传成功本地对账 / flushPendingOps 补传（成功清队列、失败留队列）

import {
  getActiveSessionId,
  setActiveSessionId,
  getSessionsCache,
  setSessionsCache,
  getMessagesCache,
  saveMessagesCache,
  clearMessagesCache,
  getPendingOps,
  addPendingOp,
  removePendingOp,
  newPendingOpId,
  mergeSessionMessages,
  confirmMessageInCache,
  flushPendingOps,
} from './sessionStore.ts'
import type { StoredMessage } from './storage.ts'

let passed = 0
let failed = 0

function ok(cond: boolean, name: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function eq(actual: unknown, expected: unknown, name: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

// 简易 localStorage mock（sessionStore 各读写都在函数内，导入不触发）
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k) : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v))
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => {
    store.clear()
  },
} as unknown as Storage

// fetch mock：flushPendingOps 补传测试用
let fetchCalls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = []
let fetchHandler: ((url: string, init: RequestInit) => Response) | null = null
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  fetchCalls.push({
    url: String(url),
    method: init?.method ?? 'GET',
    headers: (init?.headers as Record<string, string> | undefined) ?? {},
    body: init?.body ?? null,
  })
  if (!fetchHandler) throw new TypeError('测试未配置 fetch 响应')
  return fetchHandler(String(url), init ?? {})
}) as typeof fetch

function resetStore(): void {
  store.clear()
}
function resetFetch(handler: (url: string, init: RequestInit) => Response): void {
  fetchCalls = []
  fetchHandler = handler
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

console.log('\n[1] activeSessionId 读写')
resetStore()
eq(getActiveSessionId(), '', '未设置 → 空串')
setActiveSessionId('7')
eq(getActiveSessionId(), '7', '写入后读回相同')
setActiveSessionId('')
eq(getActiveSessionId(), '', '空串清除')

console.log('\n[2] sessionsCache 读写')
resetStore()
eq(getSessionsCache(), [], '无缓存 → []')
setSessionsCache([{ id: 1, title: 'a', persona: 'p', created_at: 'c', updatedAt: 'u' }])
eq(getSessionsCache().length, 1, '写后读回')
setSessionsCache('bad' as never)
eq(getSessionsCache(), [], '写入非法值 → 读回 []')

console.log('\n[3] 消息缓存按会话分 key')
resetStore()
saveMessagesCache('7', [{ role: 'user', content: 'hi', ts: 1 }])
eq(getMessagesCache('7').length, 1, '会话 7 读回')
eq(getMessagesCache('8').length, 0, '会话 8 读不到 7 的消息')
saveMessagesCache('7', [
  { role: 'user', content: 'hi', ts: 1 },
  { role: 'assistant', content: 'hey', ts: 2 },
])
eq(getMessagesCache('7').length, 2, '覆盖写')
clearMessagesCache('7')
eq(getMessagesCache('7').length, 0, '清除后为空')
localStorage.setItem('ai_companion_msgs_8', '[{"role":"user","content":"x","ts":5}]')
eq(getMessagesCache('8').length, 1, '手动塞的数据也能读')

console.log('\n[4] pendingOps 增删')
resetStore()
eq(getPendingOps(), [], '空队列 → []')
const op1 = { id: 'a', type: 'message' as const, sessionId: '7', payload: { role: 'user', content: 'hi' }, ts: 1 }
const op2 = { id: 'b', type: 'memory' as const, sessionId: '7', payload: { content: 'memo' }, ts: 2 }
addPendingOp(op1)
addPendingOp(op2)
eq(getPendingOps().length, 2, '加入两条')
removePendingOp('a')
eq(getPendingOps().length, 1, '移除一条')
eq(getPendingOps()[0].id, 'b', '剩下的是另一条')
const id1 = newPendingOpId()
const id2 = newPendingOpId()
ok(id1.length > 0 && id1 !== id2, 'newPendingOpId 生成非空且不重复')

console.log('\n[5] mergeSessionMessages：同 ts 去重 + 后端优先 + 升序')
const local: StoredMessage[] = [
  { role: 'user', content: '本地A', ts: 100 },
  { role: 'user', content: '本地B', ts: 200 },
]
const cloud: StoredMessage[] = [
  { role: 'user', content: '云端A(同ts)', ts: 100 },
  { role: 'user', content: '云端C', ts: 300 },
]
const merged = mergeSessionMessages(local, cloud)
eq(merged.map((m) => m.content), ['云端A(同ts)', '本地B', '云端C'], '同 ts 后端优先 + 升序')
eq(mergeSessionMessages([], []), [], '空输入 → 空')
const withNull = [null, { role: 'user' as const, content: 'x', ts: 1 }] as unknown as StoredMessage[]
eq(mergeSessionMessages(withNull, []).length, 1, '非法条目被过滤')
eq(mergeSessionMessages([{ role: 'user' as const, content: 'a', ts: NaN }], [{ role: 'user' as const, content: 'b', ts: 2 }]).length, 1, 'NaN ts 被过滤')

console.log('\n[6] confirmMessageInCache：上传成功后本地对账')
resetStore()
saveMessagesCache('7', [
  { role: 'user', content: 'hi', ts: 1 },
  { role: 'assistant', content: 'hey', ts: 2 },
])
const op = { id: 'x', type: 'message' as const, sessionId: '7', payload: { role: 'user', content: 'hi' }, ts: 1 }
confirmMessageInCache('7', op, { role: 'user', content: 'hi', createdAt: '2026-08-24T00:00:00.000Z' })
const list = getMessagesCache('7')
eq(list.length, 2, '对账后消息条数不变')
eq(list.find((m) => m.role === 'user')!.ts, Date.parse('2026-08-24T00:00:00.000Z'), '乐观条目 ts 换成服务端 createdAt')

console.log('\n[7] flushPendingOps：成功清队列 + 失败留在队列')
resetStore()
addPendingOp({ id: 'a', type: 'message' as const, sessionId: '7', payload: { role: 'user', content: 'hi' }, ts: 1 })
addPendingOp({ id: 'b', type: 'memory' as const, sessionId: '7', payload: { content: 'memo' }, ts: 2 })
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions/7/messages') && init?.method === 'POST') {
    return jsonResponse({ id: 10, role: 'user', content: 'hi', createdAt: '2026-08-24T00:00:00.000Z' })
  }
  if (url.endsWith('/api/sessions/7/memories') && init?.method === 'POST') {
    return jsonResponse({ id: 20, content: 'memo', createdAt: '2026-08-24T00:00:00.000Z' })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
await flushPendingOps('tok-1')
eq(getPendingOps().length, 0, '全部上传成功后队列清空')
eq(fetchCalls.length, 2, 'message + memory 各发一次')

resetStore()
addPendingOp({ id: 'c', type: 'message' as const, sessionId: '7', payload: { role: 'user', content: 'hi' }, ts: 1 })
resetFetch(() => jsonResponse({ error: '服务器忙' }, 500))
await flushPendingOps('tok-1')
eq(getPendingOps().length, 1, '上传失败留在队列')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
