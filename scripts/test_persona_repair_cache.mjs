import assert from 'node:assert/strict'

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
  readPendingPersonaRepair,
  writePendingPersonaRepair,
  clearPendingPersonaRepair,
  filterPendingPersonaRepairSession,
  preservePendingPersonaRepairInCache,
} = await import('../src/lib/personaRepair.ts')
const { getSessionsCache, setSessionsCache } = await import('../src/lib/sessionStore.ts')

const session = {
  id: 88,
  title: '阿沉',
  persona: '',
  created_at: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
}
const other = {
  id: 77,
  title: '正常角色',
  persona: '性格特质：温柔',
  created_at: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:00:00.000Z',
}

console.log('\n[persona repair cache] 不新增 key，复用现有 sessions cache')
setSessionsCache([other])
writePendingPersonaRepair(session, {
  account: 'user@example.com',
  persona: '角色昵称：阿沉\n性格特质：第一行\n第二行',
  title: '阿沉',
})
assert.deepEqual([...store.keys()], ['ai_companion_sessions_cache'])
assert.equal(getSessionsCache().length, 2)
assert.deepEqual(readPendingPersonaRepair('user@example.com'), {
  account: 'user@example.com',
  id: 88,
  persona: '角色昵称：阿沉\n性格特质：第一行\n第二行',
  title: '阿沉',
})

console.log('[persona repair cache] 正常 UI / 路由必须隐藏 pending session')
const serverList = [other, { ...session, persona: '' }]
assert.deepEqual(
  filterPendingPersonaRepairSession(serverList, 'user@example.com').map((s) => s.id),
  [77],
)

console.log('[persona repair cache] server 列表刷新不能覆盖 repair 标记')
const refreshed = preservePendingPersonaRepairInCache([other, { ...session, persona: '' }], 'user@example.com')
setSessionsCache(refreshed)
assert.equal(readPendingPersonaRepair('user@example.com')?.id, 88)
assert.equal(filterPendingPersonaRepairSession(getSessionsCache(), 'user@example.com').some((s) => s.id === 88), false)

console.log('[persona repair cache] 修复完成清标记但保留 session')
clearPendingPersonaRepair('user@example.com', 88)
assert.equal(readPendingPersonaRepair('user@example.com'), null)
const cleaned = getSessionsCache().find((s) => s.id === 88)
assert.ok(cleaned)
assert.equal(Object.hasOwn(cleaned, '__personaRepair'), false)

console.log('personaRepair cache: all assertions passed')
