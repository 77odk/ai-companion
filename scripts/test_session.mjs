// 会话起点（M7-3 刷新对话）纯逻辑自测
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离），不依赖任何构建工具。
// 跑法：node scripts/test_session.mjs
// 覆盖：getSessionStart 默认 0 / setSessionStart 读写 / filterSessionMessages 过滤边界
//      （ts==start 保留、<start 去掉、空数组、不改输入数组）/ saveMessages 不删刷新前的记录

import { getSessionStart, setSessionStart, saveMessages, loadMessages } from '../src/lib/storage.ts'
import { filterSessionMessages } from '../src/lib/aiSpaceDetail.ts'

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

// 简易 localStorage mock（Node 无 localStorage；storage 的读写都在函数内，导入不触发）
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
function resetStore() {
  store.clear()
}

// 固定三个时间点：2026-08-20 / 21 / 22（都在 60 天窗口内）
const t0 = new Date(2026, 7, 20, 10, 0).getTime()
const t1 = new Date(2026, 7, 21, 10, 0).getTime()
const t2 = new Date(2026, 7, 22, 10, 0).getTime()

console.log('\n[1] getSessionStart 默认 0（未刷新过 = 全部显示）')
resetStore()
eq(getSessionStart(), 0, '无设置 → 0')
localStorage.setItem('ai_companion_session_start', 'not-a-number')
eq(getSessionStart(), 0, '损坏/非法 → 0')
localStorage.setItem('ai_companion_session_start', '0')
eq(getSessionStart(), 0, '存的是 0 → 也按 0 处理')

console.log('\n[2] setSessionStart 读写')
resetStore()
setSessionStart(t1)
eq(getSessionStart(), t1, '写入后读回相同')
setSessionStart(t2)
eq(getSessionStart(), t2, '覆盖更新为新时间')

console.log('\n[3] filterSessionMessages 过滤边界')
const msgs = [
  { role: 'user', content: '刷新前', ts: t0 },
  { role: 'assistant', content: '也在刷新前', ts: t1 },
  { role: 'user', content: '刷新后', ts: t2 },
]
eq(filterSessionMessages(msgs, t1), [msgs[1], msgs[2]], 'ts == start 保留、< start 去掉')
eq(filterSessionMessages(msgs, t2), [msgs[2]], '起点取最后一条 → 只剩它')
eq(filterSessionMessages(msgs, t2 + 1), [], '起点晚于全部 → 空')
eq(filterSessionMessages([], t1), [], '空数组 → 空数组')

console.log('\n[4] filterSessionMessages 不改输入数组 + 保留排序')
const input = [
  { role: 'user', content: 'a', ts: t0 },
  { role: 'user', content: 'b', ts: t1 },
  { role: 'user', content: 'c', ts: t2 },
]
const before = JSON.stringify(input)
const out = filterSessionMessages(input, t1)
ok(out !== input, '返回新数组（不共享引用）')
eq(JSON.stringify(input), before, '输入数组内容未被修改')
eq(out.map((m) => m.content), ['b', 'c'], '过滤后保留原排序')

console.log('\n[5] filterSessionMessages 起点 <= 0 全量显示')
eq(filterSessionMessages(msgs, 0), msgs, '起点 0 → 全部返回')
eq(filterSessionMessages(msgs, -5), msgs, '起点负数 → 全部返回')

console.log('\n[6] filterSessionMessages 非法时间戳处理')
eq(
  filterSessionMessages(
    [
      { role: 'user', content: 'x', ts: NaN },
      { role: 'user', content: 'y', ts: t2 },
    ],
    t1,
  ).map((m) => m.content),
  ['y'],
  '非法 ts 被跳过，合法 ts >= start 保留',
)
eq(filterSessionMessages([null, { role: 'user', content: 'z', ts: t2 }], t1).length, 1, '空条目被跳过')

console.log('\n[7] saveMessages 保存全量：刷新前的消息不因会话起点被删')
resetStore()
saveMessages([
  { role: 'user', content: '刷新前的话', ts: t0 },
  { role: 'user', content: '刷新后的话', ts: t2 },
])
const all = loadMessages()
eq(all.length, 2, '两条都还在（不删刷新前的）')
eq(all[0].content, '刷新前的话', '刷新前的聊天记录仍在 localStorage')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
