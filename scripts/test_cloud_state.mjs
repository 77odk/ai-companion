import assert from 'node:assert/strict'
import test from 'node:test'

class StorageMock {
  #values = new Map()
  failMetadataWrites = false
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null }
  setItem(key, value) {
    if (this.failMetadataWrites && key === 'ai_companion_cloud_state_metadata') return
    this.#values.set(key, String(value))
  }
  removeItem(key) { this.#values.delete(key) }
  clear() { this.#values.clear() }
}

globalThis.localStorage = new StorageMock()
globalThis.window = new EventTarget()
globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })

const cloud = await import('../src/lib/cloudState.ts')
const store = await import('../src/lib/sessionStore.ts')
const sync = await import('../src/lib/sync.ts')

function login(account = 'account-a') {
  localStorage.setItem('ai_companion_account', JSON.stringify({ account, token: `token-${account}` }))
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function pullBody(cursor, changes = [], hasMore = false, serverRevision = cursor) {
  return { ok: true, cursor, serverRevision, hasMore, changes }
}

function entity(entityId, version, extra = {}) {
  return { kind: 'test_kind', entityId, version, payload: { entityId }, ...extra }
}

function clearState(account = 'account-a') {
  localStorage.clear()
  localStorage.failMetadataWrites = false
  login(account)
}

test('A/D/E/F/V1: pull applies before cursor, is idempotent, preserves unknown kinds, and dispatches tombstones', async () => {
  clearState()
  const applied = []
  const deleted = []
  const unregister = cloud.registerCloudStateAdapter('test_kind', {
    apply(value, context) {
      assert.equal(cloud.getCloudStateCursor(), 0)
      assert.deepEqual(context, { source: 'cloud', silent: true })
      applied.push(value.entityId)
    },
    delete(value) { deleted.push(value.entityId) },
  })
  const changes = [entity('one', 1), entity('gone', 1, { deleted: true }), { kind: 'future_kind', entityId: 'new', version: 2 }]
  globalThis.fetch = async () => jsonResponse(pullBody(3, changes))
  await cloud.pullCloudState()
  assert.equal(cloud.getCloudStateCursor(), 3)
  assert.deepEqual(applied, ['one'])
  assert.deepEqual(deleted, ['gone'])
  assert.equal(cloud.getCloudStateVersion('future_kind', 'new'), 0)
  assert.deepEqual(cloud.getCloudStateInbox('future_kind'), [{ kind: 'future_kind', entityId: 'new', version: 2 }])
  await cloud.pullCloudState()
  assert.deepEqual(applied, ['one'])
  assert.deepEqual(deleted, ['gone'])
  unregister()
})

test('V2/V7: registering an adapter replays an unknown production entity without another server change', async () => {
  clearState()
  const historical = {
    kind: 'space_post', entityId: 'post-10', sessionId: 'session-1', generationSlotId: 'slot-1',
    version: 10, deleted: false, payload: { text: 'historical post' },
  }
  globalThis.fetch = async () => jsonResponse(pullBody(10, [historical]))
  await cloud.pullCloudState()
  assert.equal(cloud.getCloudStateCursor(), 10)
  assert.deepEqual(cloud.getCloudStateInbox('space_post'), [historical])

  const applied = []
  const unregister = cloud.registerCloudStateAdapter('space_post', {
    apply(value, context) { applied.push([value, context]) },
    delete() {},
  })
  await cloud.replayCloudStateInbox('space_post')
  assert.deepEqual(applied, [[historical, { source: 'cloud', silent: true }]])
  assert.deepEqual(cloud.getCloudStateInbox('space_post'), [])
  assert.equal(cloud.getCloudStateVersion('space_post', 'post-10'), 10)

  globalThis.fetch = async () => jsonResponse(pullBody(10, []))
  await cloud.pullCloudState()
  assert.equal(applied.length, 1)
  unregister()
})

test('V3: a newer unknown tombstone replaces the older normal entity', async () => {
  clearState()
  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'unknown_delete', entityId: 'same', version: 1, payload: { old: true } },
    { kind: 'unknown_delete', entityId: 'same', version: 2, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.deepEqual(cloud.getCloudStateInbox('unknown_delete'), [
    { kind: 'unknown_delete', entityId: 'same', version: 2, deleted: true },
  ])
  const calls = []
  const unregister = cloud.registerCloudStateAdapter('unknown_delete', {
    apply() { calls.push('apply') },
    delete(value) { calls.push(`delete:${value.version}`) },
  })
  await cloud.replayCloudStateInbox('unknown_delete')
  assert.deepEqual(calls, ['delete:2'])
  unregister()
})

test('V4: registering an adapter under account B cannot consume account A inbox', async () => {
  clearState('A')
  globalThis.fetch = async () => jsonResponse(pullBody(1, [{ kind: 'account_kind', entityId: 'a', version: 1 }]))
  await cloud.pullCloudState()
  login('B')
  const applied = []
  const unregister = cloud.registerCloudStateAdapter('account_kind', {
    apply(value) { applied.push(value.entityId) }, delete() {},
  })
  await cloud.replayCloudStateInbox('account_kind')
  assert.deepEqual(applied, [])
  assert.deepEqual(cloud.getCloudStateInbox('account_kind'), [])
  login('A')
  await cloud.replayCloudStateInbox('account_kind')
  assert.deepEqual(applied, ['a'])
  unregister()
})

test('V5: failed replay remains in inbox and is removed only after success', async () => {
  clearState()
  globalThis.fetch = async () => jsonResponse(pullBody(1, [{ kind: 'retry_kind', entityId: 'retry', version: 5 }]))
  await cloud.pullCloudState()
  let fail = true
  const unregister = cloud.registerCloudStateAdapter('retry_kind', {
    apply() { if (fail) throw new Error('not ready') }, delete() {},
  })
  await cloud.replayCloudStateInbox('retry_kind')
  assert.equal(cloud.getCloudStateInbox('retry_kind').length, 1)
  assert.equal(cloud.getCloudStateVersion('retry_kind', 'retry'), 0)
  fail = false
  await cloud.replayCloudStateInbox('retry_kind')
  assert.deepEqual(cloud.getCloudStateInbox('retry_kind'), [])
  assert.equal(cloud.getCloudStateVersion('retry_kind', 'retry'), 5)
  unregister()
})

test('V6: unknown inbox persistence failure prevents page cursor advancement', async () => {
  clearState()
  localStorage.failMetadataWrites = true
  globalThis.fetch = async () => jsonResponse(pullBody(9, [{ kind: 'cannot_store', entityId: 'lost', version: 9 }]))
  await assert.rejects(cloud.pullCloudState(), /not_persisted/)
  localStorage.failMetadataWrites = false
  assert.equal(cloud.getCloudStateCursor(), 0)
  assert.deepEqual(cloud.getCloudStateInbox('cannot_store'), [])
})

test('B: hasMore pulls every page without jumping to serverRevision', async () => {
  clearState()
  let count = 0
  const cursors = []
  const unregister = cloud.registerCloudStateAdapter('test_kind', { apply() { count++ }, delete() {} })
  const first = Array.from({ length: 500 }, (_, index) => entity(`page1-${index}`, index + 1))
  globalThis.fetch = async url => {
    const cursor = Number(new URL(url).searchParams.get('cursor'))
    cursors.push(cursor)
    return cursor === 0
      ? jsonResponse(pullBody(500, first, true, 501))
      : jsonResponse(pullBody(501, [entity('page2', 501)], false, 501))
  }
  await cloud.pullCloudState()
  assert.deepEqual(cursors, [0, 500])
  assert.equal(count, 501)
  assert.equal(cloud.getCloudStateCursor(), 501)
  unregister()
})

test('C: an apply failure does not advance the page cursor', async () => {
  clearState()
  const unregister = cloud.registerCloudStateAdapter('test_kind', {
    apply(value) { if (value.entityId === 'bad') throw new Error('adapter failed') },
    delete() {},
  })
  globalThis.fetch = async () => jsonResponse(pullBody(2, [entity('good', 1), entity('bad', 2)]))
  await assert.rejects(cloud.pullCloudState(), /adapter failed/)
  assert.equal(cloud.getCloudStateCursor(), 0)
  assert.equal(cloud.getCloudStateVersion('test_kind', 'good'), 1)
  unregister()
})

test('G-K: push handles each result independently and preserves retryable errors', async () => {
  clearState()
  const conflicts = []
  const unregister = cloud.registerCloudStateAdapter('test_kind', { apply(value) { conflicts.push(value.payload) }, delete() {} })
  for (const [opId, entityId] of [['applied', 'a'], ['duplicate', 'd'], ['conflict', 'c'], ['invalid', 'i'], ['error', 'e']]) {
    cloud.enqueueCloudStateOp({ opId, kind: 'test_kind', entityId, baseVersion: 0, payload: { local: true } })
  }
  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(init.body).ops
    assert.equal(sent[0].accountId, undefined)
    return jsonResponse({ results: [
      { opId: 'applied', status: 'applied', version: 4 },
      { opId: 'duplicate', status: 'duplicate', entity: entity('d', 5) },
      { opId: 'conflict', status: 'conflict', entity: entity('c', 6, { payload: { server: true } }) },
      { opId: 'invalid', status: 'invalid' },
      { opId: 'error', status: 'error' },
    ] })
  }
  await cloud.flushCloudStatePendingOps()
  assert.deepEqual(store.getPendingOps().map(op => op.id), ['error'])
  assert.equal(cloud.getCloudStateVersion('test_kind', 'a'), 4)
  assert.equal(cloud.getCloudStateVersion('test_kind', 'd'), 5)
  assert.equal(cloud.getCloudStateVersion('test_kind', 'c'), 6)
  assert.deepEqual(conflicts, [{ server: true }])
  unregister()
})

test('K/P: network failure and 503 retain pending ops and do not advance cursor', async () => {
  clearState()
  cloud.enqueueCloudStateOp({ opId: 'retry', kind: 'test_kind', entityId: 'r', baseVersion: 0 })
  globalThis.fetch = async () => { throw new TypeError('offline') }
  await cloud.flushCloudStatePendingOps()
  assert.equal(store.getPendingOps().length, 1)
  globalThis.fetch = async () => jsonResponse({ error: 'cloud_state_schema_unavailable' }, 503)
  await assert.rejects(cloud.pullCloudState(), /503/)
  assert.equal(cloud.getCloudStateCursor(), 0)
  await cloud.flushCloudStatePendingOps()
  assert.equal(store.getPendingOps().length, 1)
})

test('L: more than 100 pending operations are sent in bounded batches', async () => {
  clearState()
  for (let index = 0; index < 205; index++) {
    cloud.enqueueCloudStateOp({ opId: `op-${index}`, kind: 'test_kind', entityId: `${index}`, baseVersion: 0 })
  }
  const sizes = []
  globalThis.fetch = async (_url, init) => {
    const ops = JSON.parse(init.body).ops
    sizes.push(ops.length)
    return jsonResponse({ results: ops.map(op => ({ opId: op.opId, status: 'applied', version: 1 })) })
  }
  await cloud.flushCloudStatePendingOps()
  assert.deepEqual(sizes, [100, 100, 5])
  assert.equal(store.getPendingOps().length, 0)
})

test('M/N: concurrent pulls share one flight and a later pull rereads the latest cursor', async () => {
  clearState()
  const requested = []
  let release
  const gate = new Promise(resolve => { release = resolve })
  globalThis.fetch = async url => {
    const cursor = Number(new URL(url).searchParams.get('cursor'))
    requested.push(cursor)
    if (requested.length === 1) await gate
    return jsonResponse(pullBody(cursor + 1))
  }
  const first = cloud.pullCloudState()
  const second = cloud.pullCloudState()
  release()
  await Promise.all([first, second])
  assert.deepEqual(requested, [0])
  await cloud.pullCloudState()
  assert.deepEqual(requested, [0, 1])
})

test('O: cursor, versions, and queued cloud ops are isolated by account', async () => {
  clearState('A')
  const unregister = cloud.registerCloudStateAdapter('test_kind', { apply() {}, delete() {} })
  globalThis.fetch = async () => jsonResponse(pullBody(7, [entity('shared', 3)]))
  await cloud.pullCloudState()
  cloud.enqueueCloudStateOp({ opId: 'a-only', kind: 'test_kind', entityId: 'a', baseVersion: 0 })
  login('B')
  assert.equal(cloud.getCloudStateCursor(), 0)
  assert.equal(cloud.getCloudStateVersion('test_kind', 'shared'), 0)
  let pushed = 0
  globalThis.fetch = async () => { pushed++; return jsonResponse({ results: [] }) }
  await cloud.flushCloudStatePendingOps()
  assert.equal(pushed, 0)
  login('A')
  assert.equal(cloud.getCloudStateCursor(), 7)
  assert.equal(cloud.getCloudStateVersion('test_kind', 'shared'), 3)
  unregister()
})

test('Q/R: cloud apply is explicitly silent and session cache does not emit legacy data change', async () => {
  clearState()
  let dataChanges = 0
  window.addEventListener('eluvin-data-change', () => { dataChanges++ })
  let context
  const unregister = cloud.registerCloudStateAdapter('test_kind', { apply(_value, ctx) { context = ctx }, delete() {} })
  globalThis.fetch = async () => jsonResponse(pullBody(1, [entity('silent', 1)]))
  await cloud.pullCloudState()
  store.saveMessagesCache('session', [{ role: 'user', content: 'local', ts: 1 }])
  assert.deepEqual(context, { source: 'cloud', silent: true })
  assert.equal(dataChanges, 0)
  unregister()
})

test('S/T: legacy message and memory pending operations retain their queue shape', () => {
  clearState()
  store.addPendingOp({ id: 'message', type: 'message', sessionId: 's', payload: { role: 'user', content: 'hi' }, ts: 1 })
  store.addPendingOp({ id: 'memory', type: 'memory', sessionId: 's', payload: { content: 'memo' }, ts: 2 })
  assert.deepEqual(store.getPendingOps().map(op => op.type), ['message', 'memory'])
})

test('U: legacy syncNow still pulls and pushes /api/sync', async () => {
  clearState()
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push([url, init.method ?? 'GET'])
    return init.method === 'POST' ? jsonResponse({ ok: true }) : jsonResponse({ data: null })
  }
  await sync.syncNow()
  assert.deepEqual(calls.map(([url, method]) => [new URL(url).pathname, method]), [
    ['/api/sync', 'GET'], ['/api/sync', 'POST'],
  ])
})
