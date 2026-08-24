// 会话接口客户端纯逻辑自测（B2c-1）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/sessionApi.test.ts
// 覆盖：URL/方法/请求头构造正确（mock fetch）；401 触发登录失效广播；非 2xx / 网络失败返回 {ok:false}

import { ELUVIN_AUTH_CHANGE } from './dataChange.ts'
import { API_BASE, setAccount } from './sync.ts'
import {
  listSessions,
  createSession,
  getSession,
  deleteSession,
  patchSession,
  postMessage,
  listMemories,
  postMemory,
  patchMemory,
  deleteMemory,
} from './sessionApi.ts'

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

// ---- 测试环境 mock（Node 无 localStorage / window / fetch） ----
// localStorage：sessionApi 的 401 走 logout → clearAccount，需要能读能删
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

// window：监听登录状态广播（ELUVIN_AUTH_CHANGE），验证 401 是否触发登出
const windowListeners: Record<string, ((ev: Event) => void) | undefined> = {}
let authEvents = 0
globalThis.window = {
  addEventListener: (name: string, fn: (ev: Event) => void) => {
    windowListeners[name] = fn
  },
  removeEventListener: (name: string) => {
    delete windowListeners[name]
  },
  dispatchEvent: (ev: Event) => {
    if (ev.type === ELUVIN_AUTH_CHANGE) authEvents++
    const fn = windowListeners[ev.type]
    if (fn) fn(ev)
    return true
  },
} as unknown as Window & typeof globalThis

// fetch mock：记录调用，handler 按测试配置返回
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

console.log('\n[1] listSessions：URL / 方法 / 请求头')
resetStore()
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions') && (init?.method ?? 'GET') === 'GET') {
    return jsonResponse({ sessions: [] })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const list = await listSessions('tok-1')
eq(fetchCalls.length, 1, '发一次请求')
eq(fetchCalls[0].url, `${API_BASE}/api/sessions`, 'URL = API_BASE + /api/sessions')
eq(fetchCalls[0].method, 'GET', '方法 GET')
eq(fetchCalls[0].headers.Authorization, 'Bearer tok-1', 'Authorization 带 Bearer token')
eq(fetchCalls[0].headers['Content-Type'], 'application/json', 'Content-Type 是 JSON')
ok(list.ok === true && list.data.sessions.length === 0, '成功返回 {ok:true, data}')

console.log('\n[2] createSession：POST + body')
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions') && init?.method === 'POST') {
    return jsonResponse({ id: 1, title: '新会话', persona: '你是小云', created_at: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const created = await createSession('tok-1', { persona: '你是小云' })
eq(fetchCalls[0].method, 'POST', '用 POST')
eq(JSON.parse(String(fetchCalls[0].body)).persona, '你是小云', 'body 带 persona')
ok(created.ok && created.data.id === 1, '成功返回新建会话')

console.log('\n[3] getSession：URL 带会话 id')
resetFetch((url) => {
  if (url.endsWith('/api/sessions/7')) {
    return jsonResponse({ session: {}, messages: [], memories: [] })
  }
  throw new Error('unexpected: ' + url)
})
const detail = await getSession('tok-1', 7)
eq(fetchCalls[0].url, `${API_BASE}/api/sessions/7`, 'URL = API_BASE + /api/sessions/7')
eq(fetchCalls[0].method, 'GET', '方法 GET')
ok(detail.ok === true && Array.isArray(detail.data.messages), '成功返回 {session, messages, memories}')

console.log('\n[4] deleteSession / patchSession：DELETE 与 PATCH')
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions/9')) {
    if (init?.method === 'DELETE') return jsonResponse({ ok: true })
    if (init?.method === 'PATCH') return jsonResponse({ id: 9, title: '新标题', persona: '', created_at: 'x', updatedAt: 'y' })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const del = await deleteSession('tok-1', '9')
eq(fetchCalls[0].method, 'DELETE', 'deleteSession 用 DELETE')
ok(del.ok === true && del.data.ok === true, '删除成功')
const patched = await patchSession('tok-1', '9', { title: '新标题' })
eq(fetchCalls[1].method, 'PATCH', 'patchSession 用 PATCH')
eq(JSON.parse(String(fetchCalls[1].body)).title, '新标题', 'body 只带要更新的字段')
ok(patched.ok && patched.data.title === '新标题', 'PATCH 成功返回更新后的会话')

console.log('\n[5] postMessage / listMemories / postMemory')
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions/7/messages') && init?.method === 'POST') {
    return jsonResponse({ id: 10, role: 'user', content: 'hi', createdAt: '2026-08-24T00:00:00.000Z' })
  }
  if (url.endsWith('/api/sessions/7/memories') && (init?.method ?? 'GET') === 'GET') {
    return jsonResponse({ memories: [] })
  }
  if (url.endsWith('/api/sessions/7/memories') && init?.method === 'POST') {
    return jsonResponse({ id: 20, content: 'memo', createdAt: '2026-08-24T00:00:00.000Z' })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const msg = await postMessage('tok-1', 7, { role: 'user', content: 'hi' })
eq(fetchCalls[0].url, `${API_BASE}/api/sessions/7/messages`, '发消息 URL')
eq(JSON.parse(String(fetchCalls[0].body)).role, 'user', 'body 带 role')
ok(msg.ok && msg.data.id === 10, '发消息成功')
const mems = await listMemories('tok-1', 7)
ok(mems.ok && mems.data.memories.length === 0, '记忆列表成功')
const mem = await postMemory('tok-1', 7, { content: 'memo' })
eq(fetchCalls[2].method, 'POST', 'postMemory 用 POST')
ok(mem.ok && mem.data.id === 20, '加记忆成功')

console.log('\n[6] patchMemory / deleteMemory：URL 与方法')
resetFetch((url, init) => {
  if (url.endsWith('/api/memories/5') && init?.method === 'PATCH') {
    return jsonResponse({ id: 5, content: '改', createdAt: 'x' })
  }
  if (url.endsWith('/api/memories/5') && init?.method === 'DELETE') {
    return jsonResponse({ ok: true })
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const pm = await patchMemory('tok-1', 5, { content: '改' })
eq(fetchCalls[0].url, `${API_BASE}/api/memories/5`, 'patchMemory URL')
eq(fetchCalls[0].method, 'PATCH', 'patchMemory 用 PATCH')
ok(pm.ok && pm.data.content === '改', '改记忆成功')
const dm = await deleteMemory('tok-1', 5)
eq(fetchCalls[1].method, 'DELETE', 'deleteMemory 用 DELETE')
ok(dm.ok === true && dm.data.ok === true, '删记忆成功')

console.log('\n[7] 401 触发登录失效广播（清 token + 弹登录墙事件）')
resetStore()
setAccount({ token: 'tok-bad', account: 'a@b.com' })
resetFetch(() => jsonResponse({ error: '登录已失效，请重新登录' }, 401))
authEvents = 0
const bad = await listSessions('tok-bad')
ok(!bad.ok && bad.status === 401, '401 返回 {ok:false, status:401}')
if (bad.ok) {
  ok(false, '401 不应走 ok:true 分支')
} else {
  eq(bad.message, '登录已失效，请重新登录', 'message 用后端 error 文案')
}
eq(authEvents, 1, '广播 1 次登录状态变化')
eq(localStorage.getItem('ai_companion_account'), null, 'token 已清（登出）')

console.log('\n[8] 非 2xx 返回 {ok:false, status}（不抛异常）')
resetFetch(() => jsonResponse({ error: 'not found' }, 404))
const nf = await getSession('tok-1', '999')
ok(!nf.ok && nf.status === 404, '404 返回 {ok:false, status:404}')
if (!nf.ok) {
  eq(nf.message, 'not found', 'message 用后端 error 文案')
}
resetFetch(() => jsonResponse({ error: '参数不对' }, 400))
const badBody = await postMessage('tok-1', '7', { role: 'system', content: 'x' } as never)
ok(!badBody.ok && badBody.status === 400, '400 返回 {ok:false, status:400}')

console.log('\n[9] 网络失败返回 {ok:false, status:0}（不抛异常）')
resetFetch(() => {
  throw new TypeError('fetch failed')
})
const net = await listSessions('tok-1')
ok(!net.ok && net.status === 0, '网络失败 status=0')
if (!net.ok) {
  ok(String(net.message).includes('网络不通'), '网络失败给中文兜底文案')
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
