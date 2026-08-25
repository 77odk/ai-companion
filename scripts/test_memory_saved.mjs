// TASK-LM2 「✅已帮你记下」反馈：memorySaved 字段透传 + 渲染开关
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_memory_saved.mjs（npm test 入口会自动带上）
// 覆盖：shouldShowMemorySaved 渲染开关（true → 显示 / false / 缺省 / 非用户消息 → 不显示）/
//       本地消息库 saveMessages→loadMessages 透传 memorySaved / 会话缓存 saveMessagesCache→getMessagesCache 透传

import { loadMessages, saveMessages, shouldShowMemorySaved } from '../src/lib/storage.ts'
import { getMessagesCache, saveMessagesCache } from '../src/lib/sessionStore.ts'

// localStorage / window mock：Node 没有这两样，storage.ts / sessionStore.ts 在函数体内引用它们
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

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

function eq(actual, expected, name) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(a === b, `${name}（得 ${a}，期望 ${b}）`)
}

console.log('\n[1] shouldShowMemorySaved：渲染开关')
ok(shouldShowMemorySaved({ role: 'user', content: '记住我叫阿七', ts: 1, memorySaved: true }) === true, '用户消息 + memorySaved=true → 显示标签')
ok(shouldShowMemorySaved({ role: 'user', content: '记住我叫阿七', ts: 1, memorySaved: false }) === false, '用户消息 + memorySaved=false → 不显示')
ok(shouldShowMemorySaved({ role: 'user', content: '今天天气不错', ts: 1 }) === false, '用户消息缺省 memorySaved → 不显示（旧数据不误标）')
ok(shouldShowMemorySaved({ role: 'assistant', content: '记住了', ts: 1, memorySaved: true }) === false, 'TA 消息即使带 memorySaved → 不显示（只给用户气泡反馈）')
ok(shouldShowMemorySaved({ role: 'assistant', content: '记住了', ts: 1 }) === false, 'TA 消息缺省 → 不显示')

console.log('\n[2] 本地消息库透传：saveMessages → loadMessages')
resetStore()
const now = Date.now()
const listTrue = [
  { role: 'user', content: '记住我早班7:50上班', ts: now - 1000, memorySaved: true },
  { role: 'assistant', content: '记住了。', ts: now },
]
saveMessages(listTrue)
const loadedTrue = loadMessages()
eq(loadedTrue[0].memorySaved, true, 'memorySaved=true 透传保留')
eq(loadedTrue[1].memorySaved, undefined, 'assistant 消息无 memorySaved 保持缺省')

resetStore()
const listMixed = [
  { role: 'user', content: '普通一句', ts: now - 2000 },
  { role: 'user', content: '帮我记一下我喜欢下雨', ts: now - 1000, memorySaved: true },
  { role: 'user', content: '这条带 false', ts: now, memorySaved: false },
]
saveMessages(listMixed)
const loadedMixed = loadMessages()
eq(loadedMixed.map((m) => m.memorySaved ?? null), [null, true, false], 'true / false / 缺省 三种状态原样透传')
eq(loadedMixed.length, 3, '60 天窗口内消息不被裁剪')

console.log('\n[3] 会话消息缓存透传：saveMessagesCache → getMessagesCache')
resetStore()
saveMessagesCache('s1', listTrue)
const cached = getMessagesCache('s1')
eq(cached[0].memorySaved, true, '会话缓存 memorySaved=true 透传保留')
eq(cached[1].memorySaved, undefined, 'assistant 消息无 memorySaved 保持缺省')
eq(shouldShowMemorySaved(cached[0]), true, '缓存读回的消息仍触发渲染开关')
eq(shouldShowMemorySaved(cached[1]), false, '缓存读回的 TA 消息不触发')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
