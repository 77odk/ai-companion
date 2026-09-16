// Event V2：本地候选窗口（不上云）→ 收口时至多一次 LLM → 证据硬闸门 → createEvent
// 原则：Candidate 可以宽，Event 必须少；AI 只能整理已经发生过的证据，不能“发动态”。
import { createEvent, EVENT_TYPES, getEvents } from './eventStore.ts'
import { loadSettings } from './storage.ts'
import { chatCompletion } from './modelChat.ts'

/** 精判额度：每个会话 + 设备本地日期，每天最多 3 次。 */
export const EVENT_JUDGE_LIMIT = 3
/** 自动写入每周硬上限；不是配额目标，允许 0 条。 */
export const AUTO_EVENT_WEEKLY_LIMIT = 3
/** confidence 仍保留为额外硬门槛，但不能替代五维证据。 */
export const EVENT_CONFIDENCE_THRESHOLD = 0.75

const JUDGE_QUOTA_KEY = 'ai_companion_event_judge'
const CANDIDATE_KEY_PREFIX = 'ai_companion_event_candidate_v2'
export const EVENT_CANDIDATE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
export const EVENT_CANDIDATE_EVIDENCE_MAX = 8
export const EVENT_CANDIDATE_TEXT_MAX = 280

// ---- 负向过滤 ----

const NEGATIVE_FUTURE_RE =
  /以后(?:我们|一起)|下周(?:我们|一起)?|周五我们|周末我们|好想一起|想和你|如果(?:以后|有机会)|有机会一起|打算|准备(?:和|跟)?你|要和你|希望(?:我们|以后)|等(?:我们|你)|改天(?:我们|一起)|下次我们/
const NEGATIVE_UNCERTAIN_RE = /应该(?:是)?(?:我们|一起)?去过|可能(?:是)?(?:我们)?一起|我记得我们好像|好像(?:是)?我们|不确定(?:是不是)?我们|我们(?:好像|似乎)/
const PAST_FUTURE_DISCUSSION_RE =
  /(刚刚|刚才|今天|昨天|昨晚|那天|前几天).{0,14}(聊了|谈了|讨论了|聊过|谈过|说起了).{0,24}(以后|未来|将来)/

/** 纯未来/愿望/不确定回忆不进入 Event；“刚刚认真聊了未来”属于已发生的谈话，不误杀。 */
export function isNegativeExpression(text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return true
  if (NEGATIVE_UNCERTAIN_RE.test(t)) return true
  return NEGATIVE_FUTURE_RE.test(t) && !PAST_FUTURE_DISCUSSION_RE.test(t)
}

// ---- 旧粗筛兼容 + V2 宽候选 ----

const SUBJECT_RE = /我们|一起|我们俩|你和我|咱们|跟你|和你|和TA|和 TA/
const ACTION_RE = /去了|去过|吃了|看了|见了|到了|回来|完成了|一起做了|一起玩了|一起看了/
export const TIME_BONUS_RE = /今天|昨天|刚刚|刚才|上周|前几天|那天|周末/
export const RELATION_BONUS_RE = /第一次|终于|约好了|说定了|和好了|见面了|旅行回来/

/** 旧接口保留，避免破坏既有测试；生产主流程不再靠它决定是否调用模型。 */
export function coarsePass(text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t) return false
  return SUBJECT_RE.test(t) && ACTION_RE.test(t)
}

/**
 * V2 本地宽筛：只寻找“关系价值可能发生变化”的弱信号。
 * 不把普通“我们吃了饭/看了电影”都送模型，避免 Event 变朋友圈，也控制 BYOK 成本。
 */
const BROAD_RELATION_SIGNAL_RE =
  /第一次|终于|说开|和好|吵|生气|道歉|原谅|复合|重逢|分开|秘密|很少跟别人说|一直没告诉你|没告诉过你|信任|懂我|理解我|更懂|更了解|聊得.{0,8}开心|聊了.{0,8}(很久|好久)|陪我|谢谢你.{0,8}陪|你还记得|喜欢你|想你|在乎你|舍不得|决定了|定下来|说定了|约好了|完成了|做完了|庆祝|纪念日|第\s*\d+\s*天|旅行回来|认真.{0,6}(聊|谈).{0,12}(以后|未来|将来)/

export function broadCandidatePass(text: string): boolean {
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t || isNegativeExpression(t)) return false
  return BROAD_RELATION_SIGNAL_RE.test(t)
}

// ---- 旧三句窗口兼容接口 ----

export const EVENT_CANDIDATE_WINDOW_SIZE = 3

function compactCandidateText(text: string): string {
  return (typeof text === 'string' ? text.trim() : '').slice(0, EVENT_CANDIDATE_TEXT_MAX)
}

export function buildEventCandidateWindow(userText: string, recentUserTexts: string[] = []): string[] {
  const current = compactCandidateText(userText)
  if (!current) return []
  const prior = (Array.isArray(recentUserTexts) ? recentUserTexts : [])
    .map(compactCandidateText)
    .filter(Boolean)
    .slice(-(EVENT_CANDIDATE_WINDOW_SIZE - 1))
  return [...prior, current]
}

export function coarsePassCandidateWindow(userText: string, recentUserTexts: string[] = []): boolean {
  const current = compactCandidateText(userText)
  if (!current || isNegativeExpression(current)) return false
  if (coarsePass(current)) return true
  const currentHasSignal =
    SUBJECT_RE.test(current) || ACTION_RE.test(current) || TIME_BONUS_RE.test(current) || RELATION_BONUS_RE.test(current)
  if (!currentHasSignal) return false
  const window = buildEventCandidateWindow(current, recentUserTexts)
  if (window.length < 2) return false
  return coarsePass(window.join('\n'))
}

export function buildEventCandidateUserPrompt(userText: string, recentUserTexts: string[] = []): string {
  const window = buildEventCandidateWindow(userText, recentUserTexts)
  return (
    '【用户原话窗口】\n' +
    window.map((line, i) => '用户原话' + (i + 1) + '：' + line).join('\n') +
    '\n【判定约束】最后一条是当前消息。只允许把这些相邻用户原话中明确属于同一件事的信息合起来判断；不同事情不能拼接。'
  )
}

// ---- V2 Candidate Window：local-only，不触发 data-change / cloud sync ----

export interface EventEvidenceItem {
  id: string
  text: string
  ts: number
}

export interface EventCandidateState {
  version: 2
  sessionId: string
  openedAt: number
  lastTouchedAt: number
  evidence: EventEvidenceItem[]
}

export function candidateWindowKey(sessionId?: string): string {
  return `${CANDIDATE_KEY_PREFIX}:${sessionId?.trim() || '_global'}`
}

function evidenceHash(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function loadCandidateWindow(sessionId: string | undefined, now = Date.now()): EventCandidateState | null {
  try {
    const raw = localStorage.getItem(candidateWindowKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<EventCandidateState>
    if (
      parsed.version !== 2 ||
      !Array.isArray(parsed.evidence) ||
      typeof parsed.openedAt !== 'number' ||
      typeof parsed.lastTouchedAt !== 'number'
    ) {
      localStorage.removeItem(candidateWindowKey(sessionId))
      return null
    }
    if (now - parsed.openedAt > EVENT_CANDIDATE_MAX_AGE_MS) {
      // 未收口超过 3 天：直接丢弃，不编造“后来解决了”。
      localStorage.removeItem(candidateWindowKey(sessionId))
      return null
    }
    const evidence = parsed.evidence
      .filter((item): item is EventEvidenceItem =>
        item != null && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.ts === 'number',
      )
      .slice(-EVENT_CANDIDATE_EVIDENCE_MAX)
    if (evidence.length === 0) return null
    return {
      version: 2,
      sessionId: sessionId?.trim() || '_global',
      openedAt: parsed.openedAt,
      lastTouchedAt: parsed.lastTouchedAt,
      evidence,
    }
  } catch {
    return null
  }
}

export function saveCandidateWindow(state: EventCandidateState): void {
  try {
    localStorage.setItem(candidateWindowKey(state.sessionId === '_global' ? undefined : state.sessionId), JSON.stringify(state))
  } catch {
    // local-only 临时态，存失败就放弃，不影响聊天。
  }
}

export function clearCandidateWindow(sessionId?: string): void {
  try {
    localStorage.removeItem(candidateWindowKey(sessionId))
  } catch {
    // ignore
  }
}

export function appendCandidateEvidence(
  state: EventCandidateState | null,
  sessionId: string | undefined,
  text: string,
  ts: number,
): EventCandidateState {
  const compact = compactCandidateText(text)
  const id = `u-${ts}-${evidenceHash(compact)}`
  const base: EventCandidateState = state ?? {
    version: 2,
    sessionId: sessionId?.trim() || '_global',
    openedAt: ts,
    lastTouchedAt: ts,
    evidence: [],
  }
  const withoutSame = base.evidence.filter((item) => item.id !== id)
  return {
    ...base,
    lastTouchedAt: ts,
    evidence: [...withoutSame, { id, text: compact, ts }].slice(-EVENT_CANDIDATE_EVIDENCE_MAX),
  }
}

const HARD_CLOSURE_RE =
  /第一次|终于|说开了|说开啦|和好了|和好啦|道歉了|原谅了|复合了|重逢了|决定了|定下来了|说定了|完成了|做完了|庆祝了|很少跟别人说|一直没告诉你|没告诉过你|秘密|刚刚.{0,12}(聊完|谈完)|认真.{0,8}(聊了|谈了).{0,18}(以后|未来|将来)/
const SOFT_CLOSURE_RE =
  /感觉.{0,10}(懂我|理解我|更近|更亲)|你更懂我|更了解我|今天.{0,10}聊得.{0,8}开心|谢谢你.{0,10}陪|原来你还记得|好像.{0,8}更懂|聊完.{0,8}(轻松|开心|舒服)/

/** 收口才允许调用一次模型；软关系变化至少要两条用户证据。 */
export function shouldJudgeCandidateWindow(state: EventCandidateState, currentText: string): boolean {
  const t = compactCandidateText(currentText)
  if (HARD_CLOSURE_RE.test(t)) return true
  return state.evidence.length >= 2 && SOFT_CLOSURE_RE.test(t)
}

export function buildEventWindowPrompt(state: EventCandidateState): string {
  const lines = state.evidence.map((item) => {
    const when = new Date(item.ts).toISOString()
    return `[${item.id}] ${when} 用户原话：${item.text}`
  })
  return (
    '【Candidate Window｜仅用户原话证据】\n' +
    lines.join('\n') +
    '\n【要求】只判断这些证据是否共同描述同一段值得留下的关系时刻。不同事情不能拼接。任何判断为 true 的维度和每条 safeFact 都必须引用上面的 evidence id。'
  )
}

// ---- 额度 ----

export function localDateKey(now: number): string {
  const d = new Date(now)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${dd}`
}

export function judgeQuotaKey(sessionId: string | undefined, now: number): string {
  return `${sessionId?.trim() || '_global'}|${localDateKey(now)}`
}

function readQuotaMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(JUDGE_QUOTA_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? (data as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeQuotaMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(JUDGE_QUOTA_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function getJudgeQuotaUsed(sessionId: string | undefined, now: number): number {
  return readQuotaMap()[judgeQuotaKey(sessionId, now)] ?? 0
}

export function consumeJudgeQuota(sessionId: string | undefined, now: number): boolean {
  const key = judgeQuotaKey(sessionId, now)
  const map = readQuotaMap()
  const used = map[key] ?? 0
  if (used >= EVENT_JUDGE_LIMIT) return false
  map[key] = used + 1
  writeQuotaMap(map)
  return true
}

function startOfLocalWeek(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.getTime()
}

export function getAutoEventCountThisWeek(sessionId: string | undefined, now: number): number {
  const start = startOfLocalWeek(now)
  const end = start + 7 * 24 * 60 * 60 * 1000
  return getEvents(sessionId).filter(
    (event) => event.source === 'chat' && event.createdAt >= start && event.createdAt < end,
  ).length
}

// ---- LLM V2 ----

export type EventDimensionName =
  | 'shared'
  | 'novelty'
  | 'intimacy'
  | 'emotionalIntensity'
  | 'relationshipChange'

export interface EventDimensionResult {
  value: boolean
  evidence: string[]
}

export interface EventSafeFact {
  text: string
  evidence: string[]
}

export interface EventJudgeResult {
  /** V2 */
  worthSaving?: boolean
  sensitiveDisclosure?: boolean
  dimensions?: Partial<Record<EventDimensionName, EventDimensionResult>>
  safeFacts?: EventSafeFact[]
  /** 兼容旧 parser / tests */
  isEvent: boolean
  type?: string
  title?: string
  description?: string
  occurredAt?: string
  confidence?: number
  evidence?: string
}

export function buildEventJudgeSystemPrompt(now: number): string {
  const today = localDateKey(now)
  return (
    '你是忆文 Event V2 的证据整理器。你没有“发 Event”的权力，只能整理传入 Candidate Window 中已经发生的证据。\n' +
    `今天是 ${today}。\n` +
    '目标：判断“这段互动有没有让双方的共同经历增加一块以前没有的东西”。不要求重大，但必须有变化。宁可漏，不可乱记。\n' +
    '硬规则：\n' +
    '1. 不是总结记忆，不读记忆，不根据 TA 的话、未来计划或常识补事实；只看给你的用户原话证据。不同事情绝不能拼接。\n' +
    '2. 五个维度：shared(共同性)、novelty(新鲜/第一次)、intimacy(亲密/信任)、emotionalIntensity(明显情绪强度)、relationshipChange(关系理解或状态发生变化)。\n' +
    '3. 每个 value=true 的维度必须列 evidence id；没有直接证据就必须 false。\n' +
    '4. worthSaving=true 也不代表一定写入：代码还会要求 shared=true 且其余四维至少两项有有效证据。\n' +
    '5. safeFacts 只能写证据支持的事实/过程，每条必须引用 evidence id；未发生的结局、心理、承诺一律不能补。未解决的冲突就保持未解决。\n' +
    '6. 如果包含秘密、隐私袒露、很少对别人说的内容，sensitiveDisclosure=true。safeFacts 只能写关系过程，例如“那天你第一次愿意告诉我一件以前很少提起的事”，绝不能复述秘密具体内容、数字、地址、身份信息或原句。\n' +
    '7. 普通吃饭、普通看电影、浅层开心闲聊不够；深聊/秘密/冲突修复/第一次/重要选择/明显的新理解可以。软事件至少需要持续多轮证据。\n' +
    '8. type 只能是：' + EVENT_TYPES.join('/') + '。occurredAt 用事件开始那一天的绝对日期 YYYY-MM-DD，跨午夜也不要拆成两件。\n' +
    '9. 不编造现实世界身体接触、地点、共同线下经历；没有证据就不写。\n' +
    '只输出 JSON，不要解释：' +
    '{"worthSaving":true,"isEvent":true,"type":"activity","occurredAt":"YYYY-MM-DD","confidence":0.0,"sensitiveDisclosure":false,' +
    '"dimensions":{"shared":{"value":true,"evidence":["u-..."]},"novelty":{"value":false,"evidence":[]},"intimacy":{"value":true,"evidence":["u-..."]},"emotionalIntensity":{"value":false,"evidence":[]},"relationshipChange":{"value":true,"evidence":["u-..."]}},' +
    '"safeFacts":[{"text":"只含证据支持的关系过程事实","evidence":["u-..."]}]}'
  )
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
}

function parseDimension(value: unknown): EventDimensionResult | undefined {
  if (value == null || typeof value !== 'object') return undefined
  const raw = value as { value?: unknown; evidence?: unknown }
  return { value: raw.value === true, evidence: normalizeEvidenceRefs(raw.evidence) }
}

export function parseJudgeJson(raw: string): EventJudgeResult | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) text = fenced[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const data = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    if (data == null || typeof data !== 'object') return null
    const dimensionsRaw = data.dimensions && typeof data.dimensions === 'object'
      ? (data.dimensions as Record<string, unknown>)
      : null
    const dimensions: Partial<Record<EventDimensionName, EventDimensionResult>> | undefined = dimensionsRaw
      ? {
          shared: parseDimension(dimensionsRaw.shared),
          novelty: parseDimension(dimensionsRaw.novelty),
          intimacy: parseDimension(dimensionsRaw.intimacy),
          emotionalIntensity: parseDimension(dimensionsRaw.emotionalIntensity),
          relationshipChange: parseDimension(dimensionsRaw.relationshipChange),
        }
      : undefined
    const safeFacts: EventSafeFact[] | undefined = Array.isArray(data.safeFacts)
      ? data.safeFacts
          .map((item) => {
            if (item == null || typeof item !== 'object') return null
            const fact = item as { text?: unknown; evidence?: unknown }
            const factText = typeof fact.text === 'string' ? fact.text.trim() : ''
            if (!factText) return null
            return { text: factText, evidence: normalizeEvidenceRefs(fact.evidence) }
          })
          .filter((item): item is EventSafeFact => item != null)
      : undefined
    return {
      worthSaving: data.worthSaving === true,
      isEvent: data.isEvent === true || data.worthSaving === true,
      type: typeof data.type === 'string' ? data.type : undefined,
      title: typeof data.title === 'string' ? data.title : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      occurredAt: typeof data.occurredAt === 'string' ? data.occurredAt : undefined,
      confidence: typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : undefined,
      evidence: typeof data.evidence === 'string' ? data.evidence : undefined,
      sensitiveDisclosure: data.sensitiveDisclosure === true,
      dimensions,
      safeFacts,
    }
  } catch {
    return null
  }
}

export function parseOccurredAt(str: string | undefined, _now?: number): number | null {
  if (!str || typeof str !== 'string') return null
  const t = new Date(str).getTime()
  if (!Number.isFinite(t) || t <= 0) return null
  return t
}

function compatibilityTitle(description: string): string {
  const clean = description.replace(/\s+/g, ' ').trim()
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean
}

function refsAreValid(refs: string[], allowed: Set<string>): boolean {
  return refs.length > 0 && refs.every((id) => allowed.has(id))
}

function normalizeForLeakCheck(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 敏感披露时，只要 safeFact 大段复刻用户原话就整条拒绝，宁可漏。 */
export function leaksSensitiveSource(factText: string, evidence: EventEvidenceItem[]): boolean {
  const target = normalizeForLeakCheck(factText)
  if (!target) return false
  for (const item of evidence) {
    const source = normalizeForLeakCheck(item.text)
    const chunkSize = /[\u3400-\u9fff]/u.test(source) ? 12 : 20
    if (source.length < chunkSize) continue
    for (let i = 0; i <= source.length - chunkSize; i += 1) {
      if (target.includes(source.slice(i, i + chunkSize))) return true
    }
  }
  return /\b\d{6,}\b/.test(factText) || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(factText)
}

function descriptionFromFacts(facts: EventSafeFact[]): string {
  return facts
    .map((fact) => fact.text.trim().replace(/[。；;]+$/g, ''))
    .filter(Boolean)
    .join('；')
    .concat('。')
}

/**
 * 硬过滤：
 * - 不传 evidence 时保留旧接口兼容；
 * - 生产 V2 必传 evidence，强制 shared=true + 其余四维 >=2 + 每个 true 维度有合法 evidence；
 * - safeFacts 全部要有合法 evidence；敏感披露禁止复刻原文；软事件要求至少两条不同证据且 intimacy+relationshipChange 同时成立。
 */
export function applyEventHardFilter(
  result: EventJudgeResult,
  sessionId: string | undefined,
  now: number,
  evidence?: EventEvidenceItem[],
): Parameters<typeof createEvent>[0] | null {
  if (!result || result.isEvent !== true) return null
  if (!EVENT_TYPES.includes(result.type as (typeof EVENT_TYPES)[number])) return null
  const occurredAt = parseOccurredAt(result.occurredAt, now)
  if (occurredAt == null || occurredAt > now) return null
  const confidence = result.confidence ?? 0
  if (!(confidence >= EVENT_CONFIDENCE_THRESHOLD)) return null

  // 旧调用兼容路径，不用于 processEventCandidate V2。
  if (!evidence) {
    const title = (result.title ?? '').trim()
    if (!title) return null
    return { sessionId, type: result.type as (typeof EVENT_TYPES)[number], title, occurredAt, confidence, source: 'chat' }
  }

  if (result.worthSaving !== true || !result.dimensions || !Array.isArray(result.safeFacts) || result.safeFacts.length === 0) {
    return null
  }
  const allowed = new Set(evidence.map((item) => item.id))
  const dimensions = result.dimensions
  const shared = dimensions.shared
  if (!shared?.value || !refsAreValid(shared.evidence, allowed)) return null

  const others: EventDimensionName[] = ['novelty', 'intimacy', 'emotionalIntensity', 'relationshipChange']
  const passingOthers = others.filter((name) => {
    const item = dimensions[name]
    return item?.value === true && refsAreValid(item.evidence, allowed)
  })
  if (passingOthers.length < 2) return null

  const safeFacts = result.safeFacts
    .map((fact) => ({ text: fact.text.trim().slice(0, 220), evidence: fact.evidence }))
    .filter((fact) => fact.text && refsAreValid(fact.evidence, allowed))
  if (safeFacts.length !== result.safeFacts.length || safeFacts.length === 0) return null

  const usedEvidence = new Set<string>()
  for (const fact of safeFacts) for (const id of fact.evidence) usedEvidence.add(id)

  // 软事件：不能凭一句“聊得开心”入库；至少两条证据，而且必须有亲密 + 关系变化。
  const isSoft = dimensions.novelty?.value !== true && dimensions.emotionalIntensity?.value !== true
  if (isSoft) {
    if (usedEvidence.size < 2) return null
    if (dimensions.intimacy?.value !== true || dimensions.relationshipChange?.value !== true) return null
  }

  if (result.sensitiveDisclosure && safeFacts.some((fact) => leaksSensitiveSource(fact.text, evidence))) return null

  const description = descriptionFromFacts(safeFacts)
  if (!description.trim()) return null
  return {
    sessionId,
    type: result.type as (typeof EVENT_TYPES)[number],
    title: compatibilityTitle(description),
    description,
    occurredAt,
    confidence,
    source: 'chat',
  }
}

/**
 * Chat 每条用户消息仍可调用本函数，但绝大多数调用只做免费 local tagging。
 * 只有窗口出现明确收口时才会做一次模型调用；调用前检查 key、每周自动 Event 上限与每日 judge 上限。
 */
export async function processEventCandidate(input: {
  sessionId?: string
  userText: string
  /** 仅保留旧调用兼容；V2 不把这些无时间戳历史文本当硬证据。 */
  recentUserTexts?: string[]
  now?: number
}): Promise<void> {
  try {
    const now = input.now ?? Date.now()
    const text = compactCandidateText(input.userText)
    if (!text) return

    let state = loadCandidateWindow(input.sessionId, now)
    const hasWindow = Boolean(state)
    const opensCandidate = broadCandidatePass(text)

    // 没窗口、也没有关系价值信号：0 成本退出。
    if (!hasWindow && !opensCandidate) return
    // 纯未来/不确定表达不作为新证据；已有窗口也不拿它“补结局”。
    if (isNegativeExpression(text)) return

    // 窗口开启后允许把后续用户原话继续收进证据；最多 8 条 / 3 天。
    state = appendCandidateEvidence(state, input.sessionId, text, now)
    saveCandidateWindow(state)

    // 没收口：只落 local-only 候选，0 模型调用。
    if (!shouldJudgeCandidateWindow(state, text)) return

    // 一个窗口最多一次模型调用。先清窗口，避免网络错误/重渲染导致重复烧 key。
    clearCandidateWindow(input.sessionId)

    // 自动 Event 已达到本周上限：直接不精判，不“补满”。
    if (getAutoEventCountThisWeek(input.sessionId, now) >= AUTO_EVENT_WEEKLY_LIMIT) return

    // 无 key：不消耗 judge 额度，也不报错。
    const settings = loadSettings()
    const hasKey = Boolean(settings.apiKey?.trim() && settings.baseUrl?.trim() && settings.model?.trim())
    if (!hasKey) return

    // 有 key 且确实要收口才消耗一次 judge 额度。
    if (!consumeJudgeQuota(input.sessionId, now)) return

    const raw = await chatCompletion(
      settings,
      [
        { role: 'system', content: buildEventJudgeSystemPrompt(now) },
        { role: 'user', content: buildEventWindowPrompt(state) },
      ],
      { maxTokens: 700, temperature: 0 },
    )
    const result = parseJudgeJson(raw)
    if (!result) return
    const createInput = applyEventHardFilter(result, input.sessionId, now, state.evidence)
    if (!createInput) return
    createEvent(createInput)
  } catch {
    // Event 永远不能阻塞聊天。
  }
}
