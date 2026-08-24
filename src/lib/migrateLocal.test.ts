// 老数据一键迁移纯逻辑自测（B2d / B3 手动导入）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/migrateLocal.test.ts
// 覆盖：hasLocalLegacyData（全空 false / 任一非空 true）/ buildMigrationPayload（升序、role/content 过滤、ts 过滤、
//       上限 2000 只迁最近）/ 迁移标记 set/has 往返 / nextMigrationTitle 重名编号 /
//       runLocalMigration（建会话 + 传消息/记忆，createSession 失败 → ok:false）

import {
  buildMigrationPayload,
  hasLocalLegacyData,
  hasMigratedFlag,
  nextMigrationTitle,
  runLocalMigration,
  setLocalMigratedFlag,
  MAX_MIGRATE_MESSAGES,
} from './migrateLocal.ts'

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

// 简易 localStorage mock（Node 无 localStorage；migrateLocal 各函数读写都在函数内，导入不触发）
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

function resetStore(): void {
  store.clear()
}

// fetch mock：runLocalMigration 上传测试用
let fetchCalls: Array<{ url: string; method: string; body: unknown }> = []
let fetchHandler: ((url: string, init: RequestInit) => Response) | null = null
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  fetchCalls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? null })
  if (!fetchHandler) throw new TypeError('测试未配置 fetch 响应')
  return fetchHandler(String(url), init ?? {})
}) as typeof fetch

function resetFetch(handler: (url: string, init: RequestInit) => Response): void {
  fetchCalls = []
  fetchHandler = handler
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// 各数据 key 与 migrateLocal/storage/memory 一致
const PERSONA_KEY = 'ai_companion_persona'
const MESSAGES_KEY = 'ai_companion_messages'
const MEMORY_KEY = 'ai_companion_memory'

console.log('\n[1] hasLocalLegacyData：全空 false，任一非空 true')
resetStore()
ok(hasLocalLegacyData() === false, 'persona 空 + 消息空 + 记忆空 → false')
localStorage.setItem(PERSONA_KEY, '   ')
ok(hasLocalLegacyData() === false, 'persona 全空白 → false（不算旧数据）')
localStorage.setItem(PERSONA_KEY, ' 我的 TA ')
ok(hasLocalLegacyData() === true, 'persona 非空 → true')
resetStore()
localStorage.setItem(MESSAGES_KEY, JSON.stringify([{ role: 'user', content: 'hi', ts: 1 }]))
ok(hasLocalLegacyData() === true, '消息非空 → true')
resetStore()
localStorage.setItem(MEMORY_KEY, JSON.stringify([{ id: 'a', text: '记住', createdAt: 1 }]))
ok(hasLocalLegacyData() === true, '记忆非空 → true')

console.log('\n[2] buildMigrationPayload：消息升序 + role/content/ts 过滤')
resetStore()
localStorage.setItem(PERSONA_KEY, '  人设  ')
localStorage.setItem(
  MESSAGES_KEY,
  JSON.stringify([
    { role: 'user', content: 'b', ts: 200 },
    { role: 'assistant', content: '   ', ts: 150 }, // 全空白 content → 过滤
    { role: 'system', content: 'x', ts: 100 }, // 非 user/assistant → 过滤
    { role: 'user', content: 'a', ts: 100 },
    { role: 'user', content: 'no-ts' }, // ts 缺失 → 过滤
    { role: 'user', content: 'nan', ts: NaN }, // ts 非法 → 过滤
    { role: 'user', content: 'c', ts: 300 },
  ]),
)
localStorage.setItem(
  MEMORY_KEY,
  JSON.stringify([
    { id: '1', text: '第一条', createdAt: 1 },
    { id: '2', text: '   ', createdAt: 2 }, // 全空白 → 过滤
    { id: '3', text: '第二条', createdAt: 3 },
  ]),
)
const payload = buildMigrationPayload()
eq(payload.persona, '  人设  ', 'persona 原样保留（空则空串）')
eq(
  payload.messages.map((m) => m.content),
  ['a', 'b', 'c'],
  '升序 + role/content/ts 过滤后只剩合法三条',
)
eq(
  payload.messages.map((m) => m.ts),
  [100, 200, 300],
  'ts 升序排列',
)
eq(
  payload.memories.map((m) => m.content),
  ['第一条', '第二条'],
  '记忆只保留非空 content',
)

console.log(`\n[3] buildMigrationPayload：上限 ${MAX_MIGRATE_MESSAGES} 只迁最近`)
resetStore()
const many = Array.from({ length: MAX_MIGRATE_MESSAGES + 5 }, (_, i) => ({
  role: 'user' as const,
  content: `m${i}`,
  ts: i + 1,
}))
localStorage.setItem(MESSAGES_KEY, JSON.stringify(many))
const capped = buildMigrationPayload()
eq(capped.messages.length, MAX_MIGRATE_MESSAGES, '超过上限 → 只迁 2000 条')
eq(capped.messages[0].content, 'm5', '丢最旧 5 条，从 m5 开始')
eq(capped.messages[0].ts, 6, '首条 ts 正确')
eq(capped.messages[capped.messages.length - 1].content, `m${MAX_MIGRATE_MESSAGES + 4}`, '末条是最新一条')
eq(capped.messages[capped.messages.length - 1].ts, MAX_MIGRATE_MESSAGES + 5, '末条 ts 正确')

resetStore()
const under = Array.from({ length: 3 }, (_, i) => ({ role: 'user' as const, content: `x${i}`, ts: i + 1 }))
localStorage.setItem(MESSAGES_KEY, JSON.stringify(under))
eq(buildMigrationPayload().messages.length, 3, '未超上限 → 全量保留')

console.log('\n[4] 迁移标记 set/has 往返')
resetStore()
ok(hasMigratedFlag() === false, '未设置 → false')
setLocalMigratedFlag()
ok(hasMigratedFlag() === true, '设置后 → true')
setLocalMigratedFlag()
ok(hasMigratedFlag() === true, '重复设置幂等')
localStorage.removeItem('ai_companion_migrated')
ok(hasMigratedFlag() === false, '移除后 → false')

console.log('\n[5] nextMigrationTitle：避免「我们的开始」重名')
eq(nextMigrationTitle([]), '我们的开始', '无重名 → 基础名')
eq(nextMigrationTitle(['我们的开始']), '我们的开始 2', '已有基础名 → 2')
eq(nextMigrationTitle(['我们的开始', '我们的开始 2']), '我们的开始 3', '已有 1/2 → 3')
eq(nextMigrationTitle(['别的会话', '我们的开始 3']), '我们的开始', '无基础名 → 基础名')
eq(nextMigrationTitle(['我们的开始', '我们的开始 3']), '我们的开始 2', '空档补位 2')
eq(nextMigrationTitle(null as never), '我们的开始', '非数组 → 基础名')

console.log('\n[6] runLocalMigration：建会话 + 传消息/记忆')
resetStore()
localStorage.setItem(PERSONA_KEY, '  人设  ')
localStorage.setItem(
  MESSAGES_KEY,
  JSON.stringify([
    { role: 'user', content: 'hi', ts: 1 },
    { role: 'assistant', content: 'hey', ts: 2 },
  ]),
)
localStorage.setItem(MEMORY_KEY, JSON.stringify([{ id: '1', text: '对方喜欢猫', createdAt: 1 }]))
resetFetch((url, init) => {
  if (url.endsWith('/api/sessions') && init?.method === 'POST') {
    return jsonResponse(
      { id: 55, title: '我们的开始', persona: '  人设  ', created_at: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z' },
      200,
    )
  }
  if (url.endsWith('/api/sessions/55/messages') && init?.method === 'POST') {
    const body = JSON.parse(String(init.body)) as { role: string; content: string }
    return jsonResponse({ id: 1, role: body.role, content: body.content, createdAt: '2026-08-24T00:00:00.000Z' }, 200)
  }
  if (url.endsWith('/api/sessions/55/memories') && init?.method === 'POST') {
    return jsonResponse({ id: 2, content: '对方喜欢猫', createdAt: '2026-08-24T00:00:00.000Z' }, 200)
  }
  throw new Error('unexpected: ' + (init?.method ?? 'GET') + ' ' + url)
})
const r = await runLocalMigration('tok-1', '我们的开始')
ok(r.ok && r.sessionId === 55, '成功返回新会话 id')
eq(fetchCalls.length, 4, 'create + 2 条消息 + memory 各发一次')

resetStore()
resetFetch(() => jsonResponse({ error: '服务器忙' }, 500))
const fail = await runLocalMigration('tok-1', '我们的开始')
ok(!fail.ok, 'createSession 失败 → ok:false')
eq(fetchCalls.length, 1, '建会话失败不再发消息/记忆')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
