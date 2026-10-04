// TA Runtime · truth-driven continuity state
// Home 与 Chat 读同一份持久状态；只有 TA 最终可见回复里的明确自述/原话能创建状态。
// 无证据、旧随机状态或过期当前态统一回 idle。零额外 LLM、无后台轮询。
//
// ★产品边界：Runtime ≠ Busy。Runtime 持有「TA 当前态 + 可追溯的连续性线索」；Busy 只回答「TA 此刻是否暂时无法陪伴」。
// 本文件绝不读写 Busy（不 import aiBusy / 不写 ai_companion_busy_*），普通生活活动绝不触发 Busy。
// 也绝不写 Memory / Event / Anniversary / FutureIntent / Space Life；这些对象只允许被其它层读取，绝不能由 Runtime 反向生成。
//
// 存储：单一 key ai_companion_ta_runtime（Record<sid, TaRuntimeState>），只经本文件读写，组件禁止直连。

import { getSessionsCache } from './sessionStore.ts'
import { resolveRolePersona } from './sessionProfile.ts'
import { loadPersona } from './storage.ts'
import type { Lang } from './langDetect.ts'
import { formatAttributedLine } from './promptAttribution.ts'
import { notifyDataChanged } from './dataChange.ts'
import { resolveIdentityMode, type IdentityMode } from './companionPolicy.ts'

export type TaContinuityKind = 'open-question' | 'self-intent'

export interface TaContinuityEvidence {
  /** 只允许来自 TA 最终可见回复；不做模型摘要，原句轻清洗后直接保存。 */
  kind: TaContinuityKind
  text: string
  evidenceAt: number
  expiresAt: number
}

export interface TaContinuityState {
  /** TA 最后一条尚未等到下一轮用户输入的真实问题。 */
  openThread?: TaContinuityEvidence
  /** TA 明确说过“下次/之后还想继续”的真实后续意图。 */
  selfIntent?: TaContinuityEvidence
}

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
  /** 来源：legacy routine/persona 仅兼容旧数据；新状态只由 chat 证据或 idle 产生。 */
  source: 'routine' | 'persona' | 'chat' | 'idle'
  /** 最近活动（最新在前，含当前，最多 3 个）；旧数据可缺省 */
  recentActivityIds?: string[]
  /** Home「TA 此刻」优先展示的角色原话精简版；只来自已通过当前态判定的同一条 TA 最终回复。 */
  displayText?: string
  /** displayText 的原始语言；切换语言时不硬显示旧语言，回落 activity 映射。 */
  displayLang?: Lang
  /** 连续性线索与当前活动共用同一 Runtime 实体；字段可缺省，旧数据零迁移。 */
  continuity?: TaContinuityState
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
  { id: 'reading_chat', label: '正在读你们的对话', labelEn: 'Reading your conversation', slots: ['凌晨', '早晨', '白天', '傍晚', '夜晚'], windows: [[0, 1440]], minMin: 20, maxMin: 60 },
  { id: 'organizing_thoughts', label: '正在整理思绪', labelEn: 'Organizing thoughts', slots: ['凌晨', '早晨', '白天', '傍晚', '夜晚'], windows: [[0, 1440]], minMin: 30, maxMin: 90 },
  { id: 'following_thread', label: '正在回想你们聊过的话', labelEn: 'Following the thread of your conversation', slots: ['凌晨', '早晨', '白天', '傍晚', '夜晚'], windows: [[0, 1440]], minMin: 30, maxMin: 80 },
  { id: 'quietly_present', label: '正在安静陪着你', labelEn: 'Quietly staying present', slots: ['凌晨', '早晨', '白天', '傍晚', '夜晚'], windows: [[0, 1440]], minMin: 30, maxMin: 120 },
]

const AI_NATIVE_ACTIVITY_IDS = new Set(['reading_chat', 'organizing_thoughts', 'following_thread', 'quietly_present'])
export const TA_RUNTIME_IDLE_ID = 'idle'

function activityAllowedForMode(activity: RuntimeActivity, mode: IdentityMode): boolean {
  return mode === 'immersive' ? !AI_NATIVE_ACTIVITY_IDS.has(activity.id) : AI_NATIVE_ACTIVITY_IDS.has(activity.id)
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

/** idle 不是一条“活动事实”，只是展示层的无当前活动状态；连续性 evidence 可独立保留。 */
function createIdleState(
  now: number,
  recentIds: readonly string[] = [],
  continuity?: TaContinuityState | null,
): TaRuntimeState {
  const prunedContinuity = pruneTaContinuity(continuity, now)
  return {
    activityId: TA_RUNTIME_IDLE_ID,
    label: '',
    startedAt: now,
    plannedUntil: 0,
    updatedAt: now,
    source: 'idle',
    recentActivityIds: recentIds.filter((id) => id && id !== TA_RUNTIME_IDLE_ID).slice(0, 3),
    ...(prunedContinuity ? { continuity: prunedContinuity } : {}),
  }
}

export function isTaRuntimeIdle(runtime: TaRuntimeState | null | undefined): boolean {
  return !runtime || runtime.activityId === TA_RUNTIME_IDLE_ID
}

/**
 * Truth-driven Runtime getter:
 * - 没有可信状态 → idle；绝不按时段/persona 随机编一个活动；
 * - 只有 Chat 明确自述写入的 source='chat' 状态，在过期前保持不变；
 * - 过期、切身份后不再允许、或旧版 routine/persona 自动状态 → 回 idle；
 * - idle 一直保持，直到新的 TA 自述证据写入。
 *
 * persona/rand 参数保留只为兼容旧调用签名；不再参与状态创造。
 */
export function getOrAdvanceTaRuntime(
  sessionId: string | undefined,
  _persona: string,
  now: number,
  _rand?: () => number,
): TaRuntimeState {
  const map = loadAll()
  const key = sessionId || GUEST_KEY
  const cur = map[key]
  const mode = resolveIdentityMode(sessionId)

  if (!cur || typeof cur.activityId !== 'string') {
    const idle = createIdleState(now)
    map[key] = idle
    saveAll(map)
    return idle
  }

  if (cur.activityId === TA_RUNTIME_IDLE_ID) {
    const continuity = pruneTaContinuity(cur.continuity, now)
    return continuityEqual(cur.continuity, continuity)
      ? cur
      : { ...cur, ...(continuity ? { continuity } : { continuity: undefined }) }
  }

  const currentActivity = ACTIVITIES.find((item) => item.id === cur.activityId)
  const trusted = cur.source === 'chat'
  if (
    trusted &&
    currentActivity &&
    activityAllowedForMode(currentActivity, mode) &&
    now < cur.plannedUntil
  ) {
    return cur
  }

  const recentIds = Array.isArray(cur.recentActivityIds) && cur.recentActivityIds.length > 0
    ? cur.recentActivityIds
    : [cur.activityId]
  const idle = createIdleState(now, recentIds, cur.continuity)
  map[key] = idle
  saveAll(map)
  return idle
}


/* ---- Chat → Runtime 一致性（v7 #7） ----
 * 只认 TA 回复里明确、正在发生/马上发生的自我动作；纯本地正则，不调 LLM。
 * 目标：TA 说“我去洗澡了”后 Home 立刻能显示对应活动；说“洗完了”后不再继续挂“正在洗漱”。
 * 不把未来计划（“晚点/明天再…”）、对方动作（“你去…”）或泛泛提及写成当前状态。
 */

export type RuntimeTextDecision =
  | { type: 'start'; activityId: string }
  | { type: 'finish' }
  | null

const CHAT_OVERRIDE_MAX_MS = 2 * 60 * 60 * 1000

const ZH_FUTURE_RE = /(?:等会|待会|一会儿|一会|晚点|过会|过一会|等下|稍后|明天|改天|以后|之后|回头再)/
const EN_FUTURE_RE = /\b(?:later|tomorrow|in a bit|in a while|afterwards?|sometime)\b/i
const ZH_NEGATIVE_RE = /(?:不去|不在|不想|不准备|没在|没有在|别|不用)/
const EN_NEGATIVE_RE = /\b(?:not|don't|do not|won't|will not|not going to)\b/i

interface RuntimeTextRule {
  activityId: string
  zh: RegExp
  en: RegExp
}

/** 规则从更具体到更泛化；同一条回复里若出现多个“现在动作”，取最后命中的那一个。 */
const RUNTIME_TEXT_START_RULES: readonly RuntimeTextRule[] = [
  { activityId: 'reading_chat', zh: /(?:我)?(?:正(?:在)?|还在|在|刚(?:刚)?)?(?:回看|重看|读|看)(?:着)?(?:我们|你们)?(?:的)?(?:对话|聊天(?:记录)?)/, en: /\b(?:i(?:'m| am)?\s+)?(?:am\s+)?(?:reading|rereading|reviewing|looking back at) (?:our|this|the) (?:conversation|chat)\b/i },
  { activityId: 'organizing_thoughts', zh: /(?:我)?(?:正(?:在)?|还在|在|刚(?:刚)?)?(?:整理|理一理|梳理)(?:一下)?(?:思路|思绪|想法|刚才的问题)/, en: /\b(?:i(?:'m| am)?\s+)?(?:organizing|sorting through|整理ing) (?:my )?(?:thoughts|ideas)\b/i },
  { activityId: 'following_thread', zh: /(?:我)?(?:正(?:在)?|还在|在|刚(?:刚)?)?(?:回想|顺着|梳理)(?:我们|你们)?(?:刚才|之前)?(?:聊过的话|说过的话|聊天脉络|对话脉络)/, en: /\b(?:i(?:'m| am)?\s+)?(?:following|tracing|thinking back through) (?:the )?(?:thread|conversation)\b/i },
  { activityId: 'quietly_present', zh: /(?:我)?(?:正(?:在)?|还在|在)?(?:安静地?)?(?:陪着你|在这里陪你|待在这里陪你)/, en: /\b(?:i(?:'m| am)?\s+)?(?:quietly )?(?:staying here with you|keeping you company|here with you)\b/i },
  { activityId: 'wake_up', zh: /(?:我)?(?:刚|才)?(?:起床|醒了|醒来)/, en: /\b(?:i\s*)?(?:just\s+)?(?:woke up|got up)\b/i },
  { activityId: 'breakfast', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:吃早餐|吃早饭)/, en: /\b(?:i(?:'m| am)?\s+)?(?:having|getting|going to have) breakfast\b/i },
  { activityId: 'lunch', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:吃午饭|吃午餐)/, en: /\b(?:i(?:'m| am)?\s+)?(?:having|getting|going to have) lunch\b/i },
  { activityId: 'dinner', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:吃晚饭|吃晚餐)/, en: /\b(?:i(?:'m| am)?\s+)?(?:having|getting|going to have) dinner\b/i },
  { activityId: 'shower', zh: /(?:我)?(?:正(?:在)?|在|去|先去|这就去|准备去?|要去)?(?:洗澡|冲澡|洗漱)/, en: /\b(?:i(?:'m| am)?\s+)?(?:(?:am\s+)?showering|taking a shower|going to (?:take a )?shower|washing up)\b/i },
  { activityId: 'reading', zh: /(?:我)?(?:正(?:在)?|在|去|先|准备)?(?:看书|读书|看小说|读小说|阅读|翻书)/, en: /\b(?:i(?:'m| am)?\s+)?(?:reading|going to read|reading a book)\b/i },
  { activityId: 'cooking', zh: /(?:我)?(?:正(?:在)?|在|去|先|准备)?(?:做饭|下厨|煮饭|炒菜|烘焙|做早餐|做午饭|做晚饭)/, en: /\b(?:i(?:'m| am)?\s+)?(?:cooking|making (?:breakfast|lunch|dinner)|going to cook)\b/i },
  { activityId: 'coffee', zh: /(?:我)?(?:正(?:在)?|在|去|先|准备)?(?:喝咖啡|喝茶|喝奶茶)/, en: /\b(?:i(?:'m| am)?\s+)?(?:having|drinking|getting) (?:a )?(?:coffee|tea)\b/i },
  { activityId: 'walk', zh: /(?:我)?(?:正(?:在)?|在|去|先去|出去|准备)?(?:散步|遛狗|走走|走一圈|逛一圈)/, en: /\b(?:i(?:'m| am)?\s+)?(?:walking|going for a walk|taking a walk|walking the dog)\b/i },
  { activityId: 'exercise', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:运动|健身|跑步|游泳|瑜伽|打球)/, en: /\b(?:i(?:'m| am)?\s+)?(?:working out|exercising|running|swimming|doing yoga|going to the gym)\b/i },
  { activityId: 'movie', zh: /(?:我)?(?:正(?:在)?|在|去|先|准备)?(?:看电影|看剧|追剧|看动漫)/, en: /\b(?:i(?:'m| am)?\s+)?(?:watching|going to watch) (?:a )?(?:movie|film|show|series|anime)\b/i },
  { activityId: 'gaming', zh: /(?:我)?(?:正(?:在)?|在|去|先|准备)?(?:打游戏|玩游戏|开黑|打排位)/, en: /\b(?:i(?:'m| am)?\s+)?(?:gaming|playing (?:a )?game|playing games|going to play)\b/i },
  { activityId: 'class', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:上课|听课|在课上|课上)/, en: /\b(?:i(?:'m| am)?\s+)?(?:in class|going to class|attending class)\b/i },
  { activityId: 'work', zh: /(?:我)?(?:已经|刚|刚刚|才)?(?:到公司|到单位|到办公室|到工位|到岗)(?:了)?/, en: /\b(?:i\s+)?(?:just\s+)?(?:got to work|arrived at (?:work|the office)|made it to (?:work|the office))\b/i },
  { activityId: 'commute', zh: /(?:我)?(?:正(?:在)?|在|去|先去|准备)?(?:通勤|去上班|去公司|回公司|上班路上)/, en: /\b(?:i(?:'m| am)?\s+)?(?:commuting|on my way to work|going to work|heading to work)\b/i },
  { activityId: 'work', zh: /(?:忙(?:着)?工作|处理工作|赶工作|工作中|开始工作|继续工作|加班|开会)/, en: /\b(?:working|at work|in a meeting)\b/i },
  { activityId: 'errand', zh: /(?:我)?(?:正(?:在)?|在|去|先去|出去|准备)?(?:办事|办点事|买东西|取快递)/, en: /\b(?:i(?:'m| am)?\s+)?(?:running errands?|going out for errands?|picking up a package)\b/i },
  { activityId: 'home', zh: /(?:我)?(?:刚|才)?(?:到家|回到家|回家了)/, en: /\b(?:i(?:'m| am)?\s+)?(?:just got home|back home|home now)\b/i },
  { activityId: 'rest', zh: /(?:我)?(?:正(?:在)?|在|先|准备)?(?:休息|歇会|歇一会|躺会|躺一会)/, en: /\b(?:i(?:'m| am)?\s+)?(?:resting|taking a break|lying down)\b/i },
  { activityId: 'sleep_prep', zh: /(?:我)?(?:准备睡|要睡了|去睡了|先睡了|睡觉去了|上床睡)/, en: /\b(?:i(?:'m| am)?\s+)?(?:going to bed|getting ready for bed|going to sleep|heading to bed)\b/i },
]

const FINISH_PATTERNS: Readonly<Record<string, RegExp>> = {
  shower: /(?:洗完(?:澡|漱)?|冲完澡|洗好了|洗完了|洗好了澡)/,
  reading: /(?:看完书|书看完|读完书|读完了|看完了)/,
  movie: /(?:看完电影|电影看完|剧看完|看完了)/,
  gaming: /(?:游戏打完|打完游戏|这局打完|下线了|不玩了)/,
  exercise: /(?:运动完|健身完|跑完(?:步)?|游完(?:泳)?|练完了)/,
  walk: /(?:散步回来|走回来了|逛完了|回来了)/,
  cooking: /(?:饭做好|做好饭|做完饭|做完了)/,
  breakfast: /(?:吃完(?:早餐|早饭)?|吃好了|吃饱了)/,
  lunch: /(?:吃完(?:午饭|午餐)?|吃好了|吃饱了)/,
  dinner: /(?:吃完(?:晚饭|晚餐)?|吃好了|吃饱了)/,
  coffee: /(?:喝完(?:咖啡|茶|奶茶)?|喝完了)/,
  work: /(?:忙完了|工作做完|下班了|会开完了|开完会)/,
  class: /(?:下课了|课上完了)/,
  commute: /(?:到了|到公司了|到家了)/,
  errand: /(?:办完了|买完了|取完了|事情办完)/,
  rest: /(?:休息好了|歇够了|起来了)/,
  sleep_prep: /(?:不睡了|先不睡了)/,
}

const FINISH_PATTERNS_EN: Readonly<Record<string, RegExp>> = {
  shower: /\b(?:finished showering|done showering|out of the shower)\b/i,
  reading: /\b(?:finished reading|done reading)\b/i,
  movie: /\b(?:finished the movie|movie is over|done watching)\b/i,
  gaming: /\b(?:done gaming|finished playing|logged off)\b/i,
  exercise: /\b(?:finished (?:working out|exercising|running|swimming)|done working out)\b/i,
  walk: /\b(?:back from (?:my )?walk|done walking)\b/i,
  cooking: /\b(?:finished cooking|done cooking|food is ready)\b/i,
  breakfast: /\b(?:finished breakfast|done eating breakfast)\b/i,
  lunch: /\b(?:finished lunch|done eating lunch)\b/i,
  dinner: /\b(?:finished dinner|done eating dinner)\b/i,
  coffee: /\b(?:finished my coffee|done with my coffee|finished my tea)\b/i,
  work: /\b(?:done with work|finished work|off work|meeting is over)\b/i,
  class: /\b(?:class is over|done with class)\b/i,
  commute: /\b(?:arrived|made it home|got to work)\b/i,
  errand: /\b(?:finished my errands?|done with errands?)\b/i,
  rest: /\b(?:done resting|finished my break)\b/i,
  sleep_prep: /\b(?:not sleeping yet|staying up)\b/i,
}

function textClauses(text: string): string[] {
  return String(text ?? '')
    .split(/[。！？!?\n，,；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export const TA_OPEN_THREAD_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const TA_SELF_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CONTINUITY_EVIDENCE_MAX_CHARS = 180

function evidenceSentences(text: string): string[] {
  return (String(text ?? '').replace(/\r/g, '').match(/[^。！？!?\n]+[。！？!?]?/g) ?? [])
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function compactContinuityEvidence(text: string): string {
  const cleaned = String(text ?? '')
    .replace(/^[-—–•·\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  const chars = Array.from(cleaned)
  return chars.length > CONTINUITY_EVIDENCE_MAX_CHARS
    ? `${chars.slice(0, CONTINUITY_EVIDENCE_MAX_CHARS).join('')}…`
    : cleaned
}

const ZH_SERVICE_QUESTION_RE = /(?:还有什么|有什么)(?:问题|需要|想问)|还有什么我(?:能|可以)?(?:帮|做)|(?:还|有)?需要我(?:帮|做)|我还能(?:帮|为你)|要不要我(?:帮|替你)|还有别的(?:问题|需要)|需要(?:帮忙|帮助)吗/
const EN_SERVICE_QUESTION_RE = /\b(?:anything else|any questions?|need (?:any )?help|anything i can (?:help|do)|how can i help|want me to help)\b/i

function detectOpenQuestionEvidence(text: string, now: number): TaContinuityEvidence | undefined {
  let evidence = ''
  for (const sentence of evidenceSentences(text)) {
    if (!/[？?]$/.test(sentence)) continue
    if (ZH_SERVICE_QUESTION_RE.test(sentence) || EN_SERVICE_QUESTION_RE.test(sentence)) continue
    const compact = compactContinuityEvidence(sentence)
    if (compact.length < 2) continue
    evidence = compact
  }
  return evidence
    ? {
        kind: 'open-question',
        text: evidence,
        evidenceAt: now,
        expiresAt: now + TA_OPEN_THREAD_TTL_MS,
      }
    : undefined
}

const ZH_SELF_INTENT_PATTERNS: readonly RegExp[] = [
  /(?:下次|下回|改天|回头|之后|以后|晚点|等会|待会|过会|过一会|有机会).{0,16}(?:我|我们|咱们).{0,18}(?:还|也)?(?:想|想要|会|要)?(?:再|继续|接着).{0,18}(?:聊|问|听|说|讲)/,
  /(?:我|我们|咱们).{0,16}(?:下次|下回|改天|回头|之后|以后|晚点|等会|待会|过会|过一会|有机会).{0,18}(?:还|也)?(?:想|想要|会|要)?(?:再|继续|接着).{0,18}(?:聊|问|听|说|讲)/,
  /(?:我|我们|咱们)(?:还|也)?(?:想|想要).{0,10}(?:下次|下回|之后|以后|回头|改天|有机会).{0,20}(?:再|继续|接着).{0,18}(?:聊|问|听|说|讲)/,
]

const EN_SELF_INTENT_PATTERNS: readonly RegExp[] = [
  /\b(?:next time|another time|later|sometime|when we talk again)\b.{0,80}\b(?:i(?:'d| would)? like to|i want to|i(?:'ll| will)|we(?:'ll| will)|let's)\b.{0,60}\b(?:continue|keep|pick (?:this|it) up|ask|hear|talk|come back)\b/i,
  /\b(?:i(?:'d| would)? like to|i want to|i(?:'ll| will)|we(?:'ll| will)|let's)\b.{0,50}\b(?:next time|another time|later|sometime|when we talk again)\b.{0,60}\b(?:continue|keep|pick (?:this|it) up|ask|hear|talk|come back)\b/i,
]

function detectSelfIntentEvidence(text: string, now: number): TaContinuityEvidence | undefined {
  let evidence = ''
  for (const sentence of evidenceSentences(text)) {
    if (
      !ZH_SELF_INTENT_PATTERNS.some((pattern) => pattern.test(sentence))
      && !EN_SELF_INTENT_PATTERNS.some((pattern) => pattern.test(sentence))
    ) continue
    const compact = compactContinuityEvidence(sentence)
    if (compact) evidence = compact
  }
  return evidence
    ? {
        kind: 'self-intent',
        text: evidence,
        evidenceAt: now,
        expiresAt: now + TA_SELF_INTENT_TTL_MS,
      }
    : undefined
}

export function pruneTaContinuity(
  continuity: TaContinuityState | null | undefined,
  now: number = Date.now(),
): TaContinuityState | undefined {
  if (!continuity) return undefined
  const openThread = continuity.openThread && continuity.openThread.expiresAt > now
    ? continuity.openThread
    : undefined
  const selfIntent = continuity.selfIntent && continuity.selfIntent.expiresAt > now
    ? continuity.selfIntent
    : undefined
  return openThread || selfIntent
    ? {
        ...(openThread ? { openThread } : {}),
        ...(selfIntent ? { selfIntent } : {}),
      }
    : undefined
}

/**
 * 只从 TA 本轮最终可见回复提取连续性 evidence。
 * openThread 每个正常 USER→TA 回合都会重新结算：本轮没新问题就清掉上一轮问题；
 * selfIntent 只有 TA 明确说“之后/下次还想继续”才更新，否则沿用到 TTL。
 */
export function detectTaContinuityFromAssistantText(
  text: string,
  now: number = Date.now(),
  previous?: TaContinuityState | null,
): TaContinuityState | undefined {
  const prior = pruneTaContinuity(previous, now)
  const openThread = detectOpenQuestionEvidence(text, now)
  const selfIntent = detectSelfIntentEvidence(text, now) ?? prior?.selfIntent
  return openThread || selfIntent
    ? {
        ...(openThread ? { openThread } : {}),
        ...(selfIntent ? { selfIntent } : {}),
      }
    : undefined
}

function continuityEqual(
  left: TaContinuityState | null | undefined,
  right: TaContinuityState | null | undefined,
): boolean {
  const a = pruneTaContinuity(left, Number.NEGATIVE_INFINITY)
  const b = pruneTaContinuity(right, Number.NEGATIVE_INFINITY)
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function getTaContinuity(
  sessionId?: string,
  now: number = Date.now(),
): TaContinuityState | null {
  const continuity = pruneTaContinuity(getTaRuntime(sessionId)?.continuity, now)
  return continuity ?? null
}

function isClearlyOtherPersonClause(clause: string): boolean {
  const t = clause.trim()
  return /^(?:你|对方|他|她)(?![A-Za-z0-9_])/i.test(t) || /^TA\b/i.test(t) || /^(?:you|they|he|she)\b/i.test(t)
}

function blockedAsFutureOrNegative(clause: string): boolean {
  return ZH_FUTURE_RE.test(clause) || EN_FUTURE_RE.test(clause) || ZH_NEGATIVE_RE.test(clause) || EN_NEGATIVE_RE.test(clause)
}

/** “快喝完了 / 马上下课了 / 还没忙完”是进行中，不是完成事实，不能触发 finish 后重抽。 */
function looksNotFinishedYet(clause: string): boolean {
  const t = clause.trim()
  return /(?:快|快要|马上|就要|差不多(?:要)?|还没|尚未|没有|没).{0,8}(?:完|结束|下课|下班|回来)/.test(t)
    || /\b(?:almost|about to|not yet|haven't|hasn't|still not)\b/i.test(t)
}

const ZH_SELF_CURRENT_GRAMMAR_RE = /^我(?:现在|正(?:在)?|还在|在|去|先去?|这就|准备(?:去)?|要去?|刚(?:刚|在)?|开始|继续)/
const ZH_OMITTED_CURRENT_GRAMMAR_RE = /^(?:现在|正(?:在)?|还在|在|先去?|这就|准备(?:去)?|要去?|刚(?:刚|在)?|开始|继续)/
const EN_SELF_CURRENT_GRAMMAR_RE = /\b(?:i'm|i am|i’ll|i'll|i will|i'm going to|i am going to|let me|i just|i've just|i have just)\b/i

function currentActionGrammar(clause: string): { index: number; actionIndex: number; lang: Lang } | null {
  const t = clause.trim()
  if (!t) return null

  const zhSelf = ZH_SELF_CURRENT_GRAMMAR_RE.exec(t)
  if (zhSelf) {
    return { index: 0, actionIndex: zhSelf[0].length, lang: 'zh' }
  }

  const zhOmitted = ZH_OMITTED_CURRENT_GRAMMAR_RE.exec(t)
  if (zhOmitted) {
    return { index: 0, actionIndex: zhOmitted[0].length, lang: 'zh' }
  }

  const en = EN_SELF_CURRENT_GRAMMAR_RE.exec(t)
  if (!en || en.index < 0) return null
  return {
    index: en.index,
    actionIndex: en.index + en[0].length,
    lang: 'en',
  }
}

function currentActionGrammarIndex(clause: string): number {
  return currentActionGrammar(clause)?.index ?? -1
}

function explicitSelfCurrentClause(clause: string): boolean {
  const t = clause.trim()
  if (!t) return false
  if (currentActionGrammarIndex(t) >= 0) return true
  // 很短的口语自述：“洗澡去了”“看书呢”，避免把“看书这件事…”之类泛提及当当前状态。
  return t.length <= 16 && /(?:去了|中|呢|着呢|一会儿?|一下|了)$/.test(t)
}

function compactRuntimeDisplayText(clause: string, lang: Lang): string {
  let t = String(clause ?? '').trim().replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '')
  if (!t) return ''

  if (lang === 'zh') {
    // Home 标题已经是「TA 此刻」，这里只保留 TA 自己说的动作核心，去掉“我/现在/正在”等壳。
    t = t.replace(/^(?:好|嗯|行|那|诶|哎)[，,\s]*/u, '')
    t = t.replace(/^我(?:现在)?(?:正(?:在)?|还在|在)?/u, '')
    t = t.replace(/^(?:现在|正(?:在)?|还在|在)/u, '')
    t = t.trim()
    if (!t) return ''
    const chars = Array.from(t)
    return chars.length > 24 ? `${chars.slice(0, 24).join('')}…` : t
  }

  t = t.replace(/^(?:okay|ok|well|yeah|yep|sure)[,.:;\s-]*/i, '')
  t = t.replace(/^(?:i['’]?m|i am)\s+/i, '')
  t = t.replace(/^i\s+(?:just\s+)?/i, '')
  t = t.trim()
  if (!t) return ''
  return t.length > 64 ? `${t.slice(0, 64).trimEnd()}…` : t
}

interface RuntimeClauseStartMatch {
  activityId: string
  lang: Lang
  index: number
  ruleIndex: number
}

/**
 * 在单个 clause 内统一选择“活动 + 语言”：
 * - 先比较所有活动规则真正命中的起始位置，主句语法通常最靠前；
 * - 同位置时沿用规则表“更具体在前”的优先级；
 * - 书名/歌名/对象里的另一种语言即使命中，也不会盖过主句动作。
 */
function pickRuntimeStartMatchForClause(clause: string): RuntimeClauseStartMatch | null {
  const grammar = currentActionGrammar(clause)
  if (grammar) {
    const rawActionText = clause.slice(grammar.actionIndex)
    const leadingSpace = rawActionText.length - rawActionText.trimStart().length
    const actionText = rawActionText.trimStart()

    for (let ruleIndex = 0; ruleIndex < RUNTIME_TEXT_START_RULES.length; ruleIndex += 1) {
      const rule = RUNTIME_TEXT_START_RULES[ruleIndex]
      const pattern = grammar.lang === 'zh' ? rule.zh : rule.en
      const index = actionText.search(pattern)
      if (index !== 0) continue
      return {
        activityId: rule.activityId,
        lang: grammar.lang,
        index: grammar.actionIndex + leadingSpace,
        ruleIndex,
      }
    }
    return null
  }

  let best: RuntimeClauseStartMatch | null = null
  RUNTIME_TEXT_START_RULES.forEach((rule, ruleIndex) => {
    const candidates: Array<{ lang: Lang; index: number }> = [
      { lang: 'zh', index: clause.search(rule.zh) },
      { lang: 'en', index: clause.search(rule.en) },
    ]
    for (const item of candidates) {
      if (item.index < 0) continue
      if (
        best == null
        || item.index < best.index
        || (item.index === best.index && ruleIndex < best.ruleIndex)
      ) {
        best = {
          activityId: rule.activityId,
          lang: item.lang,
          index: item.index,
          ruleIndex,
        }
      }
    }
  })
  return best
}

function findRuntimeDisplayCandidate(
  text: string,
  activityId: string,
): { text: string; lang: Lang } | null {
  let candidate: { text: string; lang: Lang } | null = null
  for (const clause of textClauses(text)) {
    if (isClearlyOtherPersonClause(clause) || blockedAsFutureOrNegative(clause) || !explicitSelfCurrentClause(clause)) continue
    const match = pickRuntimeStartMatchForClause(clause)
    if (!match || match.activityId !== activityId) continue
    const grammarIndex = currentActionGrammarIndex(clause)
    const displaySource = grammarIndex >= 0 ? clause.slice(grammarIndex) : clause
    const display = compactRuntimeDisplayText(displaySource, match.lang)
    if (display) candidate = { text: display, lang: match.lang }
  }
  return candidate
}

/** 纯判定：只根据 TA 最终可见回复 + 当前 Runtime 判断是否需要写回。 */
export function detectTaRuntimeDecision(text: string, currentActivityId?: string): RuntimeTextDecision {
  const clauses = textClauses(text)
  let startDecision: RuntimeTextDecision = null

  for (const clause of clauses) {
    if (isClearlyOtherPersonClause(clause) || blockedAsFutureOrNegative(clause) || !explicitSelfCurrentClause(clause)) continue
    const match = pickRuntimeStartMatchForClause(clause)
    if (match) startDecision = { type: 'start', activityId: match.activityId }
  }
  if (startDecision) return startDecision

  if (currentActivityId) {
    for (const clause of clauses) {
      if (isClearlyOtherPersonClause(clause) || /(?:吗|嘛|么|没|没有)$/.test(clause.trim())) continue
      if (looksNotFinishedYet(clause)) continue
      const zh = FINISH_PATTERNS[currentActivityId]
      const en = FINISH_PATTERNS_EN[currentActivityId]
      if ((zh && zh.test(clause)) || (en && en.test(clause))) return { type: 'finish' }
    }
  }
  return null
}

function withContinuity(
  state: TaRuntimeState,
  continuity?: TaContinuityState | null,
): TaRuntimeState {
  const { continuity: _previous, ...base } = state
  return continuity ? { ...base, continuity } : base
}

function createChatOverrideState(
  activity: RuntimeActivity,
  now: number,
  recentIds: readonly string[],
  display: { text: string; lang: Lang } | null,
  continuity?: TaContinuityState | null,
): TaRuntimeState {
  const maxMinutes = Math.max(activity.minMin, Math.min(activity.maxMin, CHAT_OVERRIDE_MAX_MS / 60000))
  const recentActivityIds = [activity.id, ...recentIds.filter((id) => id !== activity.id)].slice(0, 3)
  return withContinuity({
    activityId: activity.id,
    label: activity.label,
    startedAt: now,
    plannedUntil: now + maxMinutes * 60000,
    updatedAt: now,
    source: 'chat',
    recentActivityIds,
    ...(display ? { displayText: display.text, displayLang: display.lang } : {}),
  }, continuity)
}

/**
 * TA 最终回复落库后调用：
 * - 明确说自己“正在/马上去做 X” → X 写回同一 Runtime；
 * - 明确说当前 X 已结束 → 当前活动立即回 idle；
 * - 最终回复留下真实问题 / 明确说以后还想继续 → 同一 Runtime 写 continuity evidence；
 * - 当前活动最长 2 小时；连续性线索各自按 TTL 失效，互不把对方变成“已发生事实”。
 * 返回 null = 本轮活动与连续性都没有变化。
 */
export function syncTaRuntimeFromAssistantText(
  sessionId: string | undefined,
  text: string,
  now: number = Date.now(),
  _persona: string = getSessionPersona(sessionId),
  _rand?: () => number,
): TaRuntimeState | null {
  const key = sessionId || GUEST_KEY
  const map = loadAll()
  const cur = map[key]
  const nextContinuity = detectTaContinuityFromAssistantText(text, now, cur?.continuity)
  const continuityChanged = !continuityEqual(cur?.continuity, nextContinuity)
  const decision = detectTaRuntimeDecision(text, cur?.activityId)

  const recentIds = Array.isArray(cur?.recentActivityIds) && cur.recentActivityIds.length > 0
    ? cur.recentActivityIds
    : cur?.activityId && cur.activityId !== TA_RUNTIME_IDLE_ID
      ? [cur.activityId]
      : []

  if (decision?.type === 'start') {
    const activity = ACTIVITIES.find((item) => item.id === decision.activityId)
    const mode = resolveIdentityMode(sessionId)
    if (activity && activityAllowedForMode(activity, mode)) {
      const display = findRuntimeDisplayCandidate(text, activity.id)
      if (cur?.activityId === activity.id && now < cur.plannedUntil) {
        const displayChanged = Boolean(
          display && (cur.displayText !== display.text || cur.displayLang !== display.lang),
        )
        if (!displayChanged && !continuityChanged) return cur
        const next = withContinuity({
          ...cur,
          ...(display ? { displayText: display.text, displayLang: display.lang } : {}),
          updatedAt: now,
        }, nextContinuity)
        map[key] = next
        saveAll(map)
        return next
      }
      const next = createChatOverrideState(activity, now, recentIds, display, nextContinuity)
      map[key] = next
      saveAll(map)
      return next
    }
    // 当前动作若因身份模式不允许，只忽略“活动”这一维；可信连续性 evidence 仍可独立写回。
  }

  if (decision?.type === 'finish' && cur) {
    const next = createIdleState(now, recentIds, nextContinuity)
    map[key] = next
    saveAll(map)
    return next
  }

  if (!continuityChanged) return null

  const next = cur
    ? withContinuity({ ...cur, updatedAt: now }, nextContinuity)
    : createIdleState(now, recentIds, nextContinuity)
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
    if (!isTaRuntimeState(cs)) continue
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

function isContinuityEvidence(
  value: unknown,
  expectedKind: TaContinuityKind,
): value is TaContinuityEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as Partial<TaContinuityEvidence>
  return evidence.kind === expectedKind
    && typeof evidence.text === 'string'
    && evidence.text.trim().length > 0
    && Array.from(evidence.text).length <= CONTINUITY_EVIDENCE_MAX_CHARS + 1
    && typeof evidence.evidenceAt === 'number'
    && Number.isFinite(evidence.evidenceAt)
    && evidence.evidenceAt > 0
    && typeof evidence.expiresAt === 'number'
    && Number.isFinite(evidence.expiresAt)
    && evidence.expiresAt >= evidence.evidenceAt
}

function isContinuityState(value: unknown): value is TaContinuityState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const continuity = value as Partial<TaContinuityState>
  if (continuity.openThread == null && continuity.selfIntent == null) return false
  return (continuity.openThread == null || isContinuityEvidence(continuity.openThread, 'open-question'))
    && (continuity.selfIntent == null || isContinuityEvidence(continuity.selfIntent, 'self-intent'))
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
    && (state.source === 'routine' || state.source === 'persona' || state.source === 'chat' || state.source === 'idle')
    && (state.recentActivityIds == null || (
      Array.isArray(state.recentActivityIds)
      && state.recentActivityIds.length <= 3
      && state.recentActivityIds.every((id) => typeof id === 'string' && id.length > 0)
    ))
    && (state.displayText == null || typeof state.displayText === 'string')
    && (state.displayLang == null || state.displayLang === 'zh' || state.displayLang === 'en')
    && (state.continuity == null || isContinuityState(state.continuity))
}

/**
 * Chat 是否需要把 Runtime 作为“候选上下文”带进这一轮。
 * 本地只识别当前态/问询句式，不维护“喝咖啡/做饭/遛狗……”这类活动词义表。
 * 具体是不是在问 TA 自己，由本轮原本就会调用的模型结合整句理解；不增加额外 LLM。
 */
const ZH_RUNTIME_QUERY_PATTERNS: readonly RegExp[] = [
  // 短 yes/no 问句只看语法，不看“喝咖啡 / 遛狗 / 弄方案”等具体词义。
  /^.{1,24}(?:吗|嘛|么)(?:？|\?)?$/i,
  // 没有语气词时，只保留明显的“当前正在……”结构。
  /^(?:你|TA)?(?:现在|这会儿|这会|此刻)?(?:还)?在.{1,24}(?:？|\?)$/i,
  // 少量通用疑问结构；这些是问法，不是活动词典。
  /^(?:你|TA)?(?:现在|这会儿|这会|此刻)?(?:在)?(?:干嘛|干什么|做什么|忙什么|忙啥)(?:呢|呀|啊|嘛|么)?(?:？|\?)?$/i,
  /^(?:你|TA)?忙完(?:了)?(?:吗|嘛|么|没|没有)?(?:？|\?)?$/i,
  /^(?:你|TA)?到哪(?:儿)?了(?:呢|呀|啊)?(?:？|\?)?$/i,
  /^(?:你|TA)?(?:现在|这会儿|这会|此刻)?在(?:哪|哪里|哪儿)(?:呢|呀|啊)?(?:？|\?)?$/i,
  /^(?:你|TA)?(?:现在|这会儿|这会|此刻)怎么样(?:了)?(?:呢|呀|啊)?(?:？|\?)?$/i,
]
const EN_RUNTIME_QUERY_PATTERNS: readonly RegExp[] = [
  /^(?:are|were) you (?:still )?.{1,60}\??$/i,
  /^(?:what|where|how) are you .{0,60}\??$/i,
  /^(?:did|have) you .{1,60}\??$/i,
  /^still .{1,60}\?$/i,
]
export function shouldInjectTaRuntimeContext(userText: string, lang: Lang = 'zh'): boolean {
  const text = String(userText ?? '').trim()
  if (!text) return false
  // 明确是 USER / 第三人的主语时，本地直接排除；这里只做稳定的主语边界，不理解活动词义。
  if (/^(?:我|我们|咱们|他|她|它|他们|她们|它们)/.test(text)) return false
  const primary = lang === 'en' ? EN_RUNTIME_QUERY_PATTERNS : ZH_RUNTIME_QUERY_PATTERNS
  const secondary = lang === 'en' ? ZH_RUNTIME_QUERY_PATTERNS : EN_RUNTIME_QUERY_PATTERNS
  return primary.some((pattern) => pattern.test(text)) || secondary.some((pattern) => pattern.test(text))
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
  if (!runtime || runtime.activityId === TA_RUNTIME_IDLE_ID) return ''
  if (runtime.displayText && runtime.displayLang === lang) return runtime.displayText
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
  if (!runtime || runtime.activityId === TA_RUNTIME_IDLE_ID || !runtime.label) return ''
  const until = formatRuntimeUntil(runtime.plannedUntil)
  if (lang === 'en') {
    return [
      '[What you are doing right now]',
      "This is your own current life state — not something the other person told you, not a shared memory or event, and not the other person\u2019s activity.",
      'Treat this as candidate context: first decide whether the user is actually asking about your own current or recent state. If not, ignore this state completely and do not bring it up.',
      'If it is relevant, use only the state itself. Unless the chat history explicitly supports it, do not add a location, people, food, reason, sequence of events, or any other life detail.',
      'Never restate it as what the other person is doing:',
      `${formatAttributedLine(runtimeDisplayLabel(runtime, 'en'), 'SELF', 'en')}, probably until around ${until}.`,
    ].join('\n')
  }
  return [
    '【你自己此刻在做什么】',
    '下面是你自己当前的生活状态，不是对方告诉你的，也不是你们共同的经历——更不是在说对方，绝不要把这件事写成对方在做：',
    '这是一条候选上下文：先理解用户这一句到底是不是在问你自己的当前/刚刚状态；如果不是，就完全忽略下面这条状态，不要主动提起。',
    '如果相关，只能使用下面这条状态本身；除非聊天历史另有明确依据，不得补写地点、人物、食物、原因、前后经过或其他生活细节。',
    `${formatAttributedLine(runtimeDisplayLabel(runtime, 'zh'), 'SELF', 'zh')}，预计会持续到 ${until} 左右。`,
  ].join('\n')
}
