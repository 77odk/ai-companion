import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_BUSY_RETURN_AGE, MAX_RETURN_ATTEMPTS, RETURN_RETRY_DELAYS_MS,
  busyCycleId, cancelBusyReturn, normalizeBusyState, resetBusyReturnGuardsForTests, triggerBusyReturn,
} from '../src/lib/busyReturn.ts'

const NOW = 2_000_000_000_000
const fresh = (extra = {}) => ({ status: 'busy', busyUntil: NOW - 1, busyStartedAt: NOW - 300_000, busyReason: '忙', busyContext: '', returnSent: false, retryCount: 0, ...extra })
function rig(initial = fresh(), overrides = {}) {
  let now = NOW; let state = { ...initial }; const messages = []; const scheduled = []; let calls = 0; let commits = 0
  const generate = overrides.generate ?? (async () => '我回来了')
  const commit = overrides.commit ?? (async (_sid, value) => { messages.push(value); return 'committed' })
  const deps = {
    now: () => now,
    getState: () => ({ ...state }),
    saveState: (_sid, next) => { state = { ...next }; return true },
    isCurrent: (_sid, id) => state.status === 'busy' && busyCycleId('A', state) === id,
    schedule: (cb, ms) => { scheduled.push({ cb: () => { now += ms; return cb() }, ms }) },
    ...overrides,
    generate: async (...args) => { calls++; return generate(...args) },
    commit: async (...args) => { commits++; return commit(...args) },
  }
  return { deps, messages, scheduled, state: () => state, calls: () => calls, commits: () => commits }
}

test.beforeEach(() => resetBusyReturnGuardsForTests())

test('A success writes once, marks sent only after commit, and ends idle', async () => {
  const seen = []; const r = rig(fresh(), { commit: async (_s, v) => { seen.push(v); assert.equal(r.state().returnSent, false); return 'committed' } })
  assert.equal(await triggerBusyReturn('A', r.deps), 'success'); assert.deepEqual(seen, ['我回来了']); assert.equal(r.state().returnSent, true); assert.equal(r.state().status, 'idle')
})

test('B model failure remains unsent and schedules retry', async () => {
  const r = rig(fresh(), { generate: async () => { throw new Error('api') } })
  assert.equal(await triggerBusyReturn('A', r.deps), 'retrying'); assert.equal(r.state().returnSent, false); assert.equal(r.state().retryCount, 1); assert.equal(r.scheduled[0].ms, 10_000)
})

test('C first failure then success writes only one return', async () => {
  let n = 0; const r = rig(fresh(), { generate: async () => ++n === 1 ? Promise.reject(new Error('once')) : 'ok' })
  await triggerBusyReturn('A', r.deps); await r.scheduled.shift().cb(); await new Promise(setImmediate); assert.deepEqual(r.messages, ['ok']); assert.equal(r.state().retryCount, 1); assert.equal(r.state().returnSent, true); assert.equal(r.state().status, 'idle')
})

test('D three failures exhaust without message or fourth model call', async () => {
  let calls = 0; const r = rig(fresh(), { generate: async () => { calls++; throw new Error('fail') } })
  await triggerBusyReturn('A', r.deps); await r.scheduled.shift().cb(); await new Promise(setImmediate); await r.scheduled.shift().cb(); await new Promise(setImmediate); assert.equal(calls, MAX_RETURN_ATTEMPTS); assert.equal(r.state().status, 'idle'); assert.equal(r.state().returnSent, false); assert.equal(r.messages.length, 0); assert.equal(await triggerBusyReturn('A', r.deps), 'ignored'); assert.equal(calls, 3)
})

test('E blank response is failure and retries without commit', async () => {
  const r = rig(fresh(), { generate: async () => null }); assert.equal(await triggerBusyReturn('A', r.deps), 'retrying'); assert.equal(r.commits(), 0); assert.equal(r.state().returnSent, false)
})

test('F older than six hours expires without LLM', async () => {
  const r = rig(fresh({ busyStartedAt: NOW - MAX_BUSY_RETURN_AGE - 1 })); assert.equal(await triggerBusyReturn('A', r.deps), 'expired'); assert.equal(r.calls(), 0); assert.equal(r.state().status, 'idle'); assert.equal(r.state().returnSent, false)
})

test('G StrictMode concurrent trigger has one model request', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh(), { generate: async () => { await pending; return 'ok' } })
  const a = triggerBusyReturn('A', r.deps); const b = triggerBusyReturn('A', r.deps); assert.equal(await b, 'ignored'); assert.equal(r.calls(), 1); release(); await a
})

test('H slow request re-entry does not open a second request', async () => {
  let calls = 0, release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh(), { generate: async () => { calls++; await pending; return 'ok' } })
  const first = triggerBusyReturn('A', r.deps); await Promise.resolve(); assert.equal(await triggerBusyReturn('A', r.deps), 'ignored'); assert.equal(calls, 1); release(); await first
})

test('I stale promise does not commit or mark sent', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh(), { generate: async () => { await pending; return 'late' } })
  const run = triggerBusyReturn('A', r.deps); await Promise.resolve(); cancelBusyReturn('A', r.state(), r.deps); release(); assert.equal(await run, 'cancelled'); assert.equal(r.messages.length, 0); assert.equal(r.state().returnSent, false)
})

test('J active session switch prevents A from writing B', async () => {
  let active = 'A', release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh(), { generate: async () => { await pending; return 'late' }, isCurrent: (sid) => active === sid && r.state().status === 'busy' })
  const run = triggerBusyReturn('A', r.deps); await Promise.resolve(); active = 'B'; release(); assert.equal(await run, 'cancelled'); assert.equal(r.messages.length, 0)
})

test('K user message cancellation stops pending return', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh(), { generate: async () => { await pending; return 'late' } }); const run = triggerBusyReturn('A', r.deps); await Promise.resolve(); cancelBusyReturn('A', r.state(), r.deps); release(); await run; assert.equal(r.messages.length, 0); assert.equal(r.state().status, 'idle')
})

test('L legacy missing fields normalizes safely; invalid time ends safely', async () => {
  const old = normalizeBusyState({ status: 'busy', busyUntil: NOW + 60_000, busyReason: '', busyContext: '', returnSent: false }, NOW); assert.equal(old.retryCount, 0); assert.ok(old.busyStartedAt > 0)
  assert.equal(old.activityOwner, 'SELF')
  const owned = normalizeBusyState(fresh({ activityOwner: 'SELF', triggerEvidence: '等我一下，我马上回来' }), NOW); assert.equal(owned.triggerEvidence, '等我一下，我马上回来')
  const r = rig({ status: 'busy', busyUntil: 0, busyReason: '', busyContext: '', returnSent: false }); assert.equal(await triggerBusyReturn('A', r.deps), 'expired'); assert.equal(r.calls(), 0)
})

test('M sent flag stays false through generation and failed persistence', async () => {
  const phases = []; const r = rig(fresh(), { generate: async () => { phases.push(r.state().returnSent); return 'text' }, commit: async () => { phases.push(r.state().returnSent); return 'failed' } }); await triggerBusyReturn('A', r.deps); assert.deepEqual(phases, [false, false]); assert.equal(r.state().returnSent, false)
})

test('N duplicate retry timers still result in one request', async () => {
  let release; const pending = new Promise((resolve) => { release = resolve }); const r = rig(fresh({ retryCount: 1, lastAttemptAt: NOW - RETURN_RETRY_DELAYS_MS[0] }), { generate: async () => { await pending; return 'ok' } }); const a = triggerBusyReturn('A', r.deps); const b = triggerBusyReturn('A', r.deps); await Promise.resolve(); assert.equal(r.calls(), 1); assert.equal(await b, 'ignored'); release(); await a
})

test('O refresh honors remaining retry delay and never repeats sent return', async () => {
  const r = rig(fresh({ retryCount: 1, lastAttemptAt: NOW - 4_000 })); assert.equal(await triggerBusyReturn('A', r.deps), 'retrying'); assert.equal(r.calls(), 0); assert.equal(r.scheduled[0].ms, 6_000)
  const done = rig(fresh({ status: 'idle', returnSent: true })); assert.equal(await triggerBusyReturn('A', done.deps), 'ignored'); assert.equal(done.calls(), 0)
})


test('P server success followed by session switch remains committed without retry', async () => {
  let active = 'A'
  const server = { A: [], B: [] }
  const r = rig(fresh(), {
    isCurrent: (sid) => active === sid && r.state().status === 'busy',
    commit: async (sid, value) => { server[sid].push(value); active = 'B'; return 'committed' },
  })
  assert.equal(await triggerBusyReturn('A', r.deps), 'success')
  assert.deepEqual(server.A, ['我回来了']); assert.deepEqual(server.B, [])
  assert.equal(r.state().returnSent, true); assert.equal(r.state().status, 'idle'); assert.equal(r.scheduled.length, 0)
})

test('Q server success followed immediately by user cancel still commits without retry', async () => {
  const server = []
  const r = rig(fresh(), {
    commit: async (_sid, value) => { server.push(value); cancelBusyReturn('A', r.state(), r.deps); return 'committed' },
  })
  assert.equal(await triggerBusyReturn('A', r.deps), 'success')
  assert.deepEqual(server, ['我回来了']); assert.equal(r.state().returnSent, true); assert.equal(r.state().status, 'idle'); assert.equal(r.scheduled.length, 0)
})

test('R session switch before irreversible post cancels without calling post', async () => {
  let commitEntered = 0; let postCalls = 0
  const r = rig(fresh(), { commit: async () => { commitEntered++; /* stale preflight returns before post */ return 'cancelled-before-commit' } })
  assert.equal(await triggerBusyReturn('A', r.deps), 'cancelled')
  assert.equal(commitEntered, 1); assert.equal(postCalls, 0); assert.equal(r.state().returnSent, false); assert.equal(r.state().status, 'idle'); assert.equal(r.scheduled.length, 0)
})

test('S postMessage failure rolls back and retries unsent', async () => {
  const local = []
  const r = rig(fresh(), { commit: async (_sid, value) => { local.push(value); local.pop(); return 'failed' } })
  assert.equal(await triggerBusyReturn('A', r.deps), 'retrying')
  assert.deepEqual(local, []); assert.equal(r.state().returnSent, false); assert.equal(r.scheduled.length, 1)
})

test('T local-only confirmation followed by session switch remains committed', async () => {
  let active = 'A'; const local = { A: [], B: [] }
  const r = rig(fresh(), {
    isCurrent: (sid) => active === sid && r.state().status === 'busy',
    commit: async (sid, value) => { local[sid].push(value); active = 'B'; return 'committed' },
  })
  assert.equal(await triggerBusyReturn('A', r.deps), 'success')
  assert.deepEqual(local.A, ['我回来了']); assert.deepEqual(local.B, [])
  assert.equal(r.state().returnSent, true); assert.equal(r.state().status, 'idle'); assert.equal(r.scheduled.length, 0)
})
