import { classifyMemoryTemporal, isMemoryActive } from '../src/lib/memoryTemporal.ts'
import { loadMemory, recallRelevantMemories } from '../src/lib/memory.ts'
import { recallSessionMemories, saveMemoriesCache } from '../src/lib/sessionStore.ts'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
}

let passed = 0
let failed = 0
function ok(value, name) {
  if (value) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}
function eq(actual, expected, name) {
  ok(JSON.stringify(actual) === JSON.stringify(expected), `${name}（得 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}）`)
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const createdAt = 2_000_000_000_000
const state = (text, elapsed) => classifyMemoryTemporal(text, createdAt, createdAt + elapsed)
const item = (id, text, age, extra = {}) => ({ id, text, createdAt: createdAt - age, ...extra })

console.log('\n[A] stable')
eq(state('我喜欢喝咖啡', 100 * DAY), { kind: 'stable', temporary: false, expired: false }, '咖啡偏好永不过期')
eq(state('我有一只猫', 100 * DAY).kind, 'stable', '养猫事实是 stable')

console.log('\n[B] current：24h')
ok(!state('我现在有点困', 2 * HOUR).expired, '现在 +2h active')
ok(state('我现在有点困', 25 * HOUR).expired, '现在 +25h expired')
ok(state('我刚下班', 25 * HOUR).expired, '刚下班 +25h expired')

console.log('\n[C] day：48h')
ok(!state('我今天有点发烧', 12 * HOUR).expired, '今天 +12h active')
ok(state('我今天有点发烧', 49 * HOUR).expired, '今天 +49h expired')
ok(state('我明天要出门', 49 * HOUR).expired, '明天 +49h expired')

console.log('\n[D] recent：14d')
ok(!state('我最近睡得不好', 3 * DAY).expired, '最近 +3d active')
ok(state('我最近睡得不好', 15 * DAY).expired, '最近 +15d expired')
ok(state('我这周特别忙', 15 * DAY).expired, '这周 +15d expired')

console.log('\n[E] English')
eq(state('I am busy right now', 0).kind, 'current', 'right now → current')
eq(state("I've been tired recently", 0).kind, 'recent', 'recently → recent')
eq(state('I have a cat', 100 * DAY).kind, 'stable', 'cat fact → stable')

console.log('\n[F/G] false-positive and source protection')
eq(state('我喜欢《今天》这首歌', 100 * DAY).kind, 'stable', '书名号里的「今天」不误判')
const sourceOnly = { text: '用户喜欢拿铁', createdAt, source: '我今天又喝拿铁了' }
eq(classifyMemoryTemporal(sourceOnly.text, sourceOnly.createdAt, createdAt + 100 * DAY).kind, 'stable', '只按 memory.text 分类，不读 source')

console.log('\n[H/I] pinned / explicit cannot revive expired')
ok(!isMemoryActive(item('p', '我今天在医院', 60 * DAY, { pinned: true }), createdAt), 'pinned expired → inactive')
ok(!isMemoryActive(item('e', '我今天没睡好', 60 * DAY, { explicit: true }), createdAt), 'explicit expired → inactive')

console.log('\n[J/K] invalid timestamps and legacy records')
for (const invalid of [0, Number.NaN, undefined]) {
  ok(isMemoryActive({ text: '我今天有点发烧', createdAt: invalid }, createdAt), `createdAt=${String(invalid)} 保守 active`)
}
const legacy = { id: 'old', text: '我最近很忙', createdAt: createdAt - 15 * DAY }
ok(!isMemoryActive(legacy, createdAt), '无 temporal 字段的旧 MemoryItem 自动过期')

console.log('\n[L] real session recall injection chain')
store.clear()
const stable = item('stable', '我有一只猫', 100 * DAY, { topic: '宠物' })
const active = item('active', '我今天想喝咖啡', 12 * HOUR, { topic: '饮食' })
const expired = item('expired', '我今天有点发烧', 49 * HOUR, { topic: '健康', pinned: true, explicit: true })
saveMemoriesCache('session-1', [stable, active, expired])
eq(recallSessionMemories('session-1', '随便聊聊', { now: createdAt }).map((m) => m.id), ['active', 'stable'], '真实 session 召回只注入 stable + active temporary')
eq(recallRelevantMemories([stable, active, expired], '', { now: createdAt }).map((m) => m.id), ['active', 'stable'], '底层召回同样先过滤再排序')

console.log('\n[M] filtering never deletes storage')
localStorage.setItem('ai_companion_memory', JSON.stringify([stable, active, expired]))
recallRelevantMemories(loadMemory(), '', { now: createdAt })
eq(loadMemory().map((m) => m.id), ['stable', 'active', 'expired'], '召回后原三条仍全部存在')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
