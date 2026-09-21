// #19 · Memory 页主动云端刷新：只验证现有 merge 语义 + 页面挂载契约，不改数据层。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const {
  getMemoriesCache,
  mergeSessionMemories,
  reconcileMemoryCacheId,
  saveMemoriesCache,
  sessionMemoryToItem,
} = await import('../src/lib/sessionStore.ts')
const { alignPendingMemoriesForRefresh } = await import('../src/lib/memoryRefreshReconcile.ts')

const sessionId = '19'
const local = [
  {
    id: '11',
    text: '云端已有',
    createdAt: 100,
    topic: '工作',
    source: '原话',
  },
  {
    id: 'local-pending',
    text: '离线新增',
    createdAt: 200,
    pendingSync: true,
  },
  {
    id: '12',
    text: '别处已删',
    createdAt: 300,
  },
]
const cloud = [
  sessionMemoryToItem({
    id: 11,
    content: '云端最新内容',
    createdAt: '2026-09-21T00:00:00.000Z',
  }),
]

console.log('\n[1] 云端同 id 为权威，同时保留本机增强字段')
let merged = mergeSessionMemories(local, cloud, { purgeMissing: true, sessionId })
const confirmed = merged.find((item) => item.id === '11')
assert.equal(confirmed?.text, '云端最新内容')
assert.equal(confirmed?.topic, '工作')
assert.equal(confirmed?.source, '原话')

console.log('\n[2] purgeMissing 会清掉云端已经不存在的普通缓存')
assert.equal(merged.some((item) => item.id === '12'), false)

console.log('\n[3] pendingSync 永远保留，不会被 Memory 页主动刷新误删')
const pending = merged.find((item) => item.id === 'local-pending')
assert.ok(pending)
assert.equal(pending?.pendingSync, true)


console.log('\n[4] 刷新遇到“POST 已落云端但回调未返回”时，唯一 pending/cloud 对会先对齐 id')
const inflightLocal = [
  {
    id: 'local-inflight',
    text: '刚记住的一件事',
    createdAt: Date.parse('2026-09-21T00:00:00.000Z'),
    source: '这是原话',
    taReply: '我记住了',
    pendingSync: true,
  },
]
const inflightCloud = [
  {
    id: '901',
    text: '刚记住的一件事',
    createdAt: Date.parse('2026-09-21T00:00:20.000Z'),
    source: '这是原话',
    taReply: '我记住了',
  },
]
const alignedInflight = alignPendingMemoriesForRefresh(inflightLocal, inflightCloud)
assert.equal(alignedInflight.length, 1)
assert.equal(alignedInflight[0].id, '901')
assert.equal(alignedInflight[0].pendingSync, true)
const mergedInflight = mergeSessionMemories(alignedInflight, inflightCloud, { purgeMissing: true, sessionId })
assert.equal(mergedInflight.length, 1, '对齐后 merge 只能剩一条')
assert.equal(mergedInflight[0].id, '901')
assert.equal(mergedInflight[0].pendingSync, undefined, '云端权威条目收敛后清 pending')
saveMemoriesCache(sessionId, mergedInflight)
reconcileMemoryCacheId(sessionId, 'local-inflight', 901)
assert.equal(getMemoriesCache(sessionId).length, 1, '旧 POST 回调回来时临时 id 已不存在，必须 no-op')
assert.equal(getMemoriesCache(sessionId)[0].id, '901')

console.log('\n[5] 有歧义时绝不猜；超出当前 5 分钟窗口也保持 pending 原样')
const ambiguousCloud = [
  inflightCloud[0],
  { ...inflightCloud[0], id: '902' },
]
assert.equal(alignPendingMemoriesForRefresh(inflightLocal, ambiguousCloud)[0].id, 'local-inflight')
const lateCloud = [
  { ...inflightCloud[0], createdAt: inflightLocal[0].createdAt + 6 * 60 * 1000 },
]
assert.equal(alignPendingMemoriesForRefresh(inflightLocal, lateCloud)[0].id, 'local-inflight')

console.log('\n[6] 页面挂载明确先 align pending/cloud，再走既有 mergeSessionMemories')
const source = fs.readFileSync(path.join(process.cwd(), 'src/components/Memory.tsx'), 'utf8')
assert.match(source, /import \{ listMemories \} from '\.\.\/lib\/sessionApi'/)
assert.match(source, /import \{ alignPendingMemoriesForRefresh \} from '\.\.\/lib\/memoryRefreshReconcile'/)
assert.match(source, /res\.data\.memories\.map\(sessionMemoryToItem\)/)
assert.match(source, /const refreshedCache = alignPendingMemoriesForRefresh\(getMemoriesCache\(sessionId\), cloudMemories\)/)
assert.match(source, /mergeSessionMemories\(refreshedCache, cloudMemories/)
assert.match(source, /purgeMissing: true/)
assert.match(source, /sessionId,/)

console.log('\n[7] 页内会话记忆改/删后，旧 GET 结果必须因 mutation version 变化而失效')
assert.match(source, /const memoryMutationVersionRef = useRef\(0\)/)
assert.match(source, /startedAtMutationVersion = memoryMutationVersionRef\.current/)
assert.ok((source.match(/memoryMutationVersionRef\.current !== startedAtMutationVersion/g) ?? []).length >= 2)
assert.ok((source.match(/if \(selected\.kind === 'session'\) memoryMutationVersionRef\.current \+= 1/g) ?? []).length >= 2)

console.log('\n[8] 没有新增 storage key / API；只复用当前 token、session 和现有缓存')
assert.equal(source.includes('localStorage.setItem('), false)
assert.equal(source.includes('/api/'), false)

console.log('\nmemory page cloud refresh: all passed')
