import {
  enqueueCloudStateOp,
  getCloudStateVersion,
  registerCloudStateAdapter,
  requestCloudStateSync,
  getCloudStateSidecar,
  setCloudStateSidecar,
  type CloudStateEntity,
} from './cloudState.ts'
import { notifyDataChanged } from './dataChange.ts'
import { getMessagesCache } from './sessionStore.ts'
import { getAccount } from './sync.ts'
import { messageEvidenceText } from './messageQuote.ts'

export const TA_MOOD_WORDS = [
  '雀跃', '期待', '安心', '惬意',
  '烦躁', '紧绷', '低落', '闷闷的',
  '若有所思', '惦记', '有点累', '发呆',
] as const

export type TaMoodWord = (typeof TA_MOOD_WORDS)[number]
export type TaThoughtTheme = 'connection' | 'reflection' | 'exploration' | 'rest'

const TA_MOOD_EN: Record<TaMoodWord, string> = {
  '雀跃': 'cheerful',
  '期待': 'expectant',
  '安心': 'at ease',
  '惬意': 'content and relaxed',
  '烦躁': 'irritated',
  '紧绷': 'tense',
  '低落': 'low',
  '闷闷的': 'subdued',
  '若有所思': 'thoughtful',
  '惦记': 'keeping something in mind',
  '有点累': 'a little tired',
  '发呆': 'zoning out',
}

export function taMoodLabelForPrompt(mood: TaMoodWord, lang: 'zh' | 'en'): string {
  return lang === 'en' ? TA_MOOD_EN[mood] : mood
}

export interface TaStateView {
  mood: TaMoodWord
  description: string
  reason: string
  changedAt: number
}

interface PrivateAxes {
  /** -1 舒展 → +1 紧绷 */
  relaxedTense: number
  /** -1 沉静 → +1 活跃 */
  quietActive: number
}

interface PrivateTendencies {
  connection: number
  expression: number
  exploration: number
  involvement: number
  reminiscence: number
  space: number
  energy: number
}

interface PrivateReason {
  kind: 'time' | 'chat' | 'self-evidence' | 'story'
  text: string
  at: number
}

interface PrivateTaState {
  sessionId: string
  axes: PrivateAxes
  tendencies: PrivateTendencies
  mood: TaMoodWord
  description: string
  reason: PrivateReason
  lastSettledAt: number
  lastChangedAt: number
  updatedAt: number
  lastEvidenceBatchTs?: number
  lastCloudQueuedAt?: number
}

const KIND = 'ta_state'
const SIDECAR = 'ta_state_v1'
const SETTLE_MIN_MS = 15 * 60_000
const MOOD_STABLE_MS = 45 * 60_000
const INTERACTION_MOOD_DEBOUNCE_MS = 30 * 60_000
const CLOUD_HEARTBEAT_MS = 90 * 60_000

function clamp01(value: number): number {
  return Math.max(0, Math.min(.9, Number.isFinite(value) ? value : 0))
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0))
}

function localHour(ts: number): number {
  return new Date(ts).getHours()
}



function energyTarget(ts: number): number {
  const hour = localHour(ts)
  if (hour >= 7 && hour < 11) return .78
  if (hour >= 11 && hour < 18) return .68
  if (hour >= 18 && hour < 22) return .48
  return .28
}

function activityTarget(ts: number): number {
  const hour = localHour(ts)
  if (hour >= 7 && hour < 11) return .18
  if (hour >= 11 && hour < 18) return .25
  if (hour >= 18 && hour < 22) return .02
  return -.28
}

function moodDescription(mood: TaMoodWord): string {
  switch (mood) {
    case '雀跃': return '心里有一点亮，想把手上的事往前推一推。'
    case '期待': return '对接下来的事有一点期待，注意力正慢慢往前走。'
    case '安心': return '心里比较安稳，节奏也放得下来。'
    case '惬意': return '状态舒展，想按自己的节奏待一会儿。'
    case '烦躁': return '刚刚有明确的事让情绪起了波动，还没完全落下来。'
    case '紧绷': return '刚刚发生的事还压着一点注意力，暂时没完全放松。'
    case '低落': return '刚刚那件事留下了一点低落感，正在慢慢回落。'
    case '闷闷的': return '刚刚的情绪还没有散开，想先少说一点。'
    case '若有所思': return '脑子里还留着一点没整理完的东西，想再想一会儿。'
    case '惦记': return '有件刚聊过的事还在心里挂着一点。'
    case '有点累': return '精力往下走了，想把节奏放慢一些。'
    case '发呆': return '现在更想留一点空白，不急着做什么。'
  }
}

function chooseMood(state: PrivateTaState): TaMoodWord {
  const { relaxedTense: tense, quietActive: active } = state.axes
  const t = state.tendencies

  // 负面词只可能由真实 self-evidence 把 tense 推高；时间结算只会把 tension 往 0 拉。
  if (tense >= .48 && active >= .15) return t.energy >= .45 ? '烦躁' : '紧绷'
  if (tense >= .38 && active < .15) return t.energy < .35 ? '低落' : '闷闷的'
  if (t.energy <= .27) return '有点累'
  if (active <= -.42 && t.space >= .58) return '发呆'
  if (t.reminiscence >= .66 && t.connection >= .48) return '惦记'
  if (t.exploration >= .62 || t.reminiscence >= .56) return '若有所思'
  if (tense <= -.28 && active >= .24) return t.connection >= .58 ? '雀跃' : '期待'
  if (tense <= -.22) return active <= -.05 ? '惬意' : '安心'
  if (active >= .28) return '期待'
  return '安心'
}

function initialState(sessionId: string, now: number): PrivateTaState {
  const state: PrivateTaState = {
    sessionId,
    axes: { relaxedTense: -.08, quietActive: activityTarget(now) },
    tendencies: {
      connection: .44,
      expression: .40,
      exploration: .46,
      involvement: .48,
      reminiscence: .30,
      space: .42,
      energy: energyTarget(now),
    },
    mood: '安心',
    description: moodDescription('安心'),
    reason: { kind: 'time', text: '按日常节律慢慢落到现在的状态', at: now },
    lastSettledAt: now,
    lastChangedAt: now,
    updatedAt: now,
  }
  state.mood = chooseMood(state)
  state.description = moodDescription(state.mood)
  return state
}

function readMap(): Record<string, PrivateTaState> {
  const raw = getCloudStateSidecar<Record<string, PrivateTaState>>(SIDECAR)
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {}
}

function validPrivateState(value: unknown, sessionId?: string): PrivateTaState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const state = value as Partial<PrivateTaState>
  if (typeof state.sessionId !== 'string' || (sessionId && state.sessionId !== sessionId)) return null
  if (!state.axes || typeof state.axes.relaxedTense !== 'number' || typeof state.axes.quietActive !== 'number') return null
  if (!state.tendencies || ['connection','expression','exploration','involvement','reminiscence','space','energy']
    .some((key) => typeof (state.tendencies as unknown as Record<string, unknown>)[key] !== 'number')) return null
  if (!TA_MOOD_WORDS.includes(state.mood as TaMoodWord)) return null
  if (typeof state.description !== 'string' || !state.reason || typeof state.reason.text !== 'string') return null
  if (typeof state.lastSettledAt !== 'number' || typeof state.lastChangedAt !== 'number' || typeof state.updatedAt !== 'number') return null
  return state as PrivateTaState
}

function writeState(state: PrivateTaState, notify = true): boolean {
  const map = readMap()
  map[state.sessionId] = state
  const ok = setCloudStateSidecar(SIDECAR, map)
  if (ok && notify) notifyDataChanged()
  return ok
}

function opId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ta-state-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function queueCloud(state: PrivateTaState): void {
  const account = getAccount()
  if (!account || !state.sessionId) return
  enqueueCloudStateOp({
    opId: opId(),
    kind: KIND,
    entityId: state.sessionId,
    sessionId: state.sessionId,
    baseVersion: getCloudStateVersion(KIND, state.sessionId, undefined, state.sessionId),
    payload: state,
  })
  requestCloudStateSync()
}

function persist(state: PrivateTaState, options: { notify?: boolean; forceCloud?: boolean } = {}): void {
  if (!writeState(state, options.notify !== false)) return
  const due = options.forceCloud || !state.lastCloudQueuedAt || state.updatedAt - state.lastCloudQueuedAt >= CLOUD_HEARTBEAT_MS
  if (!due) return
  const queued = { ...state, lastCloudQueuedAt: state.updatedAt }
  writeState(queued, false)
  queueCloud(queued)
}

function lerp(current: number, target: number, amount: number): number {
  return current + (target - current) * Math.max(0, Math.min(1, amount))
}

/** 02:00–07:00 完全冻结；22:00–02:00 只按 35% 速度结算。
 * 懒补算按每个小时段自己的权重算，不能拿“当前小时”的速度套整段离线时间。 */
function weightedSettledMinutes(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  let cursor = from
  let weightedMs = 0
  const hardEnd = Math.min(to, from + 7 * 24 * 60 * 60_000)
  while (cursor < hardEnd) {
    const d = new Date(cursor)
    const nextHour = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours() + 1,
      0, 0, 0,
    ).getTime()
    const segmentEnd = Math.min(hardEnd, nextHour)
    const hour = d.getHours()
    const segment = Math.max(0, segmentEnd - cursor)
    if (hour >= 7 && hour < 22) weightedMs += segment
    else if (hour >= 22 || hour < 2) weightedMs += segment * .35
    // 02:00–07:00 权重 = 0，完全冻结。
    cursor = segmentEnd > cursor ? segmentEnd : cursor + 60_000
  }
  return weightedMs / 60_000
}

function settlePrivate(state: PrivateTaState, now: number): PrivateTaState {
  if (!Number.isFinite(now) || now <= state.lastSettledAt) return state
  const elapsed = now - state.lastSettledAt
  if (elapsed < SETTLE_MIN_MS) return state

  const minutes = weightedSettledMinutes(state.lastSettledAt, now)
  if (minutes <= 0) return { ...state, lastSettledAt: now, updatedAt: now }
  const drift = Math.min(.72, (minutes / 180) * .18)
  const shortEmotionDecay = 1 - Math.pow(.5, minutes / 120)

  const next: PrivateTaState = {
    ...state,
    axes: {
      // 时间只能让负面 tension 回落，不能凭空把负面往上推。
      relaxedTense: clampAxis(
        state.axes.relaxedTense > 0
          ? lerp(state.axes.relaxedTense, 0, shortEmotionDecay)
          : lerp(state.axes.relaxedTense, -.10, drift * .35),
      ),
      quietActive: clampAxis(lerp(state.axes.quietActive, activityTarget(now), drift)),
    },
    tendencies: {
      connection: clamp01(lerp(state.tendencies.connection, .46, drift * .18)),
      expression: clamp01(lerp(state.tendencies.expression, .42, drift * .16)),
      exploration: clamp01(state.tendencies.exploration + .018 * Math.min(6, minutes / 60) ),
      involvement: clamp01(lerp(state.tendencies.involvement, .48, drift * .12)),
      reminiscence: clamp01(state.tendencies.reminiscence + .014 * Math.min(6, minutes / 60) * (state.axes.quietActive < .05 ? 1 : .55)),
      space: clamp01(state.tendencies.space + .012 * Math.min(6, minutes / 60) * (state.tendencies.connection < .58 ? 1 : .5)),
      energy: clamp01(lerp(state.tendencies.energy, energyTarget(now), Math.min(.75, drift * 1.35))),
    },
    lastSettledAt: now,
    updatedAt: now,
  }

  const candidate = chooseMood(next)
  if (candidate !== state.mood && now - state.lastChangedAt >= MOOD_STABLE_MS) {
    next.mood = candidate
    next.description = moodDescription(candidate)
    next.lastChangedAt = now
    next.reason = { kind: 'time', text: '日常节律和时间经过让状态慢慢变化', at: now }
  }

  return next
}

function getPrivate(sessionId: string, now = Date.now()): PrivateTaState {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return initialState('', now)
  const map = readMap()
  const current = validPrivateState(map[sid], sid) ?? initialState(sid, now)
  const settled = settlePrivate(current, now)
  if (settled !== current) persist(settled, { notify: settled.mood !== current.mood })
  else if (!map[sid]) persist(current, { notify: false })
  return settled
}

export function getTaStateView(sessionId: string, now = Date.now()): TaStateView {
  const state = getPrivate(sessionId, now)
  return {
    mood: state.mood,
    description: state.description,
    reason: state.reason.text,
    changedAt: state.lastChangedAt,
  }
}

export function recordTaStateInteraction(sessionId: string, now = Date.now()): TaStateView {
  const state = getPrivate(sessionId, now)
  if (!state.sessionId) return getTaStateView(sessionId, now)
  const next: PrivateTaState = {
    ...state,
    axes: {
      relaxedTense: clampAxis(Math.min(state.axes.relaxedTense, .08) - .05),
      quietActive: clampAxis(state.axes.quietActive + .08),
    },
    tendencies: {
      ...state.tendencies,
      connection: clamp01(state.tendencies.connection + .07),
      expression: clamp01(state.tendencies.expression + .05),
      involvement: clamp01(state.tendencies.involvement + .05),
      reminiscence: clamp01(state.tendencies.reminiscence + .03),
      space: clamp01(state.tendencies.space - .04),
    },
    reason: { kind: 'chat', text: '刚刚真实聊过一会儿', at: now },
    lastSettledAt: now,
    updatedAt: now,
  }
  const candidate = chooseMood(next)
  // 普通聊天只推动内部倾向；前台心情至少稳定 30 分钟，避免每轮对话都跳词。
  const moodChanged = candidate !== state.mood && now - state.lastChangedAt >= INTERACTION_MOOD_DEBOUNCE_MS
  if (moodChanged) {
    next.mood = candidate
    next.description = moodDescription(candidate)
    next.lastChangedAt = now
  }
  // 普通互动只本地累积；只有可见心情变化或 90 分钟 heartbeat 才排一次 Cloud State。
  persist(next, { forceCloud: moodChanged, notify: moodChanged })
  return getTaStateView(sessionId, now)
}

function latestAssistantBatch(sessionId: string): { ts: number; text: string } | null {
  const messages = getMessagesCache(sessionId)
  const latest = [...messages].reverse().find((message) => (
    message.role === 'assistant' && message.replyState !== 'interrupted' && message.content.trim()
  ))
  if (!latest) return null
  const text = messages
    .filter((message) => message.role === 'assistant' && message.replyState !== 'interrupted' && message.ts === latest.ts && message.content.trim())
    .map((message) => message.content.trim())
    .join('\n')
  return text ? { ts: latest.ts, text } : null
}

type EvidencePatch = {
  tension?: number
  active?: number
  energy?: number
  reminiscence?: number
  exploration?: number
  reason: string
}

function detectSelfEmotionEvidence(text: string): EvidencePatch | null {
  // 只把“我 + 直接状态谓词”当成 TA 自述。不能用“我.{N}情绪词”这类跨主语匹配，
  // 否则“我知道你很难过 / 我觉得你很烦躁”会把 USER 的情绪写进 TA 状态。
  const clauses = String(text ?? '')
    .split(/[。！？!?；;，,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const owns = (clause: string, words: string): boolean => {
    const lead = '(?:其实|说真的|不过|只是|刚刚)?'
    const subject = '我(?:现在|今天|这会儿|刚刚|也|确实|真的)?'
    const bridge = '(?:心里|感觉|觉得)?'
    const degree = '(?:有点|有些|挺|很)?'
    return new RegExp(`^${lead}${subject}${bridge}${degree}(?:${words})`).test(clause.replace(/\\s+/g, ''))
  }

  for (const clause of clauses) {
    if (owns(clause, '烦|烦躁|乱|心里乱|静不下来')) {
      return { tension: .62, active: .28, reason: 'TA 刚刚明确说自己有些烦躁' }
    }
    if (owns(clause, '紧张|紧绷|绷着')) {
      return { tension: .66, active: .08, reason: 'TA 刚刚明确说自己有些紧绷' }
    }
    if (owns(clause, '低落|难过|心情不好')) {
      return { tension: .48, active: -.36, energy: .34, reason: 'TA 刚刚明确说自己有些低落' }
    }
    if (owns(clause, '闷|闷闷的')) {
      return { tension: .44, active: -.30, reason: 'TA 刚刚明确说自己心里有点闷' }
    }
    if (owns(clause, '累|疲惫|没精神')) {
      return { energy: .20, active: -.30, reason: 'TA 刚刚明确说自己有点累' }
    }
    if (owns(clause, '期待|兴奋|开心')) {
      return { tension: -.32, active: .34, energy: .68, reason: 'TA 刚刚明确表达了期待或开心' }
    }
    if (owns(clause, '安心|放松|惬意')) {
      return { tension: -.42, active: -.04, reason: 'TA 刚刚明确说自己比较放松' }
    }
    if (/^(?:其实|刚刚)?我(?:还|也)?(?:在想|想了想|有点想不明白|若有所思)/.test(clause.replace(/\s+/g, ''))) {
      return { reminiscence: .72, exploration: .68, active: -.08, reason: 'TA 刚刚明确说自己还在想一件事' }
    }
  }
  return null
}

export function captureTaStateEvidenceFromLatestReply(sessionId: string, now = Date.now()): TaStateView {
  const batch = latestAssistantBatch(sessionId)
  let state = getPrivate(sessionId, now)
  if (!batch || state.lastEvidenceBatchTs === batch.ts) return getTaStateView(sessionId, now)

  // quote block 只是上下文，不是 TA 自己的新自述；先剥掉再做证据判定。
  const evidence = detectSelfEmotionEvidence(messageEvidenceText(batch.text))
  const base: PrivateTaState = {
    ...state,
    lastEvidenceBatchTs: batch.ts,
    lastSettledAt: now,
    updatedAt: now,
  }

  if (!evidence) {
    persist(base, { notify: false })
    return getTaStateView(sessionId, now)
  }

  state = {
    ...base,
    axes: {
      relaxedTense: evidence.tension == null ? state.axes.relaxedTense : clampAxis(evidence.tension),
      quietActive: evidence.active == null ? state.axes.quietActive : clampAxis(evidence.active),
    },
    tendencies: {
      ...state.tendencies,
      energy: evidence.energy == null ? state.tendencies.energy : clamp01(evidence.energy),
      reminiscence: evidence.reminiscence == null ? state.tendencies.reminiscence : clamp01(evidence.reminiscence),
      exploration: evidence.exploration == null ? state.tendencies.exploration : clamp01(evidence.exploration),
    },
    reason: { kind: 'self-evidence', text: evidence.reason, at: now },
  }
  state.mood = chooseMood(state)
  state.description = moodDescription(state.mood)
  state.lastChangedAt = now
  persist(state, { forceCloud: true })
  return getTaStateView(sessionId, now)
}

export function getTaThoughtSignal(
  sessionId: string,
  lastThoughtAt: number | null,
  now = Date.now(),
): { theme: TaThoughtTheme; mood: TaMoodWord } | null {
  const state = getPrivate(sessionId, now)
  if (!state.sessionId || (lastThoughtAt && now - lastThoughtAt < 3 * 60 * 60_000)) return null

  const t = state.tendencies
  const scores: Array<[TaThoughtTheme, number]> = [
    ['connection', t.connection * .43 + t.expression * .24 + t.reminiscence * .20],
    ['reflection', t.reminiscence * .46 + t.exploration * .24 + (state.axes.quietActive < 0 ? .14 : 0)],
    ['exploration', t.exploration * .48 + t.involvement * .24 + (state.axes.quietActive > 0 ? .10 : 0)],
    ['rest', t.space * .38 + (1 - t.energy) * .46 + (state.axes.quietActive < -.2 ? .10 : 0)],
  ]
  scores.sort((a, b) => b[1] - a[1])
  if ((scores[0]?.[1] ?? 0) < .58) return null
  return { theme: scores[0][0], mood: state.mood }
}

export function initTaStateCloudSync(): void {
  registerCloudStateAdapter(KIND, {
    apply(entity: CloudStateEntity) {
      if (!entity.sessionId || entity.entityId !== entity.sessionId) return
      const incoming = validPrivateState(entity.payload, entity.sessionId)
      if (!incoming) return
      const map = readMap()
      // Cloud State entity.version 才是跨设备冲突的权威顺序；不能再用各设备本地时钟 updatedAt 否掉 canonical。
      map[entity.sessionId] = incoming
      setCloudStateSidecar(SIDECAR, map)
      notifyDataChanged()
    },
    delete(entity: CloudStateEntity) {
      const sid = entity.sessionId || entity.entityId
      if (!sid) return
      const map = readMap()
      if (!(sid in map)) return
      delete map[sid]
      setCloudStateSidecar(SIDECAR, map)
      notifyDataChanged()
    },
  })
}
