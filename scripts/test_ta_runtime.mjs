// TASK-TA-RUNTIME-V1 单测：Persistent TA Runtime（生命周期 / 隔离 / persona 加权 / 防重复 / 时间 / sync / Busy 红线 / 一致性）
// 运行：node scripts/test_ta_runtime.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  ACTIVITIES,
  applyCloudTaRuntime,
  buildTaRuntimeContext,
  collectAllTaRuntime,
  formatRuntimeUntil,
  getOrAdvanceTaRuntime,
  getSessionPersona,
  getTaRuntime,
  runtimeSlot,
} from '../src/lib/taRuntime.ts'

let pass = 0
let fail = 0
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.log(`  ✗ ${msg}\n    期望 ${e}\n    实际 ${a}`)
  }
}
function ok(cond, msg) {
  if (cond) pass++
  else {
    fail++
    console.log(`  ✗ ${msg}`)
  }
}
function group(name) {
  console.log(`\n== ${name} ==`)
}

// ---- 简易 localStorage mock（Node 无 localStorage；沿用项目测试惯例） ----
function makeLS() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v))
    },
    removeItem: (k) => {
      m.delete(k)
    },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
    _map: m,
  }
}
globalThis.localStorage = makeLS()

const SESSIONS_KEY = 'ai_companion_sessions_cache'
const PERSONA_KEY = 'ai_companion_persona'
function seedSession(id, persona) {
  const list = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]')
  list.push({ id, title: `role-${id}`, persona, created_at: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' })
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(list))
}
function clearLS() {
  localStorage.clear()
}
// 固定 now：2026-09-15 10:00 本地（白天）
const NOW_MORNING = new Date(2026, 8, 15, 10, 0, 0).getTime()
const NOW_EVENING = new Date(2026, 8, 15, 18, 0, 0).getTime()
const RAND_HALF = () => 0.5
const RAND_ZERO = () => 0

const taSrc = readFileSync(fileURLToPath(new URL('../src/lib/taRuntime.ts', import.meta.url)), 'utf8')
const homeSrc = readFileSync(fileURLToPath(new URL('../src/components/Home.tsx', import.meta.url)), 'utf8')
const chatSrc = readFileSync(fileURLToPath(new URL('../src/components/Chat.tsx', import.meta.url)), 'utf8')
const syncSrc = readFileSync(fileURLToPath(new URL('../src/lib/sync.ts', import.meta.url)), 'utf8')

// ============ A. 生命周期 ============
group('A. 生命周期')
{
  clearLS()
  const s1 = getOrAdvanceTaRuntime('s1', '', NOW_MORNING, RAND_HALF)
  ok(s1 && typeof s1.activityId === 'string' && s1.activityId.length > 0, 'A1 首次创建返回合法 state')
  ok(ACTIVITIES.some((a) => a.id === s1.activityId), 'A1 activityId 在活动池内')
  ok(typeof s1.label === 'string' && s1.label.length > 0, 'A1 label 非空')
  eq(s1.startedAt, NOW_MORNING, 'A1 startedAt = now')
  ok(s1.plannedUntil > s1.startedAt, 'A1 plannedUntil > startedAt')
  eq(s1.updatedAt, NOW_MORNING, 'A1 updatedAt = now')
  ok(s1.source === 'routine' || s1.source === 'persona', 'A1 source 合法')

  const s1b = getOrAdvanceTaRuntime('s1', '', NOW_MORNING + 60000, RAND_HALF)
  eq(s1b, s1, 'A2 未到 plannedUntil 重读完全不变（含刷新等价）')
  const s1c = getOrAdvanceTaRuntime('s1', '', NOW_MORNING + 120000, () => 0.99)
  eq(s1c, s1, 'A3 刷新/重读不重新随机（rand 不同也不变）')

  const s1d = getOrAdvanceTaRuntime('s1', '', s1.plannedUntil, RAND_HALF)
  ok(s1d.updatedAt === s1.plannedUntil, 'A4 now == plannedUntil 时推进（updatedAt 更新）')
  ok(s1d.startedAt === s1.plannedUntil, 'A4 推进后 startedAt = 推进时刻')

  const s1e = getOrAdvanceTaRuntime('s1', '', s1d.plannedUntil + 99999, RAND_HALF)
  ok(s1e.updatedAt === s1d.plannedUntil + 99999, 'A5 now > plannedUntil 时推进')
  const act = ACTIVITIES.find((a) => a.id === s1e.activityId)
  ok(act != null, 'A7 新状态 activityId 合法')
  const durMin = (s1e.plannedUntil - s1e.startedAt) / 60000
  ok(durMin >= act.minMin && durMin <= act.maxMin, `A7 新状态时长在活动范围内（${durMin}min ∈ ${act.minMin}-${act.maxMin}）`)
}

// ============ B. session 隔离 ============
group('B. session 隔离')
{
  clearLS()
  const a1 = getOrAdvanceTaRuntime('sA', '', NOW_MORNING, RAND_HALF)
  const b1 = getOrAdvanceTaRuntime('sB', '', NOW_MORNING, RAND_HALF)
  eq(getTaRuntime('sB'), b1, 'B8 sA/sB 状态独立（互不覆盖）')
  // A 推进
  getOrAdvanceTaRuntime('sA', '', a1.plannedUntil + 1, RAND_HALF)
  eq(getTaRuntime('sB'), b1, 'B9 A 推进不影响 B')
  const b2 = getOrAdvanceTaRuntime('sB', '', NOW_MORNING + 5000, RAND_HALF)
  eq(b2, b1, 'B10 切角色后不读取另一角色 Runtime（B 用自己状态）')
  ok(getTaRuntime('sA').activityId !== getTaRuntime('sB').activityId || getTaRuntime('sA').startedAt !== getTaRuntime('sB').startedAt, 'B10 A/B 状态对象不同')
}

// ============ C. Persona ============
group('C. Persona')
{
  clearLS()
  seedSession(11, '很爱看书，喜欢安静')
  seedSession(12, '')
  localStorage.setItem(PERSONA_KEY, '')
  const p = getSessionPersona('11')
  ok(p.includes('看书'), 'C11 getSessionPersona 从会话 cache 取 persona')
  eq(getSessionPersona('12'), '', 'C11 空 persona 返回空串')
  localStorage.setItem(PERSONA_KEY, '全局兜底人设')
  eq(getSessionPersona('999'), '全局兜底人设', 'C11 找不到会话时 fallback loadPersona')
  // C12 reading persona 提高 reading 候选概率：夜晚时段统计分布（1000 次抽样，非单次随机）
  const EVENING = new Date(2026, 8, 15, 21, 0, 0).getTime()
  const countReading = (persona) => {
    let n = 0
    for (let i = 0; i < 1000; i++) {
      const r = getOrAdvanceTaRuntime(`probe-${persona ? 'r' : 'n'}-${i}`, persona, EVENING, () => i / 1000)
      if (r.activityId === 'reading') n++
    }
    return n
  }
  const withAnchor = countReading('很爱看书')
  const withoutAnchor = countReading('')
  ok(withAnchor > withoutAnchor, `C12 reading persona 提高 reading 候选概率（${withAnchor} > ${withoutAnchor}）`)
  ok(withAnchor > 0, 'C12 有 anchor 时 reading 至少出现')
  const syncRet = getOrAdvanceTaRuntime('sync-check', '', NOW_MORNING, RAND_HALF)
  ok(!(syncRet instanceof Promise), 'C13 纯本地同步返回，不产生异步/LLM 调用')
  ok(!/from\s+['"]\.\.?\/[^'"]*api[^'"]*['"]/.test(taSrc), 'C13 taRuntime 不 import api 层（零 LLM）')
  ok(!/chatCompletion|streamChat/.test(taSrc), 'C13 taRuntime 源码无模型调用函数')
  clearLS()
  const fb = getOrAdvanceTaRuntime('s14', '', NOW_MORNING, RAND_ZERO)
  ok(fb && fb.activityId.length > 0, 'C14 persona 空时稳定 fallback（正常创建）')
}

// ============ D. 重复防护 ============
group('D. 重复防护')
{
  clearLS()
  const d1 = getOrAdvanceTaRuntime('sD', '', NOW_MORNING, RAND_HALF)
  const d2 = getOrAdvanceTaRuntime('sD', '', d1.plannedUntil + 1, RAND_HALF)
  ok(d2.activityId !== d1.activityId, 'D15 下一活动避免与 previous activityId 相同')
  // 极端候选池：反复推进 50 次不死循环、每次返回有效 state
  let cur = getOrAdvanceTaRuntime('sD2', '', new Date(2026, 8, 15, 2, 0, 0).getTime(), RAND_HALF) // 凌晨
  let okLoop = true
  for (let i = 0; i < 50; i++) {
    const next = getOrAdvanceTaRuntime('sD2', '', cur.plannedUntil + 1, () => 0.999)
    if (!next || !next.activityId || !(next.plannedUntil > next.startedAt)) {
      okLoop = false
      break
    }
    cur = next
  }
  ok(okLoop, 'D16 极端候选池反复推进不死循环、状态合法')
}

// ============ E. 时间 ============
group('E. 时间')
{
  const slotAt = (h, m = 0) => runtimeSlot(new Date(2026, 8, 15, h, m))
  eq(slotAt(4, 59), '凌晨', 'E17 4:59 → 凌晨')
  eq(slotAt(5), '早晨', 'E17 5:00 → 早晨')
  eq(slotAt(10, 59), '早晨', 'E17 10:59 → 早晨')
  eq(slotAt(11), '白天', 'E17 11:00 → 白天')
  eq(slotAt(16, 59), '白天', 'E17 16:59 → 白天')
  eq(slotAt(17), '傍晚', 'E17 17:00 → 傍晚')
  eq(slotAt(18, 59), '傍晚', 'E17 18:59 → 傍晚')
  eq(slotAt(19), '夜晚', 'E17 19:00 → 夜晚')
  eq(slotAt(22, 59), '夜晚', 'E17 22:59 → 夜晚')
  eq(slotAt(23), '凌晨', 'E17 23:00 → 凌晨')
  clearLS()
  const e1 = getOrAdvanceTaRuntime('sE', '', NOW_MORNING, RAND_HALF)
  const e2 = getOrAdvanceTaRuntime('sE', '', NOW_MORNING + 1000, RAND_HALF)
  eq(e2.plannedUntil, e1.plannedUntil, 'E18 plannedUntil 稳定（不重抽）')
  const spans = new Set(ACTIVITIES.map((a) => `${a.minMin}-${a.maxMin}`))
  ok(spans.size >= 4, 'E19 活动持续时间不是全局固定值（时长范围多样）')
  const act = ACTIVITIES.find((a) => a.id === e1.activityId)
  const durMin = (e1.plannedUntil - e1.startedAt) / 60000
  ok(durMin >= act.minMin && durMin <= act.maxMin, 'E19 时长落在活动自身范围')
  // E20 本地时间边界可测：各边界时刻创建均合法
  const b1 = getOrAdvanceTaRuntime('e20a', '', new Date(2026, 8, 15, 4, 59).getTime(), RAND_HALF)
  const b2 = getOrAdvanceTaRuntime('e20b', '', new Date(2026, 8, 15, 17, 0).getTime(), RAND_HALF)
  const b3 = getOrAdvanceTaRuntime('e20c', '', new Date(2026, 8, 15, 23, 0).getTime(), RAND_HALF)
  ok(b1.activityId && b2.activityId && b3.activityId, 'E20 边界时刻创建均合法')
}

// ============ F. sync ============
group('F. sync')
{
  clearLS()
  const f1 = getOrAdvanceTaRuntime('s1', '', NOW_MORNING, RAND_HALF)
  const f2 = getOrAdvanceTaRuntime('s2', '', NOW_MORNING, RAND_HALF)
  const all = collectAllTaRuntime()
  ok('s1' in all && 's2' in all, 'F21 collectAllTaRuntime 保留 sid 归属')
  eq(all.s1, f1, 'F21 状态对象保真')
  // F22 cloud-only 恢复
  clearLS()
  const cloudState = { activityId: 'reading', label: '正在看书', startedAt: 1, plannedUntil: 9999999999999, updatedAt: 500, source: 'routine' }
  applyCloudTaRuntime({ s1: cloudState })
  eq(getTaRuntime('s1'), cloudState, 'F22 cloud-only Runtime 可恢复')
  // F23 local-only 不被 undefined/空 cloud 清掉
  applyCloudTaRuntime(undefined)
  eq(getTaRuntime('s1'), cloudState, 'F23 undefined cloud 不清本地')
  applyCloudTaRuntime({})
  eq(getTaRuntime('s1'), cloudState, 'F23 空对象 cloud 不清本地')
  // F24 cloud updatedAt 新 → cloud 胜
  const cloudNew = { ...cloudState, label: '正在喝咖啡', updatedAt: 900 }
  applyCloudTaRuntime({ s1: cloudNew })
  eq(getTaRuntime('s1').label, '正在喝咖啡', 'F24 cloud updatedAt 新 → cloud 胜')
  // F25 local updatedAt 新 → local 胜
  const localNew = { ...cloudState, label: '正在看电影', updatedAt: 1200 }
  localStorage.setItem('ai_companion_ta_runtime', JSON.stringify({ s1: localNew }))
  applyCloudTaRuntime({ s1: cloudNew })
  eq(getTaRuntime('s1').label, '正在看电影', 'F25 local updatedAt 新 → local 胜')
  // F26 旧 blob 无 taRuntime → 不报错（undefined/null 都吞掉）
  let noErr = true
  try {
    applyCloudTaRuntime(undefined)
    applyCloudTaRuntime(null)
    applyCloudTaRuntime({})
  } catch {
    noErr = false
  }
  ok(noErr, 'F26 旧 blob 无 taRuntime 不报错')
  ok(getTaRuntime('s1').label === '正在看电影', 'F26 且不清本地')
  // F27 同步回来的过期 state 下一次 getter 推进
  const expired = { activityId: 'sleep', label: '正在睡觉', startedAt: 1, plannedUntil: 2, updatedAt: 1, source: 'routine' }
  applyCloudTaRuntime({ sExp: expired })
  const advanced = getOrAdvanceTaRuntime('sExp', '', NOW_EVENING, RAND_HALF)
  ok(advanced.activityId !== 'sleep' || advanced.updatedAt > 1, 'F27 同步回的过期 state 下次 getter 自然推进')
  // F28 多角色 Record 不丢归属
  clearLS()
  const g1 = getOrAdvanceTaRuntime('g1', '', NOW_MORNING, RAND_HALF)
  const g2 = getOrAdvanceTaRuntime('g2', '', NOW_MORNING, () => 0.99)
  const rec = collectAllTaRuntime()
  ok(rec.g1.activityId === g1.activityId && rec.g2.activityId === g2.activityId, 'F28 多角色 Record 不丢归属')
}

// ============ G. Busy 红线 ============
group('G. Busy 红线')
{
  clearLS()
  const g = getOrAdvanceTaRuntime('sBusy', '很爱看书，喜欢工作', NOW_MORNING, RAND_HALF)
  const keys = Object.keys(g)
  ok(!keys.includes('status') && !keys.includes('busy') && !keys.includes('busyUntil') && !keys.includes('isBusy') && !keys.includes('canReply'), 'G29 Runtime state 无 busy 字段')
  ok(!localStorage._map.has('ai_companion_busy_sBusy'), 'G30 reading/work persona 不触发 Busy 写入')
  ok(!/from\s+['"].*aiBusy['"]/.test(taSrc), 'G31 taRuntime.ts 不 import aiBusy（零依赖）')
  ok(!/setItem\(['"][^'"]*busy/i.test(taSrc), 'G31 taRuntime 无 busy 存储写（key 写）')
}

// ============ H. Chat / Home 一致性 ============
group('H. Chat / Home 一致性')
{
  ok(homeSrc.includes('getOrAdvanceTaRuntime'), 'H32 Home 使用同一 Runtime getter')
  ok(chatSrc.includes('getOrAdvanceTaRuntime'), 'H32 Chat 使用同一 Runtime getter')
  const chatCalls = (chatSrc.match(/getOrAdvanceTaRuntime\(/g) || []).length
  eq(chatCalls, 1, 'H33 Chat 不创建第二套随机 Runtime（仅 1 处调用）')
  ok(chatSrc.includes('buildTaRuntimeContext'), 'H33 Chat 用 buildTaRuntimeContext 注入同一状态')
  const zhCtx = buildTaRuntimeContext({ activityId: 'reading', label: '正在看书', startedAt: 1, plannedUntil: new Date(2026, 8, 15, 22, 30).getTime(), updatedAt: 1, source: 'routine' }, 'zh')
  ok(zhCtx.includes('【TA 此刻】') && zhCtx.includes('TA 自己当前的生活状态') && zhCtx.includes('预计会持续到 22:30 左右'), 'H34 zh context 明确属于 TA 当前状态')
  ok(!/我们之前|你刚才陪|我们俩一起/.test(zhCtx), 'H34 zh context 无伪造共同经历句式')
  ok(zhCtx.includes('不是你们的共同经历'), 'H34 zh context 以否定形式声明非共同经历')
  const enCtx = buildTaRuntimeContext({ activityId: 'reading', label: 'Reading a book', startedAt: 1, plannedUntil: new Date(2026, 8, 15, 22, 30).getTime(), updatedAt: 1, source: 'routine' }, 'en')
  ok(enCtx.includes('What TA is doing right now') && enCtx.includes('until around 22:30'), 'H34 en context 属于 TA 当前状态')
  ok(zhCtx !== '' && enCtx !== '', 'H34 context 非空')
  eq(buildTaRuntimeContext(null, 'zh'), '', 'H34 null runtime → 空串（调用方跳过）')
  ok(!/ai_companion_memory|ai_companion_anniversaries|ai_companion_events|_events/.test(taSrc), 'H35 源码无 Memory/Event/Anniversary 存储 key 写（仅注释提到）')
  // 行为：创建 Runtime 后 Memory/Event/Anniversary key 不被写入
  clearLS()
  getOrAdvanceTaRuntime('sH', '', NOW_MORNING, RAND_HALF)
  const keys2 = [...localStorage._map.keys()]
  ok(!keys2.some((k) => /memory|annivers|event/.test(k)), 'H35 创建 Runtime 不写 Memory/Event/Anniversary')
  // formatRuntimeUntil
  eq(formatRuntimeUntil(new Date(2026, 8, 15, 9, 5).getTime()), '09:05', 'H34 formatRuntimeUntil 补零')
  // sync.ts 接入确认
  ok(syncSrc.includes('taRuntime: collectAllTaRuntime()'), 'H-sync collectData 接 Runtime')
  ok(syncSrc.includes('applyCloudTaRuntime(d.taRuntime)'), 'H-sync applyData 接 Runtime')
  ok(/taRuntime\?: Record<string, TaRuntimeState>/.test(syncSrc), 'H-sync SyncData 可选字段（向后兼容）')
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exit(1)
