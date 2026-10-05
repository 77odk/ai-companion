import assert from 'node:assert/strict'
import { enqueueSessionMessageCommit, enqueueSessionMessageCommits } from '../src/lib/sessionMessageQueue.ts'

console.log('[session message queue] 同一 session 严格串行，不同 session 可独立推进')

const order = []
let releaseFirst
const firstGate = new Promise((resolve) => { releaseFirst = resolve })

const first = enqueueSessionMessageCommit('s1', async () => {
  order.push('s1-first-start')
  await firstGate
  order.push('s1-first-end')
  return 1
})

const second = enqueueSessionMessageCommit('s1', async () => {
  order.push('s1-second-start')
  return 2
})

const other = enqueueSessionMessageCommit('s2', async () => {
  order.push('s2-start')
  return 3
})

await Promise.resolve()
await Promise.resolve()
assert.ok(order.includes('s1-first-start'))
assert.ok(order.includes('s2-start'), '不同 session 不应被 s1 的提交锁阻塞')
assert.equal(order.includes('s1-second-start'), false, '同 session 后续提交必须等前一条真正结束')

releaseFirst()
assert.deepEqual(await Promise.all([first, second, other]), [1, 2, 3])
assert.ok(order.indexOf('s1-first-end') < order.indexOf('s1-second-start'))

console.log('[session message queue] pending replay 可一次锁住多个受影响 session')
const multiOrder = []
let releaseS1
const s1Gate = new Promise((resolve) => { releaseS1 = resolve })
const held = enqueueSessionMessageCommit('a', async () => {
  multiOrder.push('a-held')
  await s1Gate
  multiOrder.push('a-release')
})
const replay = enqueueSessionMessageCommits(['b', 'a', 'b'], async () => {
  multiOrder.push('replay')
})
const bAfter = enqueueSessionMessageCommit('b', async () => {
  multiOrder.push('b-after')
})
await Promise.resolve()
await Promise.resolve()
assert.equal(multiOrder.includes('replay'), false, 'replay 必须等已占用的 a gate')
assert.equal(multiOrder.includes('b-after'), false, 'replay 已预定 b gate 后，b 新提交不能越过 replay')
releaseS1()
await Promise.all([held, replay, bAfter])
assert.ok(multiOrder.indexOf('a-release') < multiOrder.indexOf('replay'))
assert.ok(multiOrder.indexOf('replay') < multiOrder.indexOf('b-after'))

console.log('session message queue tests passed')
