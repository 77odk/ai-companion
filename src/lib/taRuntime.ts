// TASK-TA-RUNTIME-V1 · Persistent TA Runtime
// 同一个 TA 在一段合理时间内持续做同一件事：Home 与 Chat 读同一份持久状态；
// 惰性推进（只在 getter 被调用且 now >= plannedUntil 时才换活动），零额外 LLM、无 timer / 后台轮询。
//
// ★产品边界：Runtime ≠ Busy。Runtime 回答「TA 此刻正在做什么」；Busy 回答「TA 此刻是否暂时无法陪伴」。
// 本文件绝不读写 Busy（不 import aiBusy / 不写 ai_companion_busy_*），普通生活活动绝不触发 Busy。
// 也绝不写 Memory / Event / Anniversary / FutureIntent / Space Life——Runtime 只是正在发生的短状态。
//
// 存储：单一 key ai_companion_ta_runtime（Record<sid, TaRuntimeState>），只经本文件读写，组件禁止直连。

import { getSessionsCache } from './sessionStore.ts'
import { loadPersona } from './storage.ts'
import type { Lang } from './langDetect.ts'

/** Runtime 状态最小结构（V1 禁止扩字段：不加 mood/location/weather/description/busy 等） */
export interface TaRuntimeState {
  /** 活动标识（activityId，见 ACTIVITIES） */
  activityId: string
  /** 展示文案（Home「TA 此刻」：「正在看书」「准备睡了」） */
  label: string
  /** 本段活动开始时间戳 */
  startedAt: number
  /** 计划结束时间戳（创建后稳定，不因刷新/重读重抽） */
  plannedUntil: number
  /** 本状态写入/推进时间戳（sync 冲突：updatedAt 更新者胜） */
  updatedAt: number
  /** persona 锚点命中 → 'persona'；纯时段/随机 → 'routine' */
  source: 'routine' | 'persona'
}

/** 时段（够用即可，不做细粒度规划器） */
export type RuntimeSlot = '凌晨' | '早晨' | '白天' | '傍晚' | '夜晚'

interface RuntimeActivity {
  id: string
  label: string
  slots: RuntimeSlot[]
  /** 时长范围（分钟）：早餐短于工作、散步短于电影、睡眠明显长于喝咖啡 */
  minMin: number
  maxMin: number
  /** persona 锚点正则（命中 → 权重 +2，只影响概率，绝不影响 Busy） */
  persona?: RegExp
}

/** 活动池：覆盖基本生活，文案自然克制（主语都是 TA 自己的语境） */
export const ACTIVITIES: readonly RuntimeActivity[] = [
  { id: 'wake_up', label: '刚起床，正在洗漱', slots: ['早晨'], minMin: 15, maxMin: 30 },
  { id: 'breakfast', label: '正在吃早餐', slots: ['早晨', '白天'], minMin: 20, maxMin: 40 },
  { id: 'coffee', label: '正在喝咖啡', slots: ['白天', '夜晚'], minMin: 20, maxMin: 40, persona: /咖啡|喝茶|茶|奶茶/ },
  { id: 'commute', label: '正在通勤路上', slots: ['早晨', '傍晚'], minMin: 30, maxMin: 60 },
  { id: 'work', label: '正在忙工作', slots: ['白天'], minMin: 90, maxMin: 180 },
  { id: 'class', label: '正在上课', slots: ['白天'], minMin: 90, maxMin: 120 },
  { id: 'reading', label: '正在看书', slots: ['白天', '傍晚', '夜晚', '凌晨'], minMin: 45, maxMin: 120, persona: /书|阅读|小说|文学|读书|码字/ },
  { id: 'lunch', label: '正在吃午饭', slots: ['白天'], minMin: 30, maxMin: 50 },
  { id: 'errand', label: '在外面办点事', slots: ['白天', '傍晚'], minMin: 60, maxMin: 120 },
  { id: 'home', label: '刚到家，正在收拾', slots: ['傍晚'], minMin: 20, maxMin: 40 },
  { id: 'cooking', label: '正在做饭', slots: ['傍晚', '夜晚'], minMin: 40, maxMin: 80, persona: /做饭|厨艺|烘焙|煮|下厨/ },
  { id: 'dinner', label: '正在吃晚饭', slots: ['傍晚', '夜晚'], minMin: 30, maxMin: 50 },
  { id: 'walk', label: '正在外面散步', slots: ['傍晚', '夜晚'], minMin: 30, maxMin: 60, persona: /散步|遛狗|走走|压马路/ },
  { id: 'exercise', label: '正在运动', slots: ['白天', '傍晚', '夜晚'], minMin: 40, maxMin: 90, persona: /运动|健身|跑步|游泳|打球|瑜伽|撸铁/ },
  { id: 'movie', label: '正在看电影', slots: ['夜晚'], minMin: 100, maxMin: 150, persona: /电影|看剧|追剧|刷剧|影|动漫/ },
  { id: 'gaming', label: '正在打游戏', slots: ['夜晚', '凌晨'], minMin: 60, maxMin: 150, persona: /游戏|电竞|打排位|开黑|steam/i },
  { id: 'shower', label: '正在洗漱', slots: ['夜晚', '凌晨'], minMin: 15, maxMin: 30 },
  { id: 'rest', label: '正窝着休息', slots: ['夜晚'], minMin: 30, maxMin: 90 },
  { id: 'sleep_prep', label: '准备睡了', slots: ['夜晚', '凌晨'], minMin: 15, maxMin: 30 },
  { id: 'sleep', label: '正在睡觉', slots: ['凌晨'], minMin: 240, maxMin: 480 },
]

/** 存储 key：单一 Runtime 存储（Record<sid, TaRuntimeState>），只经本文件读写 */
const RUNTIME_KEY = 'ai_companion_ta_runtime'

/** 无会话（游客/过渡态）兜底 key：不与任何角色共享 */
const GUEST_KEY = '_guest'

/** 时段划分：凌晨 <5 || >=23；早晨 5-11；白天 11-17；傍晚 17-19；夜晚 19-23 */
export function runtimeSlot(now: Date): RuntimeSlot {
  const d = now instanceof Date ? now : new Date()
  const h = d.getHours()
  if (h < 5 || h >= 23) return '凌晨'
  if (h < 11) return '早晨'
  if (h < 17) return '白天'
  if (h < 19) return '傍晚'
  return '夜晚'
}

function loadAll(): Record<string, TaRuntimeState> {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? (obj as Record<string, TaRuntimeState>) : {}
  } catch {
    return {}
  }
}

function saveAll(map: Record<string, TaRuntimeState>): void {
  try {
    localStorage.setItem(RUNTIME_KEY, JSON.stringify(map))
  } catch {
    // 存不下不影响
  }
}

/** 直接读取某会话 Runtime（不推进）；无 → null */
export function getTaRuntime(sessionId?: string): TaRuntimeState | null {
  const key = sessionId || GUEST_KEY
  const cur = loadAll()[key]
  return cur && typeof cur.activityId === 'string' ? cur : null
}

/** 按项目既有链取当前角色 persona：getSessionsCache → session.persona；找不到 → loadPersona() 兜底 */
export function getSessionPersona(sessionId?: string): string {
  if (sessionId) {
    try {
      const s = getSessionsCache().find((x) => String(x.id) === sessionId)
      if (s && typeof s.persona === 'string' && s.persona.trim()) return s.persona
    } catch {
      // 缓存异常走兜底
    }
  }
  try {
    const g = loadPersona()
    return typeof g === 'string' ? g : ''
  } catch {
    return ''
  }
}

/** persona 锚点命中该活动？只用于概率加权，绝不影响 Busy */
function personaHit(a: RuntimeActivity, persona: string): boolean {
  return Boolean(a.persona && persona && a.persona.test(persona))
}

function pickActivity(slot: RuntimeSlot, persona: string, previousId: string | null, rand: () => number): RuntimeActivity {
  const pool = ACTIVITIES.filter((a) => a.slots.includes(slot))
  if (pool.length === 0) return ACTIVITIES[0] // 理论上不会（表是满的），兜底防死循环
  // 避免连续两次同一活动：候选 ≥2 时排除 previous；极端只剩 1 个时保留原池（安全 fallback）
  let candidates = pool
  let weights = pool.map((a) => 1 + (personaHit(a, persona) ? 2 : 0))
  const rest = pool.filter((a) => a.id !== previousId)
  if (rest.length > 0) {
    candidates = rest
    weights = rest.map((a) => 1 + (personaHit(a, persona) ? 2 : 0))
  }
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r < 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

function createState(activity: RuntimeActivity, now: number, rand: () => number, persona: string): TaRuntimeState {
  const durMin = activity.minMin + Math.floor(rand() * (activity.maxMin - activity.minMin + 1))
  return {
    activityId: activity.id,
    label: activity.label,
    startedAt: now,
    plannedUntil: now + durMin * 60000,
    updatedAt: now,
    source: personaHit(activity, persona) ? 'persona' : 'routine',
  }
}

/**
 * 核心 API（Lazy Runtime）：
 * 1) 无状态 → 按 当前时间 + persona 创建并保存；
 * 2) now < plannedUntil → 原样返回（刷新/重渲染/切 Tab 绝不重新随机）；
 * 3) now >= plannedUntil → 按 时间 + persona + 上一活动 选下一活动，写入并返回。
 * 幂等、零副作用除非推进；rand/now 可注入（测试稳定）。
 */
export function getOrAdvanceTaRuntime(
  sessionId: string | undefined,
  persona: string,
  now: number,
  rand: () => number = Math.random,
): TaRuntimeState {
  const map = loadAll()
  const key = sessionId || GUEST_KEY
  const cur = map[key]
  if (!cur || typeof cur.activityId !== 'string') {
    const fresh = createState(pickActivity(runtimeSlot(new Date(now)), persona, null, rand), now, rand, persona)
    map[key] = fresh
    saveAll(map)
    return fresh
  }
  if (now < cur.plannedUntil) return cur
  const next = createState(pickActivity(runtimeSlot(new Date(now)), persona, cur.activityId, rand), now, rand, persona)
  map[key] = next
  saveAll(map)
  return next
}

/** sync 收集：全部角色 Runtime（Record<sid, state>，保留归属） */
export function collectAllTaRuntime(): Record<string, TaRuntimeState> {
  return loadAll()
}

/**
 * sync 应用：按 updatedAt 更新者胜（同 sid 本地/云端都有 → 更新的那份覆盖）。
 * 旧 blob 无 taRuntime（undefined）→ 直接跳过：不报错、不清本地。
 * 注意：apply 只管「哪份 state 更新」；过期与否由 getter 下次读取时发现并自然推进。
 */
export function applyCloudTaRuntime(cloud: Record<string, TaRuntimeState> | undefined): void {
  if (!cloud || typeof cloud !== 'object') return
  const map = loadAll()
  let changed = false
  for (const [sid, cs] of Object.entries(cloud)) {
    if (!cs || typeof cs.activityId !== 'string' || typeof cs.plannedUntil !== 'number') continue
    const local = map[sid]
    if (!local || cs.updatedAt > local.updatedAt) {
      map[sid] = cs
      changed = true
    }
  }
  if (changed) saveAll(map)
}

/** HH:mm（24 小时制） */
export function formatRuntimeUntil(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Chat 注入文案：明确告诉模型这是 TA 自己当前的生活状态，
 * 不是对方告诉的事实、不是 Memory/Event/Anniversary/共同经历，禁止据此编「我们之前一起…」。
 */
export function buildTaRuntimeContext(runtime: TaRuntimeState | null, lang: Lang = 'zh'): string {
  if (!runtime || !runtime.label) return ''
  const until = formatRuntimeUntil(runtime.plannedUntil)
  if (lang === 'en') {
    return `[What TA is doing right now]\nThis is TA's own current life state — not something they told you, not a shared memory or event:\n${runtime.label}, probably until around ${until}.`
  }
  return `【TA 此刻】\n这是 TA 自己当前的生活状态（不是对方告诉你的，也不是你们的共同经历）：\n${runtime.label}，预计会持续到 ${until} 左右。`
}
