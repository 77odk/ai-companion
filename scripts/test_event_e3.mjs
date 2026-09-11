// Event E3 自测：同步（collectData/applyData 带 events）+ 空间时间轴换源 + 周记注入
// 跑法：node scripts/test_event_e3.mjs
import {
  createEvent,
  getEvents,
  loadEvents,
  softDeleteEvent,
} from '../src/lib/eventStore.ts'
import { getSharedExperiences } from '../src/lib/sharedExperiences.ts'
import { buildWeeklyPrompt } from '../src/lib/weeklyReview.ts'
import { collectData, applyData } from '../src/lib/sync.ts'
import { setSessionsCache, getActiveSessionId } from '../src/lib/sessionStore.ts'
import { saveSettings, savePersona, saveUserProfile, saveAIProfile } from '../src/lib/storage.ts'

let passed = 0
let failed = 0

function ok(cond, name) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
function resetAll() {
  store.clear()
}

console.log('\n[1] 空间时间轴换源（getSharedExperiences = Event）')
resetAll()
{
  // 无 Event → 空数组（空态由 UI 显示）
  ok(getSharedExperiences('s1').length === 0, '没有 Event → 空数组')
  createEvent({ sessionId: 's1', type: 'meal', title: '一起吃了火锅', description: '辣到冒汗', occurredAt: Date.parse('2026-09-10T12:00:00'), source: 'manual' })
  createEvent({ sessionId: 's1', type: 'trip', title: '去了趟公园', occurredAt: Date.parse('2026-09-08T10:00:00'), source: 'manual' })
  const nodes = getSharedExperiences('s1')
  ok(nodes.length === 2, '读 Event 生成 2 个节点')
  ok(nodes[0].title === '一起吃了火锅' && nodes[1].title === '去了趟公园', '按 occurredAt 倒序')
  ok(nodes[0].dateTs === Date.parse('2026-09-10T12:00:00'), 'dateTs = occurredAt')
  ok(nodes[0].description === '辣到冒汗', '描述透传')
  ok(typeof nodes[0].day === 'number' && nodes[0].day >= 1, 'day = 第 N 天（数字）')
  ok(nodes[0].id === getEvents('s1')[0].id, '节点带 Event id')
  ok(!('confidence' in nodes[0]) && !('source' in nodes[0]) && !('sessionId' in nodes[0]), '不暴露内部字段')
  // 软删后节点消失
  const ev = getEvents('s1')[0]
  softDeleteEvent('s1', ev.id)
  ok(getSharedExperiences('s1').length === 1, '软删后节点消失')
  ok(getSharedExperiences('s2').length === 0, '另一个角色看不到（隔离）')
}

console.log('\n[2] 周记注入（weekEvents 段）')
{
  const base = { weekLabel: '第 1 周', summaryLines: ['聊了天'], newMemories: [], daysKnown: 5 }
  const none = buildWeeklyPrompt(base)
  ok(!none.includes('【本周你们一起经历过的事】'), '不带 weekEvents → 无事件段')
  const withEv = buildWeeklyPrompt({ ...base, weekEvents: ['一起吃了火锅（辣到冒汗）', '去了趟公园'] })
  ok(withEv.includes('【本周你们一起经历过的事】'), '带 weekEvents → 有事件段')
  ok(withEv.includes('- 一起吃了火锅（辣到冒汗）'), '事件明细带描述')
  ok(withEv.includes('周记里可以自然地提一笔'), '只读引用引导语')
  const emptyArr = buildWeeklyPrompt({ ...base, weekEvents: ['', '  '] })
  ok(!emptyArr.includes('【本周你们一起经历过的事】'), '空串过滤后无事件段')
}

console.log('\n[3] 同步：collectData 带 events + applyData 合并写回')
resetAll()
{
  // 准备基础数据（collectData 读到的字段尽量留空即可，不抛错）
  saveSettings({ provider: 'zhipu', apiKey: '', baseUrl: '', model: '' })
  savePersona('')
  saveUserProfile({ name: '' })
  saveAIProfile({ nickname: 'TA' })
  setSessionsCache([{ id: 'sA', title: 'A' }, { id: 'sB', title: 'B' }])
  createEvent({ sessionId: 'sA', type: 'activity', title: '云端来一条', occurredAt: 1000, source: 'manual' })

  const data = collectData()
  ok(Array.isArray(data.events) && data.events.length === 1, 'collectData.events 含本地 Event')
  ok(data.events[0].title === '云端来一条', 'events 内容正确')

  // 模拟另一设备合并：云端多一条 + 本地软删一条
  const cloud = [
    ...data.events.map((e) => ({ ...e })),
    {
      id: 'cloud1', sessionId: 'sB', type: 'meal', title: 'B 的云端事件', occurredAt: 2000,
      createdAt: 1, updatedAt: 1, confidence: 1, source: 'manual',
    },
  ]
  applyData({ ...data, events: cloud })
  ok(getEvents('sA').some((e) => e.title === '云端来一条'), 'applyData 后 sA 事件保留')
  ok(getEvents('sB').some((e) => e.title === 'B 的云端事件'), 'applyData 分发到 sB')

  // 软删跨设备：本地软删 → collectData 带 deletedAt → 其他设备 applyData 后不可见
  const aEv = getEvents('sA')[0]
  softDeleteEvent('sA', aEv.id)
  const data2 = collectData()
  ok(data2.events.some((e) => e.id === aEv.id && e.deletedAt != null), '软删进同步包')
  store.clear()
  saveSettings({ provider: 'zhipu', apiKey: '', baseUrl: '', model: '' })
  savePersona('')
  saveUserProfile({ name: '' })
  saveAIProfile({ nickname: 'TA' })
  setSessionsCache([{ id: 'sA', title: 'A' }, { id: 'sB', title: 'B' }])
  applyData({ ...data2, events: data2.events })
  ok(getEvents('sA').length === 0, '新设备合并后 sA 可见为空（软删生效）')
  ok(loadEvents('sA').some((e) => e.id === aEv.id && e.deletedAt != null), '软删状态同步保留')

  // 老用户空态：云端 events 缺失（undefined）→ 不崩
  store.clear()
  saveSettings({ provider: 'zhipu', apiKey: '', baseUrl: '', model: '' })
  savePersona('')
  saveUserProfile({ name: '' })
  saveAIProfile({ nickname: 'TA' })
  applyData({ messages: [], memory: [], persona: '', userProfile: {}, aiProfile: {}, settings: {}, sessionStart: 0, anniversaries: [], mainAnniversary: null, spacePosts: [], aiProfiles: {} })
  ok(getSharedExperiences('sA').length === 0, '云端无 events → 空态不崩')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
