// Event 数据层自测（E1）：创建/校验/会话隔离/软删/编辑/合并/周查询/同步收集与分发
// 直接导入纯逻辑 TS（Node 22+ 原生类型剥离）。跑法：node scripts/test_event_store.mjs
import {
  createEvent,
  updateEvent,
  softDeleteEvent,
  getEvents,
  loadEvents,
  getRecentEvents,
  getEventsForWeek,
  collectAllEvents,
  mergeEvents,
  applyCloudEvents,
  distributeEventsToKeys,
  eventsKey,
  filterVisibleEvents,
  sortEventsDesc,
  validateEventInput,
  EVENT_TYPES,
} from '../src/lib/eventStore.ts'
import { setSessionsCache } from '../src/lib/sessionStore.ts'

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

// 简易 localStorage mock（Node 无 localStorage）
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
// notifyDataChanged 在 Node 里安全（addEventListener 兜底）
function resetAll() {
  store.clear()
}

console.log('\n[1] 创建与校验')
resetAll()
{
  const ev = createEvent({
    sessionId: 's1',
    type: 'meal',
    title: ' 一起吃了顿火锅 ',
    occurredAt: Date.parse('2026-09-10T12:00:00'),
    source: 'chat',
    confidence: 0.9,
  })
  ok(ev != null, '合法创建返回事件')
  ok(ev?.title === '一起吃了顿火锅', 'title 被 trim')
  ok(ev?.type === 'meal', 'type 保留')
  ok(ev?.confidence === 0.9, 'confidence 保留')
  ok(ev?.source === 'chat', 'source = chat')
  ok(ev?.sessionId === 's1', 'sessionId 记录')
  ok(ev?.deletedAt == null, '新建无软删标记')
  ok(ev?.updatedAt === ev?.createdAt, 'createdAt === updatedAt')

  ok(createEvent({ sessionId: 's1', title: '  ', occurredAt: Date.now(), source: 'manual' }) == null, '空标题拒')
  ok(createEvent({ sessionId: 's1', type: 'not-a-type', title: 'x', occurredAt: Date.now(), source: 'manual' }) == null, '非法类型拒')
  ok(createEvent({ sessionId: 's1', type: 'activity', title: 'x', occurredAt: 0, source: 'manual' }) == null, 'occurredAt 非法拒')
  ok(createEvent({ sessionId: 's1', type: 'activity', title: 'x', occurredAt: Date.now() + 99999, source: 'manual' }) != null, 'createEvent 本身不拦未来（硬过滤在识别层做）')
  ok(validateEventInput({ title: 'ok', occurredAt: Date.now(), type: 'activity' }) == null, 'validate 合法返回 null')
  ok(validateEventInput({ title: '', occurredAt: Date.now(), type: 'activity' }) === 'title-empty', 'validate 空标题报错')
  ok(validateEventInput({ title: 'x', occurredAt: -1, type: 'activity' }) === 'occurredAt-invalid', 'validate 时间非法报错')
  ok(validateEventInput({ title: 'x', occurredAt: Date.now(), type: 'bad' }) === 'type-invalid', 'validate 类型非法报错')
  ok(EVENT_TYPES.includes('activity') && EVENT_TYPES.includes('milestone'), '类型白名单齐全')
}

console.log('\n[2] 会话隔离')
resetAll()
{
  const a = createEvent({ sessionId: 'sA', type: 'activity', title: 'A 的事件', occurredAt: 1000, source: 'manual' })
  const b = createEvent({ sessionId: 'sB', type: 'trip', title: 'B 的事件', occurredAt: 2000, source: 'manual' })
  ok(a != null && b != null, '两个角色各建一条')
  const ga = getEvents('sA')
  const gb = getEvents('sB')
  ok(ga.length === 1 && ga[0].title === 'A 的事件', 'A 只看到自己的')
  ok(gb.length === 1 && gb[0].title === 'B 的事件', 'B 只看到自己的（A 检出的 B 看不到）')
  ok(eventsKey('sA').includes('_sA') && eventsKey(undefined) === 'ai_companion_events', 'key 按会话后缀/全局')
}

console.log('\n[3] 排序与可见过滤')
resetAll()
{
  createEvent({ sessionId: undefined, type: 'activity', title: '旧', occurredAt: 100, source: 'manual' })
  createEvent({ sessionId: undefined, type: 'activity', title: '新', occurredAt: 300, source: 'manual' })
  const list = getEvents(undefined)
  ok(list[0].title === '新' && list[1].title === '旧', 'occurredAt 倒序')
  const all = loadEvents(undefined)
  ok(filterVisibleEvents(all).length === 2, '可见过滤全过')
  softDeleteEvent(undefined, list[1].id)
  ok(getEvents(undefined).length === 1, '软删后列表只剩 1 条')
  ok(loadEvents(undefined).length === 2, '软删保留在底层（待同步）')
  const visible = getEvents(undefined)
  ok(visible[0].deletedAt == null, '可见的都是未删的')
  const recent = getRecentEvents(undefined, 5)
  ok(recent.length === 1 && recent[0].title === '新', 'getRecentEvents 取可见且倒序')
  ok(sortEventsDesc([{ occurredAt: 1, createdAt: 1 }, { occurredAt: 2, createdAt: 2 }])[0].occurredAt === 2, 'sortEventsDesc 倒序')
}

console.log('\n[4] 编辑与软删')
resetAll()
{
  const ev = createEvent({ sessionId: 's1', type: 'activity', title: '原题', occurredAt: 1000, source: 'manual' })
  const updated = updateEvent('s1', ev.id, { title: '改题', type: 'meal' })
  ok(updated?.title === '改题' && updated?.type === 'meal', '编辑生效')
  ok(updated?.updatedAt >= (updated?.createdAt ?? 0), '编辑刷新 updatedAt')
  ok(updateEvent('s1', 'nope', { title: 'x' }) == null, '编辑不存在的 id 返回 null')
  const deleted = softDeleteEvent('s1', ev.id)
  ok(deleted === true, '软删返回 true')
  ok(softDeleteEvent('s1', 'nope') === false, '软删不存在的 id 返回 false')
}

console.log('\n[5] mergeEvents：按 id 取 updatedAt 新 + 软删覆盖存活')
resetAll()
{
  const base = { sessionId: 's1', type: 'activity', title: 't', occurredAt: 1000, createdAt: 1, updatedAt: 1, confidence: 1, source: 'manual' }
  const local = [{ ...base, id: 'x1', title: '本地旧' }]
  const cloud = [{ ...base, id: 'x1', title: '云端新', updatedAt: 5 }]
  const merged = mergeEvents(local, cloud)
  ok(merged.length === 1 && merged[0].title === '云端新', '同 id 取 updatedAt 新')
  const cloud2 = [{ ...base, id: 'x2', title: '云端软删', updatedAt: 9, deletedAt: 9 }]
  const local2 = [{ ...base, id: 'x1', title: '本地独立', updatedAt: 3 }]
  const merged2 = mergeEvents(local2, cloud2)
  ok(merged2.length === 2, '不同 id 保留两边')
  const gone = merged2.find((e) => e.id === 'x2')
  ok(gone?.deletedAt != null && gone.title === '云端软删', 'deletedAt 非空的覆盖存活')
  const local3 = [{ ...base, id: 'x3', title: '本地软删', updatedAt: 10, deletedAt: 10 }]
  const cloud3 = [{ ...base, id: 'x3', title: '云端活', updatedAt: 4 }]
  const merged3 = mergeEvents(local3, cloud3)
  ok(merged3.find((e) => e.id === 'x3')?.deletedAt != null, '本地软删也赢（updatedAt 新）')
  ok(mergeEvents(null, null).length === 0, 'null 安全')
}

console.log('\n[6] 周窗口查询')
resetAll()
{
  createEvent({ sessionId: 's1', type: 'activity', title: '周一', occurredAt: Date.parse('2026-09-07T10:00:00'), source: 'manual' })
  createEvent({ sessionId: 's1', type: 'activity', title: '周三', occurredAt: Date.parse('2026-09-09T10:00:00'), source: 'manual' })
  createEvent({ sessionId: 's1', type: 'activity', title: '周日外', occurredAt: Date.parse('2026-09-13T10:00:00'), source: 'manual' })
  const week = getEventsForWeek('s1', Date.parse('2026-09-07T00:00:00'), Date.parse('2026-09-14T00:00:00'))
  ok(week.length === 3, '整周窗口收 3 条')
  ok(week[0].title === '周日外', '周窗口按 occurredAt 倒序')
  const day = getEventsForWeek('s1', Date.parse('2026-09-09T00:00:00'), Date.parse('2026-09-10T00:00:00'))
  ok(day.length === 1 && day[0].title === '周三', '单日窗口只收当天')
  ok(getEventsForWeek('s2', Date.parse('2026-09-07T00:00:00'), Date.parse('2026-09-14T00:00:00')).length === 0, '其他会话周查询为空（隔离）')
}

console.log('\n[7] 同步：collectAllEvents / applyCloudEvents / distributeEventsToKeys')
resetAll()
{
  setSessionsCache([{ id: 'sA', title: 'A' }, { id: 'sB', title: 'B' }])
  createEvent({ sessionId: 'sA', type: 'activity', title: 'A事', occurredAt: 100, source: 'manual' })
  createEvent({ sessionId: 'sB', type: 'meal', title: 'B事', occurredAt: 200, source: 'manual' })
  createEvent({ sessionId: undefined, type: 'trip', title: '全局事', occurredAt: 300, source: 'manual' })
  const all = collectAllEvents()
  ok(all.length === 3, 'collectAllEvents 汇总全局 + 各会话')
  ok(new Set(all.map((e) => e.title)).size === 3, '无重复')

  // 模拟设备 B：本地空 → 云端数据 applyCloudEvents 分发写回
  resetAll()
  setSessionsCache([{ id: 'sA', title: 'A' }, { id: 'sB', title: 'B' }])
  const cloud = [
    { id: 'c1', sessionId: 'sA', type: 'activity', title: '云A', occurredAt: 100, createdAt: 1, updatedAt: 1, confidence: 1, source: 'manual' },
    { id: 'c2', sessionId: 'sB', type: 'meal', title: '云B', occurredAt: 200, createdAt: 1, updatedAt: 1, confidence: 1, source: 'manual' },
    { id: 'c3', sessionId: '', type: 'trip', title: '云全局', occurredAt: 300, createdAt: 1, updatedAt: 1, confidence: 1, source: 'manual' },
  ]
  applyCloudEvents(cloud)
  ok(getEvents('sA').length === 1 && getEvents('sA')[0].title === '云A', '设备B 拉到 sA 的 Event')
  ok(getEvents('sB').length === 1 && getEvents('sB')[0].title === '云B', '设备B 拉到 sB 的 Event')
  ok(getEvents(undefined).length === 1 && getEvents(undefined)[0].title === '云全局', '设备B 拉到全局 Event')
  ok(getEvents('sA')[0].sessionId === 'sA', '分发后 sessionId 保留')

  // 合并不丢：本地已有 + 云端新增
  createEvent({ sessionId: 'sA', type: 'activity', title: '本地新增', occurredAt: 400, source: 'manual' })
  applyCloudEvents(cloud)
  ok(getEvents('sA').length === 2, 'applyCloudEvents 合并本地已有 + 云端')
  ok(getEvents('sA').some((e) => e.title === '本地新增'), '本地新增还在')

  // 软删跨设备：设备A 删了云端也有的一条 → 设备B 合并后看不到
  const evA = getEvents('sA').find((e) => e.title === '云A')
  softDeleteEvent('sA', evA.id)
  const deviceBAll = collectAllEvents()
  ok(deviceBAll.some((e) => e.id === evA.id && e.deletedAt != null), '软删进入同步包（deletedAt 非空）')
  const deviceBStore = new Map()
  store.clear()
  const keep = [...store.keys()]
  void keep
  for (const [k, v] of deviceBStore) store.set(k, v)
  applyCloudEvents(deviceBAll)
  ok(getEvents('sA').length === 1, '设备B 合并软删后只看到存活那条')

  // distributeEventsToKeys 干净分发
  resetAll()
  setSessionsCache([{ id: 'sA', title: 'A' }])
  distributeEventsToKeys(cloud)
  ok(getEvents('sA')[0].title === '云A' && getEvents(undefined)[0].title === '云全局', 'distributeEventsToKeys 按 sid 写回')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
