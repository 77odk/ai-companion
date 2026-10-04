import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getInitiativePreference,
  loadSettings,
  saveInitiativePreference,
  saveSettings,
} from '../src/lib/storage.ts'
import {
  chooseInitiativeCandidate,
  initiativeCooldownMs,
  isInitiativeQuietHour,
  markInitiativeDelivered,
  markInitiativeEngaged,
  markInitiativeIgnored,
} from '../src/lib/initiativePolicy.ts'

const store = new Map()
globalThis.localStorage = {
  getItem: (key) => store.has(key) ? store.get(key) : null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
  key: (index) => [...store.keys()][index] ?? null,
  get length() { return store.size },
}

const now = new Date(2026, 9, 8, 15, 0, 0).getTime()
const twoHoursAgo = now - 2 * 60 * 60 * 1000
const basePref = {
  enabled: true,
  dailyLimit: 2,
  quietStartHour: 23,
  quietEndHour: 8,
  lastDeliveredAt: 0,
  deliveredDay: '',
  deliveredCount: 0,
  ignoredStreak: 0,
  lastCandidateKey: '',
}

console.log('[initiative] 默认关闭、按 TA 隔离、复用 settings key')
assert.equal(getInitiativePreference('1').enabled, false)
assert.equal(saveInitiativePreference('1', { enabled: true }), true)
assert.equal(getInitiativePreference('1').enabled, true)
assert.equal(getInitiativePreference('2').enabled, false)
assert.equal([...store.keys()].every((key) => key === 'ai_companion_settings'), true, '不得新增 localStorage key')

console.log('[initiative] API 设置保存不能把主动消息偏好擦掉')
const settings = loadSettings()
saveSettings({ provider: settings.provider, apiKey: 'x', baseUrl: settings.baseUrl, model: settings.model })
assert.equal(getInitiativePreference('1').enabled, true)

console.log('[initiative] disabled / quiet / 无理由 = 零候选')
assert.equal(chooseInitiativeCandidate({
  preference: { ...basePref, enabled: false },
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [],
  events: [],
  anniversaries: [],
}), null)
const quietNow = new Date(2026, 9, 8, 23, 30, 0).getTime()
assert.equal(isInitiativeQuietHour(quietNow, 23, 8), true)
assert.equal(chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: quietNow - 3 * 60 * 60 * 1000,
  now: quietNow,
  futureTopics: [{ t: '今晚一起看电影', ts: quietNow - 86400000, futureDay: '2026-10-08' }],
  events: [],
  anniversaries: [],
}), null)
assert.equal(chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [],
  events: [],
  anniversaries: [],
}), null)

assert.equal(chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: now - 10 * 60 * 1000,
  now,
  futureTopics: [],
  events: [{
    id: 'short-away-event',
    sessionId: '1',
    type: 'activity',
    title: '刚发生的真实事件',
    occurredAt: now - 5 * 60 * 1000,
    createdAt: now - 5 * 60 * 1000,
    updatedAt: now - 5 * 60 * 1000,
    confidence: 1,
    source: 'manual',
  }],
  anniversaries: [],
}), null, '同日只离开几分钟不能主动触发')

console.log('[initiative] FutureIntent 到期才候选，未来计划不提前')
const future = chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [
    { t: '今天一起看电影', ts: now - 86400000, futureDay: '2026-10-08' },
    { t: '明天一起吃饭', ts: now - 1000, futureDay: '2026-10-09' },
  ],
  events: [],
  anniversaries: [],
})
assert.equal(future?.reason, 'future-intent')
assert.match(future?.evidence ?? '', /看电影/)

console.log('[initiative] 跨天补算覆盖到期计划')
const crossDay = chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: new Date(2026, 9, 7, 22, 0, 0).getTime(),
  now: new Date(2026, 9, 8, 9, 0, 0).getTime(),
  futureTopics: [{ t: '8号一起去看展', ts: now - 3 * 86400000, futureDay: '2026-10-08' }],
  events: [],
  anniversaries: [],
})
assert.equal(crossDay?.reason, 'future-intent')

console.log('[initiative] 真实 Event / 今日纪念日可成为候选')
const event = {
  id: 'ev1',
  sessionId: '1',
  type: 'activity',
  title: '一起完成了第一次长途旅行',
  occurredAt: now - 30 * 60 * 1000,
  createdAt: now - 30 * 60 * 1000,
  updatedAt: now - 30 * 60 * 1000,
  confidence: 1,
  source: 'manual',
}
const eventCandidate = chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [],
  events: [event],
  anniversaries: [],
})
assert.equal(eventCandidate?.reason, 'event')

const annCandidate = chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [],
  events: [],
  anniversaries: [{ id: 'a1', label: '认识 TA 的日子', date: '10-08', createdAt: 1 }],
})
assert.equal(annCandidate?.reason, 'anniversary')

console.log('[initiative] 同时有理由时优先 FutureIntent；同一候选不重复')
const priority = chooseInitiativeCandidate({
  preference: basePref,
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [{ t: '今天一起看电影', ts: now - 86400000, futureDay: '2026-10-08' }],
  events: [event],
  anniversaries: [{ id: 'a1', label: '认识 TA 的日子', date: '10-08', createdAt: 1 }],
})
assert.equal(priority?.reason, 'future-intent')
assert.ok(priority)
assert.equal(chooseInitiativeCandidate({
  preference: { ...basePref, lastCandidateKey: priority.key },
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [{ t: '今天一起看电影', ts: now - 86400000, futureDay: '2026-10-08' }],
  events: [],
  anniversaries: [],
}), null)

console.log('[initiative] 每日上限与连续不回应降频')
assert.equal(chooseInitiativeCandidate({
  preference: { ...basePref, deliveredDay: '2026-10-08', deliveredCount: 2 },
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [{ t: '今天一起看电影', ts: now - 86400000, futureDay: '2026-10-08' }],
  events: [],
  anniversaries: [],
}), null)
assert.equal(initiativeCooldownMs(0), 6 * 60 * 60 * 1000)
assert.equal(initiativeCooldownMs(1), 12 * 60 * 60 * 1000)
assert.equal(initiativeCooldownMs(4), 48 * 60 * 60 * 1000)
assert.equal(chooseInitiativeCandidate({
  preference: { ...basePref, lastDeliveredAt: now - 7 * 60 * 60 * 1000, ignoredStreak: 1 },
  lastActiveAt: twoHoursAgo,
  now,
  futureTopics: [{ t: '今天一起看电影', ts: now - 86400000, futureDay: '2026-10-08' }],
  events: [],
  anniversaries: [],
}), null)

console.log('[initiative] 投递/忽略/回应状态纯函数')
const delivered = markInitiativeDelivered(basePref, future, now)
assert.equal(delivered.deliveredCount, 1)
assert.equal(delivered.lastCandidateKey, future.key)
assert.equal(markInitiativeIgnored(delivered).ignoredStreak, 1)
assert.equal(markInitiativeEngaged({ ...delivered, ignoredStreak: 3 }).ignoredStreak, 0)

console.log('[initiative] 聊天设置入口与授权文案存在')
const settingsSource = readFileSync(new URL('../src/components/ChatSettings.tsx', import.meta.url), 'utf8')
assert.match(settingsSource, /<h2>主动消息<\/h2>/)
assert.match(settingsSource, /让 TA 主动找你/)
assert.match(settingsSource, /Key 不上传服务器/)
assert.match(settingsSource, /无理由时不会调用模型/)

console.log('initiative policy tests passed')
