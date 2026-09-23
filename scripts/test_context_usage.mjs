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
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
}

const {
  getContextUsage,
  setContextUsage,
  clearContextUsage,
  collectAllContextUsages,
  applyCloudContextUsages,
  setSessionStart,
  getSessionStart,
} = await import('../src/lib/storage.ts')

const base = {
  sessionStart: 100,
  used: 13000,
  budget: 64000,
  source: 'actual',
  inputTokens: 12900,
  outputTokens: 100,
  cachedTokens: 9000,
  updatedAt: 1000,
}

setContextUsage(base, 'S1')
assert.deepEqual(getContextUsage('S1'), base, 'session usage persists locally')
assert.equal(getContextUsage('S2'), null, 'usage is isolated by session')

setSessionStart(100, 'S1')
assert.deepEqual(getContextUsage('S1'), base, 'same sessionStart does not clear usage')

const packed = collectAllContextUsages()
assert.deepEqual(packed.S1, base, 'usage is included in full sync payload')

applyCloudContextUsages({
  S1: { ...base, used: 12000, updatedAt: 900 },
})
assert.equal(getContextUsage('S1').used, 13000, 'older cloud state cannot overwrite newer local state')

applyCloudContextUsages({
  S1: { ...base, used: 14000, updatedAt: 1100 },
})
assert.equal(getContextUsage('S1').used, 14000, 'newer state in same context segment wins')

applyCloudContextUsages({
  S1: { ...base, sessionStart: 200, used: 3000, updatedAt: 800 },
})
assert.equal(getContextUsage('S1').sessionStart, 200, 'newer context segment wins even with older updatedAt')
assert.equal(getContextUsage('S1').used, 3000, 'newer context segment replaces previous usage')

setSessionStart(300, 'S1')
assert.equal(getSessionStart('S1'), 300, 'session start advances')
assert.equal(getContextUsage('S1'), null, 'advancing sessionStart clears stale context usage')

clearContextUsage('S1')
assert.equal(getContextUsage('S1'), null, 'explicit clear is safe')

console.log('context usage lifecycle: PASS')
