import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyCloudContextUsages,
  clearContextUsage,
  collectAllContextUsages,
  getAllLocalContextUsageTurns,
  getContextUsage,
  getContextUsageTurns,
  setContextUsage,
} from '../src/lib/storage.ts'
import {
  estimateUsageTurnCost,
  formatUsageMoney,
  summarizeUsageTurns,
} from '../src/lib/usageCost.ts'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const providers = {
  deepseek: { apiKey: 'x', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' },
  zhipu: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash' },
  openai: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { apiKey: '', baseUrl: '', model: 'gpt-4o-mini' },
  volcengine: { apiKey: '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-character' },
  mimo: { apiKey: '', baseUrl: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-pro' },
}

localStorage.setItem('ai_companion_settings', JSON.stringify({ provider: 'deepseek', providers }))

console.log('[usage info] 发送前 estimate 只更新 meter，不写逐轮明细')
setContextUsage({
  sessionStart: 0,
  used: 100,
  budget: 64000,
  source: 'estimate',
  inputTokens: 100,
  updatedAt: 1000,
}, 's1')
assert.equal(getContextUsageTurns('s1').length, 0)
assert.equal(getContextUsage('s1')?.inputTokens, 100)

console.log('[usage info] provider 完成后写入一轮，并保留 provider/model/host')
setContextUsage({
  sessionStart: 0,
  used: 120,
  budget: 64000,
  source: 'actual',
  inputTokens: 1000,
  outputTokens: 200,
  cachedTokens: 600,
  updatedAt: 2000,
}, 's1')
const turns = getContextUsageTurns('s1')
assert.equal(turns.length, 1)
assert.equal(turns[0].provider, 'deepseek')
assert.equal(turns[0].model, 'deepseek-v4-flash')
assert.equal(turns[0].baseUrlHost, 'api.deepseek.com')
assert.equal(turns[0].cachedTokens, 600)

console.log('[usage info] 请求完成后切模型也必须按请求开始时的 settings 记账')
const requestSettings = {
  provider: 'deepseek',
  apiKey: 'x',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  providers,
}
localStorage.setItem('ai_companion_settings', JSON.stringify({ provider: 'openai', providers }))
setContextUsage({
  sessionStart: 0,
  used: 80,
  budget: 64000,
  source: 'actual',
  inputTokens: 80,
  outputTokens: 20,
  updatedAt: 2200,
}, 'request-snapshot', requestSettings)
const snapshotTurn = getContextUsageTurns('request-snapshot')[0]
assert.equal(snapshotTurn.provider, 'deepseek')
assert.equal(snapshotTurn.model, 'deepseek-v4-flash')
assert.equal(snapshotTurn.baseUrlHost, 'api.deepseek.com')
localStorage.setItem('ai_companion_settings', JSON.stringify({ provider: 'deepseek', providers }))

console.log('[usage info] 展示扫描必须按当前账号 session 白名单隔离')
setContextUsage({
  sessionStart: 0,
  used: 20,
  budget: 64000,
  source: 'actual',
  inputTokens: 20,
  outputTokens: 5,
  updatedAt: 2500,
}, 'other-account-session')
assert.equal(getAllLocalContextUsageTurns(['s1']).every((turn) => turn.sessionId === 's1'), true)
assert.equal(getAllLocalContextUsageTurns([]).length, 0, 'session 列表未恢复时宁可空，也不能扫旧账号')
assert.equal(getAllLocalContextUsageTurns(['other-account-session']).length, 1)

console.log('[usage info] 同步 payload 只有 current meter，绝不带 localTurns')
const syncUsage = collectAllContextUsages()
assert.equal(syncUsage.s1?.inputTokens, 1000)
assert.equal('localTurns' in (syncUsage.s1 ?? {}), false)

console.log('[usage info] 刷新上下文只清 meter，历史用量仍留本机')
clearContextUsage('s1', false)
assert.equal(getContextUsage('s1'), null)
assert.equal(getContextUsageTurns('s1').length, 1)

console.log('[usage info] cloud meter 回来时不覆盖本机逐轮历史')
applyCloudContextUsages({
  s1: {
    sessionStart: 3000,
    used: 50,
    budget: 64000,
    source: 'estimate',
    inputTokens: 50,
    updatedAt: 4000,
  },
})
assert.equal(getContextUsage('s1')?.sessionStart, 3000)
assert.equal(getContextUsageTurns('s1').length, 1)

console.log('[usage info] 已知官方价才估算；中转/未知模型不硬算')
const offPeak = estimateUsageTurnCost({
  id: 'd1',
  sessionId: 's1',
  createdAt: Date.UTC(2026, 9, 5, 12, 0, 0), // Monday, off-peak
  provider: 'deepseek',
  model: 'deepseek-v4-flash',
  baseUrlHost: 'api.deepseek.com',
  source: 'actual',
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cachedTokens: 0,
})
assert.ok(offPeak)
assert.equal(offPeak.currency, 'USD')
assert.ok(Math.abs(offPeak.amount - 0.75) < 1e-9)

const holidayPeakWindow = estimateUsageTurnCost({
  id: 'd-holiday',
  sessionId: 's1',
  createdAt: Date.UTC(2026, 9, 5, 2), // 国庆法定假日，即使落在工作日峰值时段也按闲时
  provider: 'deepseek',
  model: 'deepseek-flash',
  baseUrlHost: 'api.deepseek.com',
  source: 'actual',
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cachedTokens: 0,
})
assert.ok(holidayPeakWindow)
assert.ok(Math.abs(holidayPeakWindow.amount - 0.75) < 1e-9)

const normalPeakWindow = estimateUsageTurnCost({
  id: 'd-peak',
  sessionId: 's1',
  createdAt: Date.UTC(2026, 9, 8, 2),
  provider: 'deepseek',
  model: 'deepseek-flash',
  baseUrlHost: 'api.deepseek.com',
  source: 'actual',
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cachedTokens: 0,
})
assert.ok(normalPeakWindow)
assert.ok(Math.abs(normalPeakWindow.amount - 1.5) < 1e-9)

const futureUnknownPeak = estimateUsageTurnCost({
  id: 'd-future',
  sessionId: 's1',
  createdAt: Date.UTC(2027, 9, 7, 2),
  provider: 'deepseek',
  model: 'deepseek-flash',
  baseUrlHost: 'api.deepseek.com',
  source: 'actual',
  inputTokens: 1000,
  outputTokens: 100,
})
assert.equal(futureUnknownPeak, null, '未来年份高峰窗无法确认法定假日时不硬算')

const unknown = estimateUsageTurnCost({
  id: 'u1',
  sessionId: 's1',
  createdAt: 1,
  provider: 'custom',
  model: 'whatever',
  baseUrlHost: 'relay.example.com',
  source: 'actual',
  inputTokens: 1000,
  outputTokens: 100,
})
assert.equal(unknown, null)

console.log('[usage info] 7 天汇总与缓存命中率只用可测轮次')
const summary = summarizeUsageTurns([
  {
    id: 'a',
    sessionId: 's1',
    createdAt: Date.UTC(2026, 9, 4, 2),
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    baseUrlHost: 'api.deepseek.com',
    source: 'actual',
    inputTokens: 1000,
    outputTokens: 100,
    cachedTokens: 500,
  },
  {
    id: 'b',
    sessionId: 's2',
    createdAt: Date.UTC(2026, 9, 4, 3),
    provider: 'custom',
    model: 'x',
    baseUrlHost: 'relay.example.com',
    source: 'estimate',
    inputTokens: 500,
    outputTokens: 50,
  },
], Date.UTC(2026, 9, 4, 12))
assert.equal(summary.totalTurns, 2)
assert.equal(summary.sessions.length, 2)
assert.equal(summary.cacheHitRate, 0.5)
assert.equal(summary.cacheUnknownTurns, 1)
assert.match(formatUsageMoney(summary.today.cost), /未知|\$|¥/)

console.log('[usage info] Chat 卸载后仍按本轮 owner session 落用量，React meter 才受 mounted 限制')
const chatSource = readFileSync(new URL('../src/components/Chat.tsx', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/lib/useChatScroll.ts', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/lib/chatStreamEngine.ts', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('../src/lib/useChatMessages.ts', import.meta.url), 'utf8')
assert.match(chatSource, /if \(mountedRef\.current\) setContextMeter\(completedContextState\)/)
assert.match(chatSource, /if \(roundSessionId\) setContextUsage\(completedContextState, roundSessionId, settings\)/)
assert.doesNotMatch(chatSource, /if \(activeSessionId\) setContextUsage\(actualContextState, activeSessionId\)/)

console.log('[usage info] 页面名和入口位置固定为“使用与支持 → 用量信息”')
const settingsSource = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8')
const supportStart = settingsSource.indexOf('<ProfileGroup title="使用与支持">')
const supportEnd = settingsSource.indexOf('</ProfileGroup>', supportStart)
assert.ok(supportStart >= 0 && supportEnd > supportStart)
const supportBlock = settingsSource.slice(supportStart, supportEnd)
assert.match(supportBlock, /label="用量信息"/)
assert.match(settingsSource, /<DetailHeader title="用量信息"/)
assert.doesNotMatch(supportBlock, /用量与成本/)

console.log('usage info tests passed')
