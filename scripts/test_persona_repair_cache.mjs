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
  attemptPendingPersonaRepair,
  filterPendingPersonaRepairSession,
  rememberCompletedPersonaRepair,
  writePendingPersonaRepair,
} = await import('../src/lib/personaRepair.ts')
const {
  collectAllAIProfiles,
  loadLocalPersonaRepair,
} = await import('../src/lib/storage.ts')
const { setSessionsCache } = await import('../src/lib/sessionStore.ts')

const aSession = {
  id: 88,
  title: '阿沉',
  persona: '',
  created_at: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
}
const bSession = {
  id: 99,
  title: 'B 的角色',
  persona: '性格特质：正常',
  created_at: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
}

console.log('\n[persona repair profile] repair 跟 session profile 走，不污染 sessions cache')
setSessionsCache([aSession])
writePendingPersonaRepair(aSession, {
  account: 'a@example.com',
  persona: '角色昵称：阿沉\n性格特质：第一行\n第二行',
  title: '阿沉',
  transactionId: 'tx-a',
})
assert.equal(loadLocalPersonaRepair('88')?.state, 'pending')
assert.equal(loadLocalPersonaRepair('88')?.transactionId, 'tx-a')
assert.deepEqual(filterPendingPersonaRepairSession([aSession], 'a@example.com'), [])

console.log('[persona repair profile] Cloud State 只看到正常 AIProfile 字段')
const profiles = collectAllAIProfiles()
assert.ok(profiles['88'])
assert.equal(Object.hasOwn(profiles['88'], '__personaRepair'), false)

console.log('[persona repair profile] 切账号只换 sessions cache，不会动 A session 的 repair 元数据')
setSessionsCache([bSession])
assert.equal(loadLocalPersonaRepair('88')?.transactionId, 'tx-a')
assert.deepEqual(
  filterPendingPersonaRepairSession([bSession], 'b@example.com').map((s) => s.id),
  [99],
)

console.log('[persona repair profile] 回到 A 时 server sessions 可重新识别 pending')
assert.deepEqual(filterPendingPersonaRepairSession([aSession], 'a@example.com'), [])

console.log('[persona repair profile] 另一标签修好后保留 completed transaction，旧标签可直接复用')
const repaired = { ...aSession, persona: '角色昵称：阿沉\n性格特质：第一行\n第二行' }
rememberCompletedPersonaRepair(repaired, {
  account: 'a@example.com',
  id: 88,
  persona: repaired.persona,
  title: '阿沉',
  transactionId: 'tx-a',
})
assert.equal(loadLocalPersonaRepair('88')?.state, 'repaired')
const reused = await attemptPendingPersonaRepair('token', 'a@example.com', 'tx-a', [repaired])
assert.equal(reused.kind, 'repaired')
assert.equal(reused.session.id, 88)

console.log('personaRepair profile: all assertions passed')
