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
  mergeSessionMemories,
  sessionMemoryToItem,
} = await import('../src/lib/sessionStore.ts')

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

console.log('\n[4] 页面挂载明确走 listMemories → sessionMemoryToItem → mergeSessionMemories')
const source = fs.readFileSync(path.join(process.cwd(), 'src/components/Memory.tsx'), 'utf8')
assert.match(source, /import \{ listMemories \} from '\.\.\/lib\/sessionApi'/)
assert.match(source, /res\.data\.memories\.map\(sessionMemoryToItem\)/)
assert.match(source, /mergeSessionMemories\(getMemoriesCache\(sessionId\), cloudMemories/)
assert.match(source, /purgeMissing: true/)
assert.match(source, /sessionId,/)

console.log('\n[5] 页内会话记忆改/删后，旧 GET 结果必须因 mutation version 变化而失效')
assert.match(source, /const memoryMutationVersionRef = useRef\(0\)/)
assert.match(source, /startedAtMutationVersion = memoryMutationVersionRef\.current/)
assert.ok((source.match(/memoryMutationVersionRef\.current !== startedAtMutationVersion/g) ?? []).length >= 2)
assert.ok((source.match(/if \(selected\.kind === 'session'\) memoryMutationVersionRef\.current \+= 1/g) ?? []).length >= 2)

console.log('\n[6] 没有新增 storage key / API；只复用当前 token、session 和现有缓存')
assert.equal(source.includes('localStorage.setItem('), false)
assert.equal(source.includes('/api/'), false)

console.log('\nmemory page cloud refresh: all passed')
