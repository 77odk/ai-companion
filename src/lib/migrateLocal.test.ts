// 老数据一键迁移纯逻辑自测（B2d）
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：npm test（node --test）或直接 node src/lib/migrateLocal.test.ts
// 覆盖：hasLocalLegacyData（全空 false / 任一非空 true）/ buildMigrationPayload（升序、role/content 过滤、ts 过滤、
//       上限 2000 只迁最近）/ 迁移标记 set/has 往返

import {
  buildMigrationPayload,
  hasLocalLegacyData,
  hasMigratedFlag,
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

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) throw new Error(`${failed} 个用例失败`)
