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
  key(index) { return [...this.#values.keys()][index] ?? null }
  get length() { return this.#values.size }
}

globalThis.localStorage = new StorageMock()
globalThis.window = new EventTarget()
globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })

const cloud = await import('../src/lib/cloudState.ts')
const store = await import('../src/lib/sessionStore.ts')
const sync = await import('../src/lib/sync.ts')
const resources = await import('../src/lib/cloudStateResources.ts')
const storage = await import('../src/lib/storage.ts')
const theme = await import('../src/lib/theme.ts')
const anniversary = await import('../src/lib/anniversary.ts')
const aiSpace = await import('../src/lib/aiSpace.ts')
const taRuntime = await import('../src/lib/taRuntime.ts')
const weeklyReview = await import('../src/lib/weeklyReview.ts')
const companionPolicy = await import('../src/lib/companionPolicy.ts')
const replyLength = await import('../src/lib/replyLength.ts')

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
  assert.equal(cloud.getCloudStateVersion('space_post', 'post-10', undefined, 'session-1'), 10)

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

test('W / RUNTIME-CS-3: registering production adapters replays historical inbox entities and tombstones silently', async () => {
  clearState()
  localStorage.setItem('ai_companion_settings', JSON.stringify({
    provider: 'deepseek',
    providers: { deepseek: { apiKey: 'local-key', baseUrl: 'local-url', model: 'local-model' } },
  }))
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'couple', label: '认识 TA', date: '01-01', createdAt: 1 },
  ]))
  localStorage.setItem('ai_companion_anniversaries_role-old', JSON.stringify([
    { id: 'gone', label: '待删除', date: '01-02', createdAt: 1 },
  ]))
  const historical = [
    { kind: 'theme', entityId: 'global', version: 1, payload: { type: 'preset', presetId: 'mist' } },
    { kind: 'gender', entityId: 'role-1', version: 1, payload: { g: 'female', locked: true } },
    { kind: 'model_settings', entityId: 'global', version: 1, payload: {
      provider: 'deepseek', baseUrl: 'remote-url', model: 'remote-model', apiKey: 'hostile-key',
      providers: { deepseek: { baseUrl: 'remote-url', model: 'remote-model', token: 'hostile-token' } },
    } },
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', createdAt: 2, kind: 'personal' },
    ] },
    { kind: 'anniversary', entityId: 'seeded', version: 1,
      payload: { id: 'seeded', label: '历史账号纪念日', date: '03-04', createdAt: 3 } },
    { kind: 'anniversary', entityId: 'gone', sessionId: 'role-old', version: 1, deleted: true },
    { kind: 'anniversary', entityId: 'same', sessionId: 'A', version: 3,
      payload: { id: 'same', label: 'A 同 ID', date: '04-05', createdAt: 4 } },
    { kind: 'anniversary', entityId: 'same', sessionId: 'B', version: 8,
      payload: { id: 'same', label: 'B 同 ID', date: '05-06', createdAt: 5 } },
    { kind: 'ta_runtime', entityId: 'runtime-history', sessionId: 'runtime-history', version: 6,
      payload: { activityId: 'reading', label: '正在看书', startedAt: 1, plannedUntil: 10, updatedAt: 2, source: 'routine' } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(8, historical))
  await cloud.pullCloudState()
  assert.equal(cloud.getCloudStateInbox().length, 9)
  assert.equal(cloud.getCloudStateInbox('anniversary').filter(item => item.entityId === 'same').length, 2)
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ }, { once: true })
  resources.initCloudStateResourceAdapters()
  await cloud.replayCloudStateInbox()
  assert.deepEqual(cloud.getCloudStateInbox(), [])
  assert.equal(legacyChanges, 0)
  assert.equal(theme.loadThemeState().presetId, 'mist')
  assert.equal(storage.loadAIGender('role-1'), 'female')
  const settings = storage.loadSettings()
  assert.equal(settings.model, 'remote-model')
  assert.equal(settings.baseUrl, 'remote-url')
  assert.equal(settings.apiKey, 'local-key')
  assert.equal(JSON.stringify(readStoredSettings()).includes('hostile'), false)
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id), ['seeded', 'birthday', 'couple'])
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries_role-old')), [])
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_A'))[0].label, 'A 同 ID')
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_B'))[0].label, 'B 同 ID')
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'A'), 3)
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'B'), 8)
  assert.equal(taRuntime.getTaRuntime('runtime-history').activityId, 'reading')
  assert.equal(cloud.getCloudStateVersion('ta_runtime', 'runtime-history', undefined, 'runtime-history'), 6)
  assert.equal(cloudOps('ta_runtime').length, 0)
})

function cloudOps(kind) {
  return store.getPendingOps().filter(op => op.type === 'cloud-state' && op.kind === kind)
}

function readStoredSettings() {
  return JSON.parse(localStorage.getItem('ai_companion_settings') ?? '{}')
}

const runtimeState = (label, updatedAt = 100) => ({
  activityId: 'reading', label, startedAt: 10, plannedUntil: 9999999999999, updatedAt, source: 'routine',
})

test('RUNTIME-CS-1/6: local create queues once, reads and unrelated changes do not, and _guest stays local', () => {
  clearState('runtime-local')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  taRuntime.getOrAdvanceTaRuntime('A', '', 1000, () => 0.5)
  let ops = cloudOps('ta_runtime')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].entityId, 'A')
  assert.equal(ops[0].sessionId, 'A')
  assert.equal(ops[0].baseVersion, 0)
  assert.equal(ops[0].payload.activityId, taRuntime.getTaRuntime('A').activityId)

  taRuntime.getOrAdvanceTaRuntime('A', '', 1001, () => 0.9)
  window.dispatchEvent(new Event('eluvin-data-change'))
  taRuntime.getOrAdvanceTaRuntime(undefined, '', 1000, () => 0.5)
  ops = cloudOps('ta_runtime')
  assert.equal(ops.length, 1)
  assert.equal(ops.some(op => op.entityId === '_guest'), false)
})

test('RUNTIME-CS-2/5: canonical apply and tombstone affect only their exact session without echo', async () => {
  clearState('runtime-exact')
  localStorage.setItem('ai_companion_ta_runtime', JSON.stringify({ A: runtimeState('A local', 900), B: runtimeState('B local', 800) }))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ })
  globalThis.fetch = async () => jsonResponse(pullBody(1, [
    { kind: 'ta_runtime', entityId: 'A', sessionId: 'A', version: 1, payload: runtimeState('A server', 1) },
  ]))
  await cloud.pullCloudState()
  assert.equal(taRuntime.getTaRuntime('A').label, 'A server')
  assert.equal(taRuntime.getTaRuntime('B').label, 'B local')
  assert.equal(legacyChanges, 0)
  assert.equal(cloudOps('ta_runtime').length, 0)

  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'ta_runtime', entityId: 'A', sessionId: 'A', version: 2, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.equal(taRuntime.getTaRuntime('A'), null)
  assert.equal(taRuntime.getTaRuntime('B').label, 'B local')
  window.dispatchEvent(new Event('eluvin-data-change'))
  assert.equal(cloudOps('ta_runtime').length, 0)
  assert.equal(legacyChanges, 1)
})

test('RUNTIME-CS-4: conflict canonical wins even with older payload updatedAt and does not echo', async () => {
  clearState('runtime-conflict')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  taRuntime.getOrAdvanceTaRuntime('A', '', 5000, () => 0.5)
  localStorage.setItem('ai_companion_ta_runtime', JSON.stringify({
    ...taRuntime.collectAllTaRuntime(), B: runtimeState('B untouched', 700),
  }))
  const localOp = cloudOps('ta_runtime')[0]
  globalThis.fetch = async () => jsonResponse({ results: [{
    opId: localOp.opId, status: 'conflict', entity: {
      kind: 'ta_runtime', entityId: 'A', sessionId: 'A', version: 4, payload: runtimeState('A canonical', 1),
    },
  }] })
  await cloud.flushCloudStatePendingOps()
  assert.equal(taRuntime.getTaRuntime('A').label, 'A canonical')
  assert.equal(taRuntime.getTaRuntime('B').label, 'B untouched')
  assert.equal(cloudOps('ta_runtime').length, 0)
  window.dispatchEvent(new Event('eluvin-data-change'))
  assert.equal(cloudOps('ta_runtime').length, 0)
})

test('RUNTIME-CS legacy apply resets the V2 snapshot and malformed identities are ignored', async () => {
  clearState('runtime-legacy')
  localStorage.setItem('ai_companion_ta_runtime', JSON.stringify({ A: runtimeState('A old', 1), B: runtimeState('B stays', 1) }))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  taRuntime.applyCloudTaRuntime({ A: runtimeState('A legacy', 2) })
  window.dispatchEvent(new Event('eluvin-data-change'))
  assert.equal(cloudOps('ta_runtime').length, 0)

  globalThis.fetch = async () => jsonResponse(pullBody(1, [
    { kind: 'ta_runtime', entityId: 'A', version: 1, payload: runtimeState('missing scope', 9) },
    { kind: 'ta_runtime', entityId: 'A', sessionId: 'B', version: 1, payload: runtimeState('wrong scope', 9) },
    { kind: 'ta_runtime', entityId: 'B', sessionId: 'B', version: 1, payload: { broken: true } },
  ]))
  await cloud.pullCloudState()
  assert.equal(taRuntime.getTaRuntime('A').label, 'A legacy')
  assert.equal(taRuntime.getTaRuntime('B').label, 'B stays')
  assert.equal(cloudOps('ta_runtime').length, 0)
})

// 2026-09-17 修：云同步上线后「性别又松了」——云端那份性别是 9/15 由旧 blob 播种的
// locked:false（legacy 导入规则不许覆盖已有 V2，所以本地后来锁定的状态传不上去），
// 而 applyGenderEntity 当时直接照抄云端，一拉就把本机「已锁定」降级成「可选」。
// 这条测试锁死规则：与 storage.applyCloudGenders 一致 —— 本机已锁不动，本机未锁才让云端的锁带回来。
test('GENDER-CS-LOCK: 云端 locked:false 不许冲开本机已锁的性别；云端锁能带回新设备', async () => {
  clearState()
  resources.initCloudStateResourceAdapters()
  localStorage.setItem('ai_companion_ai_gender_role-locked', JSON.stringify({ g: 'male', locked: true }))
  localStorage.setItem('ai_companion_ai_gender_role-open', 'female') // 老格式裸值 = 未锁
  const changes = [
    { kind: 'gender', entityId: 'role-locked', version: 11, payload: { g: 'female', locked: false } },
    { kind: 'gender', entityId: 'role-open', version: 12, payload: { g: 'male', locked: true } },
    { kind: 'gender', entityId: 'role-new', version: 13, payload: { g: 'female', locked: true } },
    { kind: 'gender', entityId: 'global', version: 14, payload: { g: 'female', locked: false } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(14, changes))
  await cloud.pullCloudState()
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_ai_gender_role-locked')), { g: 'male', locked: true })
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_ai_gender_role-open')), { g: 'male', locked: true })
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_ai_gender_role-new')), { g: 'female', locked: true })
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_ai_gender')), { g: 'female', locked: false })
  assert.equal(storage.loadAIGenderState('role-locked').locked, true, '读取层仍认为已锁定')
})

test('X: local theme, gender, model settings, and personal-day writes create scoped cloud ops', () => {
  clearState('A')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  theme.saveThemeState({ type: 'custom', customColor: '#123456' })
  resources.queueThemeCloudChange(theme.loadThemeState())
  storage.saveAIGender('male', 'role-a')
  storage.saveSettings({ provider: 'openai', apiKey: 'sk-local', baseUrl: 'https://models.test', model: 'model-a' })
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'period', label: '生理期', date: '2026-09-01', createdAt: 3, kind: 'personal', periodDays: 28 },
  ]))
  window.dispatchEvent(new Event('eluvin-data-change'))

  assert.equal(cloudOps('theme').length, 1)
  assert.equal(cloudOps('gender')[0].entityId, 'role-a')
  assert.equal(cloudOps('personal_day').length, 1)
  const modelOp = cloudOps('model_settings')[0]
  assert.equal(modelOp.entityId, 'global')
  assert.equal(modelOp.baseVersion, 0)
  assert.notEqual(modelOp.opId, cloudOps('theme')[0].opId)
  assert.equal(JSON.stringify(modelOp.payload).includes('sk-local'), false)
})

test('Y: model payload scrub removes credential spellings recursively', () => {
  const dirty = {
    apiKey: 'a', api_key: 'b', apikey: 'c', apiSecret: 'd', api_secret: 'e', secret: 'f', token: 'g',
    accessToken: 'h', access_token: 'i', authToken: 'j', auth_token: 'k', password: 'l',
    providers: { custom: { model: 'safe', Authorization: 'm', credentials: { token: 'n' } } },
  }
  assert.deepEqual(resources.scrubModelSettings(dirty), { providers: { custom: { model: 'safe' } } })
})

test('Z: cloud applies and tombstones stay silent, preserve credentials, and restore existing empty/default states', async () => {
  clearState()
  localStorage.setItem('ai_companion_settings', JSON.stringify({
    provider: 'custom', providers: { custom: { apiKey: 'keep-me', baseUrl: 'old', model: 'old' } },
  }))
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ })
  globalThis.fetch = async () => jsonResponse(pullBody(1, [
    { kind: 'theme', entityId: 'global', version: 2, payload: { type: 'preset', presetId: 'clay' } },
    { kind: 'gender', entityId: 'role-z', version: 2, payload: { g: 'male', locked: true } },
    { kind: 'model_settings', entityId: 'global', version: 2, payload: {
      provider: 'custom', providers: { custom: { apiKey: 'remote-bad', baseUrl: 'new', model: 'new' } },
    } },
    { kind: 'personal_day', entityId: 'global', version: 2, payload: [
      { id: 'birthday-z', label: '我的生日', date: '04-05', createdAt: 4, kind: 'personal' },
    ] },
  ]))
  await cloud.pullCloudState()
  assert.equal(legacyChanges, 0)
  assert.equal(store.getPendingOps().length, 0)
  assert.equal(storage.loadSettings().apiKey, 'keep-me')
  assert.equal(storage.loadSettings().model, 'new')

  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'theme', entityId: 'global', version: 3, deleted: true },
    { kind: 'gender', entityId: 'role-z', version: 3, deleted: true },
    { kind: 'model_settings', entityId: 'global', version: 3, deleted: true },
    { kind: 'personal_day', entityId: 'global', version: 3, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.equal(theme.loadThemeState().presetId, 'peach')
  assert.equal(storage.loadAIGenderState('role-z').own, false)
  assert.equal(storage.loadSettings().provider, 'zhipu')
  assert.equal(readStoredSettings().providers.custom.apiKey, 'keep-me')
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries')), [])
  assert.equal(legacyChanges, 0)
  assert.equal(store.getPendingOps().length, 0)
})

test('AA: cloud resource metadata and pending operations do not cross accounts', async () => {
  clearState('A')
  globalThis.fetch = async () => jsonResponse(pullBody(1, [
    { kind: 'theme', entityId: 'global', version: 7, payload: { type: 'preset', presetId: 'ink' } },
  ]))
  await cloud.pullCloudState()
  storage.saveAIGender('female', 'role-a')
  login('B')
  assert.equal(cloud.getCloudStateVersion('theme', 'global'), 0)
  assert.equal(cloudOps('gender').filter(op => op.accountId === 'B').length, 0)
  storage.saveAIGender('male', 'role-b')
  assert.equal(cloudOps('gender').filter(op => op.accountId === 'B').length, 1)
  login('A')
  assert.equal(cloud.getCloudStateVersion('theme', 'global'), 7)
})

test('AB: local global/session anniversary writes, edits, main selection, and tombstones create scoped ops', () => {
  clearState('A')
  window.dispatchEvent(new Event('eluvin-auth-change'))

  anniversary.addAnniversary('账号纪念日', '06-01')
  let ops = cloudOps('anniversary')
  assert.equal(ops.length, 1)
  assert.match(ops[0].entityId, /^ann-/)
  assert.equal(ops[0].sessionId, undefined)
  assert.equal(ops[0].baseVersion, 0)
  const globalId = ops[0].payload.id

  anniversary.addAnniversary('在一起', '07-02', undefined, 'session-a')
  ops = cloudOps('anniversary')
  const sessionOp = ops.at(-1)
  assert.equal(sessionOp.entityId, sessionOp.payload.id)
  assert.equal(sessionOp.sessionId, 'session-a')
  assert.notEqual(sessionOp.opId, ops[0].opId)

  localStorage.setItem('ai_companion_cloud_state_metadata', JSON.stringify({ accounts: { A: {
    cursor: 0, inbox: {}, versions: { [`anniversary\u0000\u0000${globalId}`]: 7 },
  } } }))
  anniversary.updateAnniversary(globalId, '账号纪念日（新）', '06-02')
  ops = cloudOps('anniversary')
  assert.equal(ops.at(-1).baseVersion, 7)
  assert.notEqual(ops.at(-1).opId, ops[0].opId)

  anniversary.setMainAnniversaryId(globalId)
  assert.equal(cloudOps('anniversary').at(-1).payload.mainAnniversary, true)
  anniversary.removeAnniversary(globalId)
  const tombstone = cloudOps('anniversary').at(-1)
  assert.equal(tombstone.entityId, globalId)
  assert.equal(tombstone.deleted, true)
  assert.equal(localStorage.getItem('ai_companion_main_anniversary'), null)
})

test('AC: cloud anniversary apply and tombstone are silent, session-isolated, and preserve personal_day', async () => {
  clearState()
  window.dispatchEvent(new Event('eluvin-auth-change'))
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', createdAt: 1, kind: 'personal' },
  ]))
  localStorage.setItem('ai_companion_anniversaries_session-b', JSON.stringify([
    { id: 'same', label: 'B 的纪念日', date: '03-04', createdAt: 2 },
  ]))
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ })
  globalThis.fetch = async () => jsonResponse(pullBody(3, [
    { kind: 'anniversary', entityId: 'account-day', version: 1,
      payload: { id: 'account-day', label: '账号纪念日', date: '05-06', createdAt: 3 } },
    { kind: 'anniversary', entityId: 'same', sessionId: 'session-a', version: 1,
      payload: { id: 'same', label: 'A 的纪念日', date: '07-08', createdAt: 4, mainAnniversary: true } },
    { kind: 'anniversary', entityId: 'duplicate-birthday', version: 1,
      payload: { id: 'duplicate-birthday', label: '重复生日', date: '02-03', createdAt: 5, kind: 'personal' } },
  ]))
  await cloud.pullCloudState()
  const globalDays = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(globalDays.map(item => item.id).sort(), ['account-day', 'birthday'])
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries_session-a')).map(item => item.label), ['A 的纪念日'])
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries_session-b')).map(item => item.label), ['B 的纪念日'])
  assert.equal(localStorage.getItem('ai_companion_main_anniversary_session-a'), 'same')
  assert.equal(legacyChanges, 0)
  assert.equal(cloudOps('anniversary').length, 0)

  globalThis.fetch = async () => jsonResponse(pullBody(4, [
    { kind: 'anniversary', entityId: 'same', sessionId: 'session-a', version: 2, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries_session-a')), [])
  assert.equal(localStorage.getItem('ai_companion_main_anniversary_session-a'), null)
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_session-b'))[0].id, 'same')
  assert.equal(legacyChanges, 0)
  assert.equal(cloudOps('anniversary').length, 0)
})

test('AD: historical anniversary inbox replays after adapter registration without a server resend', async () => {
  clearState('inbox-account')
  // Simulate data pulled by Client Core before this release registered the production adapter.
  const globalId = 'default-08-25-1787593664030'
  const sessionId = 'default-09-11-1789064142210'
  const metadata = { accounts: { 'inbox-account': { cursor: 9, versions: {}, inbox: {
    [`anniversary\u0000${globalId}`]: {
      kind: 'anniversary', entityId: globalId, version: 8,
      payload: { id: globalId, label: '历史账号纪念日', date: '08-25', createdAt: 8 },
    },
    [`anniversary\u0000${sessionId}`]: {
      kind: 'anniversary', entityId: sessionId, sessionId: '53', version: 9,
      payload: { id: sessionId, label: '历史关系纪念日', date: '09-11', createdAt: 9 },
    },
  } } } }
  localStorage.setItem('ai_companion_cloud_state_metadata', JSON.stringify(metadata))
  await cloud.replayCloudStateInbox('anniversary')
  assert.deepEqual(cloud.getCloudStateInbox('anniversary'), [])
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries'))[0].id, globalId)
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_53'))[0].id, sessionId)
  assert.equal(cloudOps('anniversary').length, 0)
})

test('AE: stale anniversary conflict accepts the server entity without cloud or legacy echo', async () => {
  clearState('conflict-account')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  localStorage.setItem('ai_companion_anniversaries_session-c', JSON.stringify([
    { id: 'shared', label: '本地版本', date: '01-01', createdAt: 1 },
  ]))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const localOp = cloudOps('anniversary')[0]
  assert.equal(localOp.baseVersion, 0)
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ })
  globalThis.fetch = async () => jsonResponse({ results: [{
    opId: localOp.opId, status: 'conflict', entity: {
      kind: 'anniversary', entityId: 'shared', sessionId: 'session-c', version: 5,
      payload: { id: 'shared', label: '服务端版本', date: '02-02', createdAt: 1 },
    },
  }] })
  await cloud.flushCloudStatePendingOps()
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_session-c'))[0].label, '服务端版本')
  assert.equal(cloudOps('anniversary').length, 0)
  assert.equal(cloud.getCloudStateVersion('anniversary', 'shared', undefined, 'session-c'), 5)
  assert.equal(legacyChanges, 0)
})

test('AF: same anniversary id keeps versions, baseVersions, conflict, and tombstone isolated by session', async () => {
  clearState('same-id-account')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'anniversary', entityId: 'same', sessionId: 'A', version: 3,
      payload: { id: 'same', label: 'A 本地', date: '01-01', createdAt: 1 } },
    { kind: 'anniversary', entityId: 'same', sessionId: 'B', version: 8,
      payload: { id: 'same', label: 'B 本地', date: '02-02', createdAt: 2 } },
  ]))
  await cloud.pullCloudState()
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'A'), 3)
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'B'), 8)

  anniversary.updateAnniversary('same', 'A 编辑', '03-03', undefined, 'A')
  anniversary.updateAnniversary('same', 'B 编辑', '04-04', undefined, 'B')
  const aOp = cloudOps('anniversary').find(op => op.sessionId === 'A' && op.entityId === 'same')
  const bOp = cloudOps('anniversary').find(op => op.sessionId === 'B' && op.entityId === 'same')
  assert.equal(aOp.sessionId, 'A')
  assert.equal(aOp.baseVersion, 3)
  assert.equal(bOp.sessionId, 'B')
  assert.equal(bOp.baseVersion, 8)

  globalThis.fetch = async () => jsonResponse({ results: [
    { opId: aOp.opId, status: 'conflict', entity: { kind: 'anniversary', entityId: 'same', sessionId: 'A', version: 4,
      payload: { id: 'same', label: 'A 服务端', date: '05-05', createdAt: 1 } } },
    { opId: bOp.opId, status: 'error' },
  ] })
  await cloud.flushCloudStatePendingOps()
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'A'), 4)
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'B'), 8)
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_A'))[0].label, 'A 服务端')
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_B'))[0].label, 'B 编辑')

  globalThis.fetch = async () => jsonResponse(pullBody(3, [
    { kind: 'anniversary', entityId: 'same', sessionId: 'A', version: 5, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_A')).some(item => item.id === 'same'), false)
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_anniversaries_B'))[0].id, 'same')
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'A'), 5)
  assert.equal(cloud.getCloudStateVersion('anniversary', 'same', undefined, 'B'), 8)
})

test('AG: deployed metadata keys migrate lazily without resetting cursor or duplicating Batch A ops', async () => {
  clearState('legacy-metadata')
  localStorage.setItem('ai_companion_cloud_state_metadata', JSON.stringify({ accounts: { 'legacy-metadata': {
    cursor: 42,
    versions: { ['theme\u0000global']: 7, ['legacy_unknown\u0000old']: 9 },
    inbox: { ['legacy_unknown\u0000old']: { kind: 'legacy_unknown', entityId: 'old', version: 9, payload: { ok: true } } },
  } } }))
  assert.equal(cloud.getCloudStateCursor(), 42)
  assert.equal(cloud.getCloudStateVersion('theme', 'global'), 7)
  let metadata = JSON.parse(localStorage.getItem('ai_companion_cloud_state_metadata')).accounts['legacy-metadata']
  assert.equal(metadata.versions['theme\u0000\u0000global'], 7)
  assert.equal(metadata.versions['theme\u0000global'], undefined)
  assert.equal(cloud.getCloudStateInbox('legacy_unknown').length, 1)
  metadata = JSON.parse(localStorage.getItem('ai_companion_cloud_state_metadata')).accounts['legacy-metadata']
  assert.ok(metadata.inbox['legacy_unknown\u0000\u0000old'])
  assert.equal(metadata.inbox['legacy_unknown\u0000old'], undefined)

  let applied = 0
  const unregister = cloud.registerCloudStateAdapter('legacy_unknown', { apply() { applied++ }, delete() {} })
  await cloud.replayCloudStateInbox('legacy_unknown')
  await cloud.replayCloudStateInbox('legacy_unknown')
  assert.equal(applied, 0)
  assert.equal(cloud.getCloudStateCursor(), 42)
  assert.deepEqual(cloud.getCloudStateInbox('legacy_unknown'), [])
  assert.equal(store.getPendingOps().length, 0)
  unregister()
})

test('AA: personal_day array payload applies normally', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
      { id: 'memorial', label: '纪念日', date: '03-04', kind: 'personal', createdAt: 3 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['birthday', 'couple', 'memorial'])
  assert.equal(cloud.getCloudStateVersion('personal_day', 'global'), 1)
})

test('AB: personal_day single personal object payload applies as upsert (entityId = item id)', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'birthday', version: 1, payload:
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['birthday', 'couple'])
  assert.equal(days.find(day => day.id === 'birthday').label, '我的生日')
})

test('AC: array(v1) then single object(v2) keeps personal days, never clears to []', async () => {
  clearState()
  const changes1 = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes1))
  await cloud.pullCloudState()
  const changes2 = [
    { kind: 'personal_day', entityId: 'birthday', version: 2, payload:
      { id: 'birthday', label: '我的生日（改）', date: '02-04', kind: 'personal', createdAt: 3 } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(2, changes2))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal').length, 1)
  assert.equal(days.find(day => day.id === 'birthday').label, '我的生日（改）')
  assert.ok(days.length > 0, 'personal days must not become []')
})

test('AD: invalid object payload is safely ignored and never clears existing personal days', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: { broken: true, no: 'fields' } },
    { kind: 'personal_day', entityId: 'global', version: 2, payload: null },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(2, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal').length, 1)
  assert.equal(days.find(day => day.id === 'birthday').label, '我的生日')
  assert.equal(days.find(day => day.id === 'couple').label, '认识 TA')
})

test('AE: single object apply never overwrites couple/relationship anniversaries', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'anniv', label: '周年纪念', date: '06-06', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'birthday', version: 1, payload:
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['anniv', 'birthday'])
  assert.equal(days.find(day => day.id === 'anniv').label, '周年纪念')
})

test('AF: same-id re-apply does not duplicate entries', async () => {
  clearState()
  const changes1 = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes1))
  await cloud.pullCloudState()
  const changes2 = [
    { kind: 'personal_day', entityId: 'global', version: 2, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(2, changes2))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal' && day.id === 'birthday').length, 1)
})

test('AG: personal_day cloud apply is silent — no legacy echo, no duplicate cloud op', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([]))
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ }, { once: true })
  const changes = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes))
  await cloud.pullCloudState()
  await cloud.flushCloudStatePendingOps()
  assert.equal(legacyChanges, 0)
  assert.equal(store.getPendingOps().filter(op => op.kind === 'personal_day').length, 0)
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal').length, 1)
})

test('P1: single birthday update keeps other personal days and couple (upsert, not replace)', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    { id: 'period', label: '生理期', date: '10-10', kind: 'personal', createdAt: 3 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'birthday', version: 2, payload:
      { id: 'birthday', label: '我的生日（新版）', date: '02-04', kind: 'personal', createdAt: 4 } },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(2, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['birthday', 'couple', 'period'])
  assert.equal(days.find(day => day.id === 'birthday').label, '我的生日（新版）')
  assert.equal(days.find(day => day.id === 'period').label, '生理期')
})

test('P2: birthday single then period single — both survive', async () => {
  clearState()
  const b = { kind: 'personal_day', entityId: 'birthday', version: 1, payload: { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 } }
  globalThis.fetch = async () => jsonResponse(pullBody(1, [b]))
  await cloud.pullCloudState()
  const p = { kind: 'personal_day', entityId: 'period', version: 1, payload: { id: 'period', label: '生理期', date: '10-10', kind: 'personal', createdAt: 3 } }
  globalThis.fetch = async () => jsonResponse(pullBody(2, [p]))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal').length, 2)
  assert.ok(days.some(day => day.id === 'birthday'))
  assert.ok(days.some(day => day.id === 'period'))
})

test('P3: same birthday single v1 → v2 ends with exactly one entry, v2 value', async () => {
  clearState()
  const v1 = { kind: 'personal_day', entityId: 'birthday', version: 1, payload: { id: 'birthday', label: '生日 v1', date: '02-03', kind: 'personal', createdAt: 2 } }
  globalThis.fetch = async () => jsonResponse(pullBody(1, [v1]))
  await cloud.pullCloudState()
  const v2 = { kind: 'personal_day', entityId: 'birthday', version: 2, payload: { id: 'birthday', label: '生日 v2', date: '02-04', kind: 'personal', createdAt: 4 } }
  globalThis.fetch = async () => jsonResponse(pullBody(2, [v2]))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.equal(days.filter(day => day.kind === 'personal' && day.id === 'birthday').length, 1)
  assert.equal(days.find(day => day.id === 'birthday').label, '生日 v2')
})

test('P4: single birthday tombstone deletes only birthday; period + couple survive', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    { id: 'period', label: '生理期', date: '10-10', kind: 'personal', createdAt: 3 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'birthday', version: 3, deleted: true },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(3, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['couple', 'period'])
  assert.equal(days.find(day => day.id === 'period').label, '生理期')
  assert.equal(days.find(day => day.id === 'couple').label, '认识 TA')
})

test('P5: global array keeps full replace snapshot semantics', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'old', label: '旧生日', date: '02-03', kind: 'personal', createdAt: 1 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 2 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'global', version: 1, payload: [
      { id: 'new-day', label: '新节日', date: '03-03', kind: 'personal', createdAt: 3 },
    ] },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(1, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  // 完整快照：旧 personal 被替换，仅剩新 personal；couple 保留
  assert.deepEqual(days.map(day => day.id).sort(), ['couple', 'new-day'])
})

test('P6: global tombstone clears all personal days but keeps couple', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    { id: 'period', label: '生理期', date: '10-10', kind: 'personal', createdAt: 3 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'global', version: 2, deleted: true },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(2, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id), ['couple'])
})

test('P7: invalid single personal payload leaves existing list untouched', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([
    { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 },
    { id: 'couple', label: '认识 TA', date: '01-01', kind: 'couple', createdAt: 1 },
  ]))
  const changes = [
    { kind: 'personal_day', entityId: 'bad-1', version: 1, payload: { label: '无 id', kind: 'personal' } },
    { kind: 'personal_day', entityId: 'bad-2', version: 2, payload: { id: 'x', kind: 'couple' } },
    { kind: 'personal_day', entityId: 'bad-3', version: 3, payload: 'not-an-object' },
  ]
  globalThis.fetch = async () => jsonResponse(pullBody(3, changes))
  await cloud.pullCloudState()
  const days = JSON.parse(localStorage.getItem('ai_companion_anniversaries'))
  assert.deepEqual(days.map(day => day.id).sort(), ['birthday', 'couple'])
  assert.equal(days.find(day => day.id === 'birthday').label, '我的生日')
})

test('P8: single apply and delete are silent — no legacy echo, no duplicate cloud op', async () => {
  clearState()
  localStorage.setItem('ai_companion_anniversaries', JSON.stringify([]))
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ }, { once: true })
  const apply = { kind: 'personal_day', entityId: 'birthday', version: 1, payload: { id: 'birthday', label: '我的生日', date: '02-03', kind: 'personal', createdAt: 2 } }
  globalThis.fetch = async () => jsonResponse(pullBody(1, [apply]))
  await cloud.pullCloudState()
  await cloud.flushCloudStatePendingOps()
  assert.equal(legacyChanges, 0)
  assert.equal(store.getPendingOps().filter(op => op.kind === 'personal_day').length, 0)
  const tomb = { kind: 'personal_day', entityId: 'birthday', version: 2, deleted: true }
  globalThis.fetch = async () => jsonResponse(pullBody(2, [tomb]))
  await cloud.pullCloudState()
  await cloud.flushCloudStatePendingOps()
  assert.equal(legacyChanges, 0)
  assert.equal(store.getPendingOps().filter(op => op.kind === 'personal_day').length, 0)
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_companion_anniversaries')), [])
})

test('SPACE-1: same post id remains independent across sessions, including baseVersion/edit/tombstone/conflict', async () => {
  clearState('space-account')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const base = { id: 'same', at: 1, kind: '日常', text: 'local', source: 'daily' }
  localStorage.setItem('ai_space_posts_A', JSON.stringify([{ ...base, sessionId: 'A', text: 'A local' }]))
  localStorage.setItem('ai_space_posts_B', JSON.stringify([{ ...base, sessionId: 'B', text: 'B local' }]))
  window.dispatchEvent(new Event('eluvin-data-change'))
  let ops = cloudOps('space_post')
  assert.equal(ops.length, 2)
  assert.deepEqual(ops.map(op => op.sessionId).sort(), ['A', 'B'])

  globalThis.fetch = async () => jsonResponse({ results: ops.map(op => ({
    opId: op.opId, status: 'applied', version: op.sessionId === 'A' ? 3 : 8,
  })) })
  await cloud.flushCloudStatePendingOps()
  assert.equal(cloud.getCloudStateVersion('space_post', 'same', undefined, 'A'), 3)
  assert.equal(cloud.getCloudStateVersion('space_post', 'same', undefined, 'B'), 8)

  localStorage.setItem('ai_space_posts_A', JSON.stringify([{ ...base, sessionId: 'A', text: 'A edit' }]))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const edit = cloudOps('space_post')[0]
  assert.equal(edit.sessionId, 'A')
  assert.equal(edit.baseVersion, 3)
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_B'))[0].text, 'B local')

  globalThis.fetch = async () => jsonResponse({ results: [{ opId: edit.opId, status: 'conflict', entity: {
    kind: 'space_post', entityId: 'same', sessionId: 'A', version: 4,
    payload: { ...base, id: 'ignored-payload-id', text: 'A server' },
  } }] })
  await cloud.flushCloudStatePendingOps()
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_A'))[0].text, 'A server')
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_B'))[0].text, 'B local')

  localStorage.setItem('ai_space_posts_A', '[]')
  window.dispatchEvent(new Event('eluvin-data-change'))
  const tombstone = cloudOps('space_post')[0]
  assert.equal(tombstone.deleted, true)
  assert.equal(tombstone.sessionId, 'A')
  assert.equal(tombstone.baseVersion, 4)
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_B')).length, 1)
})

test('SPACE-2: historical live/tombstone replay is silent and generated slots stay permanently occupied per session', async () => {
  clearState('space-history')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const slot = '2026-09-16:daily'
  let legacyChanges = 0
  window.addEventListener('eluvin-data-change', () => { legacyChanges++ })
  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'space_post', entityId: 'live', sessionId: 'A', generationSlotId: slot, version: 1,
      payload: { id: 'old-id', at: Date.UTC(2026, 8, 16, 12), kind: '日常', text: 'historical live' } },
    { kind: 'space_post', entityId: 'gone', sessionId: 'B', generationSlotId: slot, version: 1, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.equal(legacyChanges, 0)
  assert.equal(cloudOps('space_post').length, 0)
  const a = JSON.parse(localStorage.getItem('ai_space_posts_A'))
  assert.equal(a.length, 1)
  assert.equal(a[0].id, 'live')
  assert.equal(a[0].generationSlotId, slot)
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_space_posts_B')), [])
  assert.ok(JSON.parse(localStorage.getItem('ai_space_used_templates_B'))[`__generation_slot__:${slot}`])
})

test('SPACE-3: generated slot dedupes repeated initialization, scopes by session, and ignores manual posts', () => {
  clearState('space-slots')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const now = new Date(2026, 8, 16, 12, 0, 0).getTime()
  const firstA = aiSpace.refreshSpace('', '', now, 'A')
  const secondA = aiSpace.refreshSpace('', '', now, 'A')
  const firstB = aiSpace.refreshSpace('', '', now, 'B')
  assert.equal(firstA.created, 1)
  assert.equal(secondA.created, 0)
  assert.equal(firstB.created, 1)
  assert.equal(firstA.posts[0].generationSlotId, firstB.posts[0].generationSlotId)
  assert.equal(firstA.posts[0].sessionId, 'A')
  assert.equal(firstB.posts[0].sessionId, 'B')

  localStorage.setItem('ai_space_posts_A', JSON.stringify([
    ...JSON.parse(localStorage.getItem('ai_space_posts_A')),
    { id: 'manual', sessionId: 'A', at: now + 1, kind: '日常', text: 'manual post' },
  ]))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const posts = aiSpace.loadCurrentPosts('A')
  assert.equal(posts.filter(post => post.id === 'manual').length, 1)
  assert.equal(posts.find(post => post.id === 'manual').generationSlotId, undefined)
  assert.equal(cloudOps('space_post').filter(op => op.sessionId === 'A' && !op.deleted).length >= 2, true)
})

test('SPACE-4: two-device slot collision converges loser to canonical owner and stops retrying', async () => {
  clearState('same-user')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const slot = '2026-09-16:daily'
  const loser = { id: 'B1', sessionId: 'S', generationSlotId: slot, at: 2, kind: '日常', text: 'device B loser', source: 'daily' }
  const owner = { id: 'A1', sessionId: 'S', generationSlotId: slot, at: 1, kind: '日常', text: 'device A owner', source: 'daily' }
  // Device A wins the canonical slot and persists its permanent local marker.
  localStorage.setItem('ai_space_posts_S', JSON.stringify([owner]))
  localStorage.setItem('ai_space_used_templates_S', JSON.stringify({ [`__generation_slot__:${slot}`]: 1 }))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const ownerOp = cloudOps('space_post')[0]
  globalThis.fetch = async () => jsonResponse({ results: [{ opId: ownerOp.opId, status: 'applied', version: 1 }] })
  await cloud.flushCloudStatePendingOps()
  assert.equal(JSON.parse(localStorage.getItem('ai_space_used_templates_S'))[`__generation_slot__:${slot}`], 1)

  // A separate device B starts from independent local storage and races with a different id.
  clearState('same-user')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  localStorage.setItem('ai_space_posts_S', JSON.stringify([loser]))
  localStorage.setItem('ai_space_used_templates_S', JSON.stringify({ [`__generation_slot__:${slot}`]: 1 }))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const loserOp = cloudOps('space_post')[0]
  assert.equal(loserOp.entityId, 'B1')

  let pushes = 0
  globalThis.fetch = async (_url, init) => {
    pushes++
    const sent = JSON.parse(init.body).ops
    assert.equal(sent.length, 1)
    return jsonResponse({ results: [{
      opId: loserOp.opId,
      status: 'conflict',
      entity: { kind: 'space_post', entityId: 'A1', sessionId: 'S', generationSlotId: slot, version: 1, payload: owner },
    }] })
  }
  await cloud.flushCloudStatePendingOps()
  assert.equal(cloudOps('space_post').length, 0)
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_space_posts_S')).map(post => post.id), ['A1'])
  assert.equal(JSON.parse(localStorage.getItem('ai_space_used_templates_S'))[`__generation_slot__:${slot}`], 1)
  await cloud.flushCloudStatePendingOps()
  assert.equal(pushes, 1)

  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'space_post', entityId: 'A1', sessionId: 'S', generationSlotId: slot, version: 2, deleted: true },
  ]))
  await cloud.pullCloudState()
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_space_posts_S')), [])
  assert.equal(JSON.parse(localStorage.getItem('ai_space_used_templates_S'))[`__generation_slot__:${slot}`], 1)
})

test('SPACE-7: conflict convergence still cleans the local loser when the canonical version is already known', async () => {
  clearState('same-user')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const slot = '2026-09-16:daily'
  const owner = { id: 'A1', sessionId: 'S', generationSlotId: slot, at: 1, kind: '日常', text: 'device A owner', source: 'daily' }
  const loser = { id: 'B1', sessionId: 'S', generationSlotId: slot, at: 2, kind: '日常', text: 'device B loser', source: 'daily' }
  // 真实双设备场景：本机开机先 pull 到了对方的 canonical（version 已记录）
  globalThis.fetch = async () => jsonResponse(pullBody(1, [
    { kind: 'space_post', entityId: 'A1', sessionId: 'S', generationSlotId: slot, version: 1, payload: owner },
  ]))
  await cloud.pullCloudState()
  assert.equal(cloud.getCloudStateVersion('space_post', 'A1', undefined, 'S'), 1)

  // 本机随后自己生成了同 slot 的另一条（loser）
  localStorage.setItem('ai_space_posts_S', JSON.stringify([loser, owner]))
  window.dispatchEvent(new Event('eluvin-data-change'))
  const loserOp = cloudOps('space_post').find((op) => op.entityId === 'B1')
  assert.ok(loserOp, 'loser 应进入 pending 队列')

  let pushes = 0
  globalThis.fetch = async () => {
    pushes++
    return jsonResponse({ results: [{
      opId: loserOp.opId,
      status: 'conflict',
      reason: 'slot_taken',
      entity: { kind: 'space_post', entityId: 'A1', sessionId: 'S', generationSlotId: slot, version: 1, payload: owner },
    }] })
  }
  await cloud.flushCloudStatePendingOps()
  assert.equal(pushes, 1)
  assert.equal(cloudOps('space_post').length, 0)
  // ★ 版本号已知也必须真跑一遍 adapter，否则 loser 会留在本地与 canonical 并存
  assert.deepEqual(JSON.parse(localStorage.getItem('ai_space_posts_S')).map((post) => post.id), ['A1'])
  await cloud.flushCloudStatePendingOps()
  assert.equal(pushes, 1)
})

test('SPACE-5: a generation attempt that creates no post releases only its provisional slot', async () => {
  clearState('failed-generation')
  const sessionId = 'S'
  const now = new Date(2026, 8, 16, 12, 0, 0).getTime()
  const slot = '2026-09-16:daily'
  localStorage.setItem(`ai_space_posts_${sessionId}`, '[]')
  localStorage.setItem(`ai_space_used_templates_${sessionId}`, JSON.stringify({ [`__generation_slot__:${slot}`]: -1 }))
  localStorage.setItem(`ai_space_ledger_${sessionId}`, JSON.stringify({ '2026-09-16': { daily: 2, event: 0 } }))
  const result = await aiSpace.generatePendingPosts({
    posts: [], mode: 'llm', created: 1, pending: [{ at: now, source: 'daily' }],
    used: { [`__generation_slot__:${slot}`]: -1 },
  }, '', '', sessionId, now)
  assert.equal(result.created, 0)
  const used = JSON.parse(localStorage.getItem(`ai_space_used_templates_${sessionId}`))
  assert.equal(used[`__generation_slot__:${slot}`], undefined)
  localStorage.removeItem(`ai_space_ledger_${sessionId}`)
  const retry = aiSpace.refreshSpace('', '', now, sessionId)
  assert.equal(retry.created, 1)
  assert.equal(retry.posts[0].generationSlotId, slot)
})

test('SPACE-6: identical slots in different sessions are accepted independently', async () => {
  clearState('session-slots')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const slot = '2026-09-16:event'
  for (const sessionId of ['A', 'B']) {
    localStorage.setItem(`ai_space_posts_${sessionId}`, JSON.stringify([
      { id: `${sessionId}1`, sessionId, generationSlotId: slot, at: 1, kind: '日常', text: sessionId, source: 'event' },
    ]))
  }
  window.dispatchEvent(new Event('eluvin-data-change'))
  const ops = cloudOps('space_post')
  assert.deepEqual(ops.map(op => op.sessionId).sort(), ['A', 'B'])
  globalThis.fetch = async () => jsonResponse({ results: ops.map((op, index) => ({ opId: op.opId, status: 'applied', version: index + 1 })) })
  await cloud.flushCloudStatePendingOps()
  assert.equal(cloud.getCloudStateVersion('space_post', 'A1', undefined, 'A'), 1)
  assert.equal(cloud.getCloudStateVersion('space_post', 'B1', undefined, 'B'), 2)
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_A')).length, 1)
  assert.equal(JSON.parse(localStorage.getItem('ai_space_posts_B')).length, 1)
})

test('WEEKLY-CS-1: local create/edit/delete queue scoped entities with prefixed slots', () => {
  clearState('weekly-local')
  window.dispatchEvent(new Event('eluvin-auth-change'))
  const review = { id: 'same', weekLabel: 'week A', title: 'A', content: 'body', createdAt: 10,
    generatedFrom: { startTs: 1, endTs: 2 } }
  weeklyReview.saveWeeklyReviews([review], 'A')
  weeklyReview.saveWeeklyReviews([{ ...review, weekLabel: 'week B' }], 'B')
  let ops = cloudOps('weekly_review')
  assert.equal(ops.length, 2)
  assert.deepEqual(ops.map(op => op.sessionId).sort(), ['A', 'B'])
  assert.equal(ops.every(op => op.generationSlotId === 'weekly:1-2'), true)

  store.removePendingOp(ops.find(op => op.sessionId === 'A').id)
  store.removePendingOp(ops.find(op => op.sessionId === 'B').id)
  weeklyReview.saveWeeklyReviews([{ ...review, title: 'edited' }], 'A')
  ops = cloudOps('weekly_review')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].payload.title, 'edited')
  store.removePendingOp(ops[0].id)
  weeklyReview.saveWeeklyReviews([], 'A')
  ops = cloudOps('weekly_review')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].deleted, true)
  assert.equal(JSON.parse(localStorage.getItem('ai_companion_weekly_reviews_B')).length, 1)
})

test('WEEKLY-CS-2: cloud apply is silent, converges only same-session/same-slot loser, and snapshot does not echo', async () => {
  clearState('weekly-apply')
  const slot = { startTs: 10, endTs: 20 }
  const loser = { id: 'loser', weekLabel: 'local', title: 'loser', content: 'local', createdAt: 1, generatedFrom: slot }
  const otherWeek = { id: 'other', weekLabel: 'other', title: 'other', content: 'keep', createdAt: 2,
    generatedFrom: { startTs: 30, endTs: 40 } }
  const otherSession = { ...loser, id: 'other-session' }
  localStorage.setItem('ai_companion_weekly_reviews_A', JSON.stringify([loser, otherWeek]))
  localStorage.setItem('ai_companion_weekly_reviews_B', JSON.stringify([otherSession]))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  let changes = 0
  window.addEventListener('eluvin-data-change', () => { changes++ })
  const canonical = { id: 'winner', weekLabel: 'server', title: 'winner', content: 'canonical', createdAt: 3, generatedFrom: slot }
  globalThis.fetch = async () => jsonResponse(pullBody(1, [{
    kind: 'weekly_review', entityId: 'winner', sessionId: 'A', generationSlotId: 'weekly:10-20', version: 7, payload: canonical,
  }]))
  await cloud.pullCloudState()
  assert.equal(changes, 0)
  assert.deepEqual(weeklyReview.getWeeklyReviews('A').map(review => review.id).sort(), ['other', 'winner'])
  assert.deepEqual(weeklyReview.getWeeklyReviews('B').map(review => review.id), ['other-session'])
  assert.equal(cloudOps('weekly_review').length, 0)
  window.dispatchEvent(new Event('eluvin-data-change'))
  assert.equal(cloudOps('weekly_review').length, 0)
})

test('WEEKLY-CS-3: merge requeues local progress at entity.version, while identical canonical does not requeue', async () => {
  clearState('weekly-merge')
  const canonical = { id: 'review', weekLabel: 'server', title: 'title', content: 'body', createdAt: 10,
    generatedFrom: { startTs: 1, endTs: 2 }, replies: [{ id: 'reply', content: 'note', repliedAt: 20 }] }
  const local = { ...canonical, replies: [{ ...canonical.replies[0], replied: true, reply: 'answer', replyAt: 30 }] }
  localStorage.setItem('ai_companion_weekly_reviews_A', JSON.stringify([local]))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  globalThis.fetch = async () => jsonResponse(pullBody(1, [{
    kind: 'weekly_review', entityId: 'review', sessionId: 'A', generationSlotId: 'weekly:1-2', version: 9, payload: canonical,
  }]))
  await cloud.pullCloudState()
  let ops = cloudOps('weekly_review')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].baseVersion, 9)
  assert.equal(ops[0].payload.replies[0].reply, 'answer')

  store.removePendingOp(ops[0].id)
  window.dispatchEvent(new Event('eluvin-auth-change'))
  globalThis.fetch = async () => jsonResponse(pullBody(2, [{
    kind: 'weekly_review', entityId: 'review', sessionId: 'A', generationSlotId: 'weekly:1-2', version: 10,
    payload: weeklyReview.getWeeklyReviews('A')[0],
  }]))
  await cloud.pullCloudState()
  assert.equal(cloudOps('weekly_review').length, 0)
})

test('WEEKLY-CS-4: tombstone deletes only exact session and invalid entities are ignored', async () => {
  clearState('weekly-delete')
  const review = { id: 'same', weekLabel: 'week', title: 'title', content: 'body', createdAt: 1 }
  localStorage.setItem('ai_companion_weekly_reviews_A', JSON.stringify([review]))
  localStorage.setItem('ai_companion_weekly_reviews_B', JSON.stringify([review]))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  globalThis.fetch = async () => jsonResponse(pullBody(2, [
    { kind: 'weekly_review', entityId: 'same', sessionId: 'A', version: 1, deleted: true },
    { kind: 'weekly_review', entityId: 'wrong', sessionId: 'B', version: 2, payload: review },
  ]))
  await cloud.pullCloudState()
  assert.deepEqual(weeklyReview.getWeeklyReviews('A'), [])
  assert.deepEqual(weeklyReview.getWeeklyReviews('B').map(item => item.id), ['same'])
  assert.equal(cloudOps('weekly_review').length, 0)
})


test('PROFILE-ID-1: stale cloud pull cannot clobber a pending local identity selection', async () => {
  clearState('identity-refresh')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({
    nickname: '本地名', avatar: '', identityMode: 'immersive',
  }))
  window.dispatchEvent(new Event('eluvin-auth-change'))

  assert.equal(companionPolicy.saveIdentityMode('A', 'natural'), true)
  let ops = cloudOps('profile')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].payload.identityMode, 'natural')
  assert.equal(ops[0].payload.nickname, '本地名')
  assert.equal(ops[0].baseVersion, 0)

  globalThis.fetch = async () => jsonResponse(pullBody(7, [{
    kind: 'profile',
    entityId: 'A',
    sessionId: 'A',
    version: 7,
    payload: { nickname: '旧云名', avatar: '', identityMode: 'immersive' },
  }]))
  await cloud.pullCloudState()

  assert.equal(companionPolicy.resolveIdentityMode('A'), 'natural', '刷新 pull 后仍保留本机刚选的自然档')
  assert.equal(storage.loadAIProfile('A').nickname, '本地名', '同一 pending profile 里的本地资料修改也不能被旧云值吃掉')
  ops = cloudOps('profile')
  assert.equal(ops.length, 1, '旧 pending 被替换为一条 rebased profile op')
  assert.equal(ops[0].baseVersion, 7)
  assert.equal(ops[0].payload.identityMode, 'natural')

  globalThis.fetch = async (_url, init) => {
    const sent = JSON.parse(init.body).ops
    assert.equal(sent.length, 1)
    assert.equal(sent[0].baseVersion, 7)
    assert.equal(sent[0].payload.identityMode, 'natural')
    assert.equal(sent[0].payload.nickname, '本地名')
    return jsonResponse({ results: [{ opId: sent[0].opId, status: 'applied', version: 8 }] })
  }
  await cloud.flushCloudStatePendingOps()

  assert.equal(cloudOps('profile').length, 0)
  assert.equal(companionPolicy.resolveIdentityMode('A'), 'natural')
  assert.equal(cloud.getCloudStateVersion('profile', 'A', undefined, 'A'), 8)
})

test('PROFILE-ID-2: legacy cloud profile missing identityMode is repaired at the pulled version', async () => {
  clearState('identity-legacy')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({
    nickname: 'TA', avatar: '', identityMode: 'ai',
  }))
  window.dispatchEvent(new Event('eluvin-auth-change'))
  assert.equal(cloudOps('profile').length, 0)

  globalThis.fetch = async () => jsonResponse(pullBody(3, [{
    kind: 'profile',
    entityId: 'A',
    sessionId: 'A',
    version: 3,
    payload: { nickname: 'TA', avatar: '' },
  }]))
  await cloud.pullCloudState()

  assert.equal(companionPolicy.resolveIdentityMode('A'), 'ai')
  const ops = cloudOps('profile')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].baseVersion, 3, '补回旧客户端缺失字段时直接基于刚 pull 的 canonical version')
  assert.equal(ops[0].payload.identityMode, 'ai')
})


test('PROFILE-ID-3: pending profile tombstone survives a pull and is rebased instead of resurrected', async () => {
  clearState('identity-tombstone')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({
    nickname: '本地名', avatar: '', identityMode: 'immersive',
  }))
  window.dispatchEvent(new Event('eluvin-auth-change'))

  // 刚切了身份档（pending 编辑还没上传），紧接着删掉这个角色
  assert.equal(companionPolicy.saveIdentityMode('A', 'natural'), true)
  storage.clearAIProfile('A')   // 产品删角色的真实路径：清资料 key → notifyDataChanged → 入队墓碑
  let ops = cloudOps('profile')
  assert.equal(ops.length, 2, '一条未上传编辑 + 一条墓碑')
  assert.equal(ops[0].deleted, undefined)
  assert.equal(ops[1].deleted, true)

  // 下一次 pull 带回更老的云端 canonical profile
  globalThis.fetch = async () => jsonResponse(pullBody(7, [{
    kind: 'profile',
    entityId: 'A',
    sessionId: 'A',
    version: 7,
    payload: { nickname: '旧云名', avatar: '', identityMode: 'immersive' },
  }]))
  await cloud.pullCloudState()

  assert.equal(localStorage.getItem('ai_companion_ai_profile_A'), null, '已删除的资料不被 pull 复活')
  ops = cloudOps('profile')
  assert.equal(ops.length, 1, '只剩一条重基后的墓碑，旧编辑被丢弃')
  assert.equal(ops[0].deleted, true, '删除意图保留')
  assert.equal(ops[0].baseVersion, 7, '墓碑重基到刚 pull 的 canonical version')
  assert.equal(ops[0].payload, undefined, '墓碑不带 payload，绝不排非删除的覆盖 op')

  // push 真的把删除送出去
  let sentProfileOps = null
  globalThis.fetch = async (_url, init) => {
    sentProfileOps = JSON.parse(init.body).ops.filter((op) => op.kind === 'profile')
    return jsonResponse({ results: sentProfileOps.map((op) => ({ opId: op.opId, status: 'applied', version: 8 })) })
  }
  await cloud.flushCloudStatePendingOps()
  assert.equal(sentProfileOps.length, 1)
  assert.equal(sentProfileOps[0].deleted, true, '推送的是删除而不是资料覆盖')
  assert.equal(sentProfileOps[0].baseVersion, 7)
  assert.equal(cloudOps('profile').length, 0)
})


test('P0-A BACKFILL-1: existing cloud identity wins over stale legacy device profile', async () => {
  clearState('p0a-profile-existing')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({
    nickname: '旧本地名',
    avatar: 'data:image/png;base64,LOCAL',
    identityMode: 'ai',
  }))
  window.dispatchEvent(new Event('eluvin-auth-change'))

  resources.queueLegacyCloudStateBackfill()
  let ops = cloudOps('profile')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].baseVersion, 0)
  assert.match(ops[0].opId, /^p0a-v1:profile-identity:/)

  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/api/state/pull')) return jsonResponse(pullBody(0, []))
    const sent = JSON.parse(init.body).ops
    return jsonResponse({ results: [{
      opId: sent[0].opId,
      status: 'conflict',
      entity: {
        kind: 'profile',
        entityId: 'A',
        sessionId: 'A',
        version: 9,
        payload: {
          nickname: '云端新名',
          avatar: 'data:image/png;base64,CLOUD',
          identityMode: 'immersive',
        },
      },
    }] })
  }
  await cloud.syncCloudState()

  const profile = storage.loadAIProfile('A')
  assert.equal(profile.nickname, '云端新名')
  assert.equal(profile.avatar, 'data:image/png;base64,CLOUD')
  assert.equal(profile.identityMode, 'immersive', '云端已有 identityMode 时旧设备绝不能盖回去')
  assert.equal(cloudOps('profile').length, 0)
})

test('P0-A BACKFILL-2: missing cloud identity repairs only that field on canonical profile', async () => {
  clearState('p0a-profile-missing-field')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  localStorage.setItem('ai_companion_ai_profile_A', JSON.stringify({
    nickname: '旧本地名',
    avatar: 'data:image/png;base64,LOCAL',
    identityMode: 'natural',
  }))
  window.dispatchEvent(new Event('eluvin-auth-change'))

  resources.queueLegacyCloudStateBackfill()
  const probe = cloudOps('profile')[0]
  assert.equal(probe.baseVersion, 0)

  globalThis.fetch = async (_url, init = {}) => {
    const sent = JSON.parse(init.body).ops
    return jsonResponse({ results: [{
      opId: sent[0].opId,
      status: 'conflict',
      entity: {
        kind: 'profile',
        entityId: 'A',
        sessionId: 'A',
        version: 4,
        payload: {
          nickname: '云端权威名',
          avatar: 'data:image/png;base64,CLOUD',
        },
      },
    }] })
  }
  await cloud.flushCloudStatePendingOps()

  const profile = storage.loadAIProfile('A')
  assert.equal(profile.nickname, '云端权威名')
  assert.equal(profile.avatar, 'data:image/png;base64,CLOUD')
  assert.equal(profile.identityMode, 'natural')

  const repair = cloudOps('profile')
  assert.equal(repair.length, 1)
  assert.equal(repair[0].baseVersion, 4)
  assert.equal(repair[0].payload.nickname, '云端权威名')
  assert.equal(repair[0].payload.avatar, 'data:image/png;base64,CLOUD')
  assert.equal(repair[0].payload.identityMode, 'natural')
  assert.match(repair[0].opId, /:repair-4$/)

  globalThis.fetch = async (_url, init = {}) => {
    const sent = JSON.parse(init.body).ops
    return jsonResponse({ results: sent.map(op => ({ opId: op.opId, status: 'applied', version: 5 })) })
  }
  await cloud.flushCloudStatePendingOps()
  assert.equal(cloudOps('profile').length, 0)
})

test('P0-A BACKFILL-3: legacy reply-length probes are deterministic and cloud canonical wins', async () => {
  clearState('p0a-reply')
  resources.initCloudStateResourceAdapters()
  store.setSessionsCache([{ id: 'A', title: 'TA', persona: '' }])
  const account = encodeURIComponent('p0a-reply')
  localStorage.setItem(`ai_companion_reply_length_global_${account}`, 'short')
  localStorage.setItem(
    `ai_companion_reply_length_override_${account}_A`,
    JSON.stringify({ mode: 'long', followGlobal: false }),
  )
  window.dispatchEvent(new Event('eluvin-auth-change'))

  resources.queueLegacyCloudStateBackfill()
  const first = store.getPendingOps().filter(op => op.type === 'cloud-state')
  assert.equal(first.filter(op => op.kind === 'reply_length_global').length, 1)
  assert.equal(first.filter(op => op.kind === 'reply_length').length, 1)
  assert.ok(first.every(op => op.baseVersion === 0))
  assert.ok(first.every(op => op.opId.startsWith('p0a-v1:')))

  resources.queueLegacyCloudStateBackfill()
  assert.equal(
    store.getPendingOps().filter(op => op.type === 'cloud-state').length,
    first.length,
    '同账号重复执行不重复排队',
  )

  globalThis.fetch = async (_url, init = {}) => {
    const sent = JSON.parse(init.body).ops
    return jsonResponse({ results: sent.map(op => op.kind === 'reply_length_global'
      ? {
          opId: op.opId,
          status: 'conflict',
          entity: { kind: 'reply_length_global', entityId: 'global', version: 6, payload: { mode: 'medium' } },
        }
      : {
          opId: op.opId,
          status: 'conflict',
          entity: {
            kind: 'reply_length',
            entityId: 'A',
            sessionId: 'A',
            version: 7,
            payload: { mode: 'natural', followGlobal: true },
          },
        })) })
  }
  await cloud.flushCloudStatePendingOps()

  assert.equal(replyLength.getStoredGlobalReplyLength('p0a-reply'), 'medium')
  assert.deepEqual(replyLength.getStoredReplyLengthPreference('p0a-reply', 'A'), {
    mode: 'natural',
    followGlobal: true,
  })
  assert.equal(cloudOps('reply_length_global').length, 0)
  assert.equal(cloudOps('reply_length').length, 0)
})
