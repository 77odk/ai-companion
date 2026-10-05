import assert from 'node:assert/strict'
import { enqueueSessionMessageCommit } from '../src/lib/sessionMessageQueue.ts'

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

console.log('session message queue tests passed')
