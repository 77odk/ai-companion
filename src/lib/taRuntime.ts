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
import { resolveRolePersona } from './sessionProfile.ts'
import { loadPersona } from './storage.ts'
import type { Lang } from './langDetect.ts'
import { notifyDataChanged } from './dataChange.ts'

/** Runtime 状态最小结构：不加 mood/location/weather/description/busy 等。
 * recentActivityIds 只用于短期防重复，仍随同一 ta_runtime 实体保存，不新增 storage key。 */
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
  /** persona 锚点命中 → 'persona'；纯时段/随机 → 'routine'；聊天里 TA 明确说自己正在做 → 'chat' */
  source: 'routine' | 'persona' | 'chat'
  /** 最近活动（最新在前，含当前，最多 3 个）；旧数据可缺省 */
  recentActivityIds?: string[]
}

/** 时段（够用即可，不做细粒度规划器） */
export type RuntimeSlot = '凌晨' | '早晨' | '白天' | '傍晚' | '夜晚'

interface RuntimeActivity {
  id: string
  /** 中文展示文案（zh 行为不变） */
  label: string
  /** 英文展示文案（PATCH-LANG：English mode 用；labelEn 只影响展示，不参与 identity/选择/时长） */
  labelEn: string
  slots: RuntimeSlot[]
  /** 精确可出现时段，[分钟-of-day start, end)，end 可为 1440；用于避免 16:30 吃早餐这类穿帮 */
  windows: ReadonlyArray<readonly [number, number]>
  /** 时长范围（分钟）：早餐短于工作、散步短于电影、睡眠明显长于喝咖啡 */
  minMin: number
  maxMin: number
  /** persona 锚点正则（命中 → 权重 +2，只影响概率，绝不影响 Busy） */
  persona?: RegExp
}

/** 活动池：覆盖基本生活，文案自然克制（主语都是 TA 自己的语境）。labelEn 为英文展示文案（PATCH-LANG）。 */
export const ACTIVITIES: readonly RuntimeActivity[] = [
  { id: 'wake_up', label: '刚起床，正在洗漱', labelEn: 'Just got up, getting ready', slots: ['早晨'], windows: [[300, 570]], minMin: 15, maxMin: 30 },
  { id: 'breakfast', label: '正在吃早餐', labelEn: 'Having breakfast', slots: ['早晨', '白天'], windows: [[360, 630]], minMin: 20, maxMin: 40 },
  { id: 'coffee', label: '正在喝咖啡', labelEn: 'Having a coffee', slots: ['白天', '夜晚'], windows: [[420, 720], [810, 1020], [1140, 1320]], minMin: 20, maxMin: 40, persona: /咖啡|喝茶|茶|奶茶/ },
  { id: 'commute', label: '正在通勤路上', labelEn: 'On the way to work', slots: ['早晨', '傍晚'], windows: [[420, 600], [1020, 1170]], minMin: 30, maxMin: 60 },
  { id: 'work', label: '正在忙工作', labelEn: 'Busy with work', slots: ['白天'], windows: [[510, 1080]], minMin: 90, maxMin: 180 },
  { id: 'class', label: '正在上课', labelEn: 'In class', slots: ['白天'], windows: [[480, 1050]], minMin: 90, maxMin: 120 },
  { id: 'reading', label: '正在看书', labelEn: 'Reading a book', slots: ['白天', '傍晚', '夜晚', '凌晨'], windows: [[0, 120], [330, 1440]], minMin: 45, maxMin: 120, persona: /书|阅读|小说|文学|读书|码字/ },
  { id: 'lunch', label: '正在吃午饭', labelEn: 'Having lunch', slots: ['白天'], windows: [[660, 840]], minMin: 30, maxMin: 50 },
  { id: 'errand', label: '在外面办点事', labelEn: 'Out running an errand', slots: ['白天', '傍晚'], windows: [[540, 1200]], minMin: 60, maxMin: 120 },
  { id: 'home', label: '刚到家，正在收拾', labelEn: 'Just got home, settling in', slots: ['傍晚'], windows: [[1020, 1260]], minMin: 20, maxMin: 40 },
  { id: 'cooking', label: '正在做饭', labelEn: 'Cooking dinner', slots: ['傍晚', '夜晚'], windows: [[1020, 1260]], minMin: 40, maxMin: 80, persona: /做饭|厨艺|烘焙|煮|下厨/ },
  { id: 'dinner', label: '正在吃晚饭', labelEn: 'Having dinner', slots: ['傍晚', '夜晚'], windows: [[1050, 1320]], minMin: 30, maxMin: 50 },
  { id: 'walk', label: '正在外面散步', labelEn: 'Out for a walk', slots: ['傍晚', '夜晚'], windows: [[360, 600], [990, 1350]], minMin: 30, maxMin: 60, persona: /散步|遛狗|走走|压马路/ },
  { id: 'exercise', label: '正在运动', labelEn: 'Working out', slots: ['白天', '傍晚', '夜晚'], windows: [[330, 720], [960, 1320]], minMin: 40, maxMin: 90, persona: /运动|健身|跑步|游泳|打球|瑜伽|撸铁/ },
  { id: 'movie', label: '正在看电影', labelEn: 'Watching a movie', slots: ['夜晚'], windows: [[0, 90], [1140, 1440]], minMin: 100, maxMin: 150, persona: /电影|看剧|追剧|刷剧|影|动漫/ },
  { id: 'gaming', label: '正在打游戏', labelEn: 'Playing games', slots: ['夜晚', '凌晨'], windows: [[0, 150], [1140, 1440]], minMin: 60, maxMin: 150, persona: /游戏|电竞|打排位|开黑|steam/i },
  { id: 'shower', label: '正在洗漱', labelEn: 'Washing up', slots: ['夜晚', '凌晨'], windows: [[0, 90], [1260, 1440]], minMin: 15, maxMin: 30 },
  { id: 'rest', label: '正窝着休息', labelEn: 'Resting at home', slots: ['夜晚'], windows: [[0, 60], [1080, 1440]], minMin: 30, maxMin: 90 },
  { id: 'sleep_prep', label: '准备睡了', labelEn: 'Getting ready for bed', slots: ['夜晚', '凌晨'], windows: [[0, 120], [1320, 1440]], minMin: 15, maxMin: 30 },
  { id: 'sleep', label: '正在睡觉', labelEn: 'Sleeping', slots: ['凌晨'], windows: [[0, 480], [1380, 1440]], minMin: 240, maxMin: 480 },
]

type ChatRuntimeSignal = {
  activityId: string
  start: readonly RegExp[]
  finish?: readonly RegExp[]
}

/** 高置信度本地识别：只认 TA 对“自己此刻动作”的明确陈述；宁可漏，不把“你去洗澡吧”误写成 TA 在洗澡。 */
const CHAT_RUNTIME_SIGNALS: readonly ChatRuntimeSignal[] = [
  {
    activityId: 'wake_up',
    start: [/我(?:刚|才)?起床(?:了|呢)?/i, /\bi (?:just )?(?:woke|got) up\b/i],
    finish: [/我(?:已经|刚)?洗漱完了/i],
  },
  {
    activityId: 'breakfast',
    start: [/我(?:现在|正在|在|先去|去|要去)?吃(?:早饭|早餐)(?:了|呢)?/i, /\bi(?:'m| am) (?:having|eating) breakfast\b/i],
    finish: [/我(?:已经|刚)?吃完(?:早饭|早餐)了/i],
  },
  {
    activityId: 'coffee',
    start: [/我(?:现在|正在|在|先去|去|要去)?喝(?:咖啡|茶|奶茶)(?:了|呢)?/i, /\bi(?:'m| am) (?:having|drinking) (?:coffee|tea)\b/i],
    finish: [/我(?:已经|刚)?喝完(?:咖啡|茶|奶茶)了/i],
  },
  {
    activityId: 'commute',
    start: [/我(?:现在|正在|在)(?:通勤|上班路上|回家路上)/i, /\bi(?:'m| am) (?:commuting|on my way (?:to work|home))\b/i],
  },
  {
    activityId: 'work',
    start: [/我(?:现在|正在|在|先去|去|要去|得去)?(?:工作|上班|忙工作)(?:了|呢)?/i, /\bi(?:'m| am) (?:working|at work)\b/i],
    finish: [/我(?:已经|刚)?(?:忙完|工作完|下班)了/i, /\bi(?:'m| am) done (?:working|with work)\b/i],
  },
  {
    activityId: 'class',
    start: [/我(?:现在|正在|在|先去|去|要去)?上课(?:了|呢)?/i, /\bi(?:'m| am) (?:in class|heading to class)\b/i],
    finish: [/我(?:已经|刚)?(?:下课|上完课)了/i],
  },
  {
    activityId: 'reading',
    start: [/我(?:现在|正在|在|先去|去|要去|开始|还在)?(?:看书|读书|看小说)(?:了|呢)?/i, /\bi(?:'m| am) (?:reading|reading a book)\b/i],
    finish: [/我(?:已经|刚)?(?:看完书|读完书|看完小说)了/i, /\bi(?:'m| am) done reading\b/i],
  },
  {
    activityId: 'lunch',
    start: [/我(?:现在|正在|在|先去|去|要去)?吃午饭(?:了|呢)?/i, /\bi(?:'m| am) (?:having|eating) lunch\b/i],
    finish: [/我(?:已经|刚)?吃完午饭了/i],
  },
  {
    activityId: 'errand',
    start: [/我(?:现在|正在|在|先去|去|要去)?(?:办事|跑一趟|买点东西)(?:了|呢)?/i, /\bi(?:'m| am) (?:running an errand|out on an errand)\b/i],
  },
  {
    activityId: 'home',
    start: [/我(?:刚|才)?到家(?:了|呢)?/i, /\bi (?:just )?got home\b/i],
  },
  {
    activityId: 'cooking',
    start: [/我(?:现在|正在|在|先去|去|要去|开始)?(?:做饭|煮饭|下厨)(?:了|呢)?/i, /\bi(?:'m| am) cooking\b/i],
    finish: [/我(?:已经|刚)?(?:做完饭|做好饭|饭做好)了/i, /\bi(?:'m| am) done cooking\b/i],
  },
  {
    activityId: 'dinner',
    start: [/我(?:现在|正在|在|先去|去|要去)?吃晚饭(?:了|呢)?/i, /\bi(?:'m| am) (?:having|eating) dinner\b/i],
    finish: [/我(?:已经|刚)?吃完晚饭了/i],
  },
  {
    activityId: 'walk',
    start: [/我(?:现在|正在|在|先去|去|要去)?(?:散步|遛狗|出去走走)(?:了|呢)?/i, /\bi(?:'m| am) (?:out for a walk|walking the dog)\b/i],
    finish: [/我(?:已经|刚)?(?:散完步|遛完狗|走完|散步回来)了/i, /\bi(?:'m| am) back from (?:my walk|walking the dog)\b/i],
  },
  {
    activityId: 'exercise',
    start: [/我(?:现在|正在|在|先去|去|要去)?(?:运动|健身|跑步|游泳|打球|做瑜伽)(?:了|呢)?/i, /\bi(?:'m| am) (?:working out|running|swimming|at the gym)\b/i],
    finish: [/我(?:已经|刚)?(?:运动完|健身完|跑完步|游完泳|打完球)了/i, /\bi(?:'m| am) done (?:working out|running|swimming)\b/i],
  },
  {
    activityId: 'movie',
    start: [/我(?:现在|正在|在|先去|去|要去|开始)?(?:看电影|看剧|追剧)(?:了|呢)?/i, /\bi(?:'m| am) (?:watching a movie|watching a show)\b/i],
    finish: [/我(?:已经|刚)?(?:看完电影|电影看完|看完剧|剧看完)了/i, /\bi(?:'m| am) done watching (?:the movie|the show)\b/i],
  },
  {
    activityId: 'gaming',
    start: [/我(?:现在|正在|在|先去|去|要去|开始)?(?:打游戏|打排位|开黑)(?:了|呢)?/i, /\bi(?:'m| am) (?:playing games|gaming)\b/i],
    finish: [/我(?:已经|刚)?(?:打完游戏|游戏打完|不打了)/i, /\bi(?:'m| am) done gaming\b/i],
  },
  {
    activityId: 'shower',
    start: [/我(?:现在|正在|在|先去|去|要去|准备去)?(?:洗澡|冲澡)(?:了|呢)?/i, /我(?:现在|正在|在)洗漱(?:呢|中)?(?:[，。！\n]|$)/i, /(?:^|[，。！\n])(?:先去|去)(?:洗澡|冲澡)了/i, /\bi(?:'m| am) (?:taking a shower|showering|washing up)\b/i],
    finish: [/我(?:已经|刚)?(?:洗完澡|洗好澡|洗漱完|冲完澡)了/i, /(?:^|[，。！\n])(?:洗完澡|洗漱完|冲完澡)了/i, /\bi(?:'m| am) done (?:showering|washing up)\b/i],
  },
  {
    activityId: 'rest',
    start: [/我(?:现在|正在|在)?(?:休息|躺着|窝着)(?:呢|了)?/i, /\bi(?:'m| am) (?:resting|lying down)\b/i],
  },
  {
    activityId: 'sleep_prep',
    start: [/我(?:现在|先|要|准备)?(?:睡了|去睡|准备睡|上床睡)(?:呢)?/i, /\bi(?:'m| am) (?:getting ready for bed|going to bed)\b/i],
  },
  {
    activityId: 'sleep',
    start: [/我(?:已经|刚)?睡着了/i, /\bi(?:'m| am) falling asleep\b/i],
    finish: [/我(?:已经|刚)?(?:睡醒|醒来|醒)了/i, /\bi (?:just )?woke up\b/i],
  },
]

export type RuntimeChatDetection =
  | { kind: 'start'; activityId: string }
  | { kind: 'finish'; activityId: string }
  | null

function latestMatchIndex(text: string, patterns: readonly RegExp[] | undefined, rejectFutureCue = false): number {
  let latest = -1
  for (const pattern of patterns ?? []) {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
    const re = new RegExp(pattern.source, flags)
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) != null) {
      if (rejectFutureCue) {
        const prefix = text.slice(Math.max(0, match.index - 10), match.index)
        // “等会儿我去洗澡”只是未来打算，不应提前把首页写成正在洗澡。
        if (/(?:等会儿?|待会儿?|一会儿?|过会儿?|稍后|等下|明天|改天|之后再|晚点)/i.test(prefix)) {
          if (match[0].length === 0) re.lastIndex++
          continue
        }
      }
      latest = Math.max(latest, match.index)
      if (match[0].length === 0) re.lastIndex++
    }
  }
  return latest
}

/** 纯函数：从 TA 最终可见回复里找“此刻正在做/刚做完”的最后一个高置信度动作。 */
export function detectRuntimeChatAction(text: string): RuntimeChatDetection {
  const input = String(text ?? '').trim()
  if (!input) return null
  let best: { index: number; kind: 'start' | 'finish'; activityId: string } | null = null
  for (const signal of CHAT_RUNTIME_SIGNALS) {
    const startIndex = latestMatchIndex(input, signal.start, true)
    if (startIndex >= 0 && (!best || startIndex >= best.index)) best = { index: startIndex, kind: 'start', activityId: signal.activityId }
    const finishIndex = latestMatchIndex(input, signal.finish)
    if (finishIndex >= 0 && (!best || finishIndex >= best.index)) best = { index: finishIndex, kind: 'finish', activityId: signal.activityId }
  }
  return best ? { kind: best.kind, activityId: best.activityId } : null
}

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

let cloudSnapshotResetter: (() => void) | undefined

/** Cloud State resource 层注册快照重置钩子，避免 legacy/V2 静默写入被后续本地事件回传。 */
export function registerTaRuntimeCloudSnapshotResetter(resetter: () => void): void {
  cloudSnapshotResetter = resetter
}

function saveAll(map: Record<string, TaRuntimeState>, silent = false): void {
  try {
    localStorage.setItem(RUNTIME_KEY, JSON.stringify(map))
    if (silent) cloudSnapshotResetter?.()
    else notifyDataChanged()
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
  try {
    return resolveRolePersona(sessionId ?? '', getSessionsCache(), loadPersona())
  } catch {
    return ''
  }
}

/** persona 锚点命中该活动？只用于概率加权，绝不影响 Busy */
function personaHit(a: RuntimeActivity, persona: string): boolean {
  return Boolean(a.persona && persona && a.persona.test(persona))
}

function minuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes()
}

function activityAllowedAt(activity: RuntimeActivity, now: Date): boolean {
  const minute = minuteOfDay(now)
  return activity.windows.some(([start, end]) => minute >= start && minute < end)
}

/** 当前命中时段的结束时间戳；用于把 plannedUntil 截到合理时段内，避免早餐一路挂到中午。 */
function activityWindowEnd(activity: RuntimeActivity, now: Date): number | null {
  const minute = minuteOfDay(now)
  const hit = activity.windows.find(([start, end]) => minute >= start && minute < end)
  if (!hit) return null
  const [, end] = hit
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return dayStart + end * 60000
}

function pickActivity(now: Date, persona: string, recentIds: readonly string[], rand: () => number): RuntimeActivity {
  const slot = runtimeSlot(now)
  let pool = ACTIVITIES.filter((a) => activityAllowedAt(a, now))
  if (pool.length === 0) pool = ACTIVITIES.filter((a) => a.slots.includes(slot))
  if (pool.length === 0) return ACTIVITIES[0] // 理论上不会（表是满的），兜底防死循环

  // 最近 3 个活动能避则避：比只禁「连续重复」多一层，但候选过少时自动退化，不造死循环。
  const blocked = new Set(recentIds.slice(0, 3))
  const rest = pool.filter((a) => !blocked.has(a.id))
  const candidates = rest.length > 0 ? rest : pool
  const weights = candidates.map((a) => 1 + (personaHit(a, persona) ? 2 : 0))
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]
    if (r < 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

function createState(
  activity: RuntimeActivity,
  now: number,
  rand: () => number,
  persona: string,
  recentIds: readonly string[] = [],
): TaRuntimeState {
  const durMin = activity.minMin + Math.floor(rand() * (activity.maxMin - activity.minMin + 1))
  const windowEnd = activityWindowEnd(activity, new Date(now))
  const plannedUntil = Math.min(now + durMin * 60000, windowEnd ?? Number.POSITIVE_INFINITY)
  const recentActivityIds = [activity.id, ...recentIds.filter((id) => id !== activity.id)].slice(0, 3)
  return {
    activityId: activity.id,
    label: activity.label,
    startedAt: now,
    plannedUntil,
    updatedAt: now,
    source: personaHit(activity, persona) ? 'persona' : 'routine',
    recentActivityIds,
  }
}

const CHAT_RUNTIME_MAX_MS = 2 * 60 * 60 * 1000

function createChatState(
  activity: RuntimeActivity,
  now: number,
  recentIds: readonly string[],
): TaRuntimeState {
  const normalMs = activity.maxMin * 60000
  // 聊天动作是“此刻事实”而不是长期日程：一般最多挂 2 小时；睡着例外，允许按睡眠自身上限。
  const ttl = activity.id === 'sleep' ? normalMs : Math.min(normalMs, CHAT_RUNTIME_MAX_MS)
  return {
    activityId: activity.id,
    label: activity.label,
    startedAt: now,
    plannedUntil: now + ttl,
    updatedAt: now,
    source: 'chat',
    recentActivityIds: [activity.id, ...recentIds.filter((id) => id !== activity.id)].slice(0, 3),
  }
}

/**
 * TA 最终回复 → Runtime 写回。
 * - 明确“我去洗澡/正在看书”才覆盖当前状态；
 * - 明确“洗完了/下课了”只结束同一个 chat 状态，然后立刻回到日常调度；
 * - 没命中完全不写；不改聊天、Memory/Event/Space。
 */
export function syncTaRuntimeFromAssistantText(
  sessionId: string | undefined,
  persona: string,
  text: string,
  now: number = Date.now(),
  rand: () => number = Math.random,
): TaRuntimeState | null {
  const detected = detectRuntimeChatAction(text)
  if (!detected) return null
  const key = sessionId || GUEST_KEY
  const map = loadAll()
  const cur = map[key]
  const recentIds = cur && Array.isArray(cur.recentActivityIds) && cur.recentActivityIds.length > 0
    ? cur.recentActivityIds
    : cur?.activityId
      ? [cur.activityId]
      : []

  if (detected.kind === 'start') {
    const activity = ACTIVITIES.find((item) => item.id === detected.activityId)
    if (!activity) return null
    const next = createChatState(activity, now, recentIds)
    map[key] = next
    saveAll(map)
    return next
  }

  // “做完了”只结束聊天明确写进去的同一活动；洗漱完成也可结束“刚起床正在洗漱”。
  const finishMatchesCurrent =
    cur?.activityId === detected.activityId ||
    (detected.activityId === 'shower' && cur?.activityId === 'wake_up')
  if (!cur || cur.source !== 'chat' || !finishMatchesCurrent) return null
  const recentAfterFinish = [cur.activityId, ...recentIds.filter((id) => id !== cur.activityId)].slice(0, 3)
  const next = createState(pickActivity(new Date(now), persona, recentAfterFinish, rand), now, rand, persona, recentAfterFinish)
  map[key] = next
  saveAll(map)
  return next
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
    const fresh = createState(pickActivity(new Date(now), persona, [], rand), now, rand, persona)
    map[key] = fresh
    saveAll(map)
    return fresh
  }
  if (now < cur.plannedUntil) return cur
  const recentIds = Array.isArray(cur.recentActivityIds) && cur.recentActivityIds.length > 0
    ? cur.recentActivityIds
    : [cur.activityId]
  const next = createState(pickActivity(new Date(now), persona, recentIds, rand), now, rand, persona, recentIds)
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
  if (changed) saveAll(map, true)
}

/** Cloud State V2 canonical apply：只覆盖指定 session，不参与 legacy updatedAt 合并。 */
export function applyTaRuntimeFromCloud(sessionId: string, state: TaRuntimeState): void {
  if (!sessionId || sessionId === GUEST_KEY || !isTaRuntimeState(state)) return
  const map = loadAll()
  map[sessionId] = state
  saveAll(map, true)
}

/** Cloud State V2 canonical tombstone：只删除指定 session。 */
export function deleteTaRuntimeFromCloud(sessionId: string): void {
  if (!sessionId || sessionId === GUEST_KEY) return
  const map = loadAll()
  if (!(sessionId in map)) {
    cloudSnapshotResetter?.()
    return
  }
  delete map[sessionId]
  saveAll(map, true)
}

/** 单条 Runtime payload 的严格边界校验，供 Cloud State adapter 防御 malformed entity。 */
export function isTaRuntimeState(value: unknown): value is TaRuntimeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as Partial<TaRuntimeState>
  return typeof state.activityId === 'string' && state.activityId.length > 0
    && typeof state.label === 'string'
    && typeof state.startedAt === 'number' && Number.isFinite(state.startedAt)
    && typeof state.plannedUntil === 'number' && Number.isFinite(state.plannedUntil)
    && typeof state.updatedAt === 'number' && Number.isFinite(state.updatedAt)
    && (state.source === 'routine' || state.source === 'persona' || state.source === 'chat')
    && (state.recentActivityIds == null || (
      Array.isArray(state.recentActivityIds)
      && state.recentActivityIds.length <= 3
      && state.recentActivityIds.every((id) => typeof id === 'string' && id.length > 0)
    ))
}

/** HH:mm（24 小时制） */
export function formatRuntimeUntil(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 英文兜底文案：activityId 不在活动池时防御用（绝不能 fallback 成中文，保证 en 上下文无中文） */
const EN_FALLBACK_LABEL = 'Doing their own thing'

/**
 * 展示层按语言取 label（PATCH-LANG）：
 * - zh：返回持久化的中文 label（行为不变）；
 * - en：按 activityId 映射活动池的 labelEn——已持久化的老数据 label 是中文，
 *   靠 id 映射英文文案，绝不因本地化重抽/失效 Runtime（labelEn 只影响展示，不参与 identity）。
 */
export function runtimeDisplayLabel(runtime: TaRuntimeState | null | undefined, lang: Lang = 'zh'): string {
  if (!runtime) return ''
  if (lang !== 'en') return runtime.label || ''
  const act = ACTIVITIES.find((a) => a.id === runtime.activityId)
  return act?.labelEn || EN_FALLBACK_LABEL
}

/**
 * Chat 注入文案：明确告诉模型这是 TA 自己当前的生活状态，
 * 不是对方告诉的事实、不是 Memory/Event/Anniversary/共同经历，禁止据此编「我们之前一起…」。
 * PATCH-LANG：en 时 label 用英文映射（整块纯英文），zh 用持久化中文 label。
 */
export function buildTaRuntimeContext(runtime: TaRuntimeState | null, lang: Lang = 'zh'): string {
  if (!runtime || !runtime.label) return ''
  const until = formatRuntimeUntil(runtime.plannedUntil)
  if (lang === 'en') {
    return [
      '[What you are doing right now]',
      "This is your own current life state — not something the other person told you, not a shared memory or event, and not the other person\u2019s activity.",
      'Never restate it as what the other person is doing:',
      `${runtimeDisplayLabel(runtime, 'en')}, probably until around ${until}.`,
    ].join('\n')
  }
  return [
    '【你自己此刻在做什么】',
    '下面是你（TA）自己当前的生活状态，不是对方告诉你的，也不是你们共同的经历——更不是在说对方，绝不要把这件事写成对方在做：',
    `${runtime.label}，预计会持续到 ${until} 左右。`,
  ].join('\n')
}
