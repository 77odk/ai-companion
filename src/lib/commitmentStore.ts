import { notifyDataChanged } from './dataChange.ts'
import { parseFutureTime } from './futureIntent.ts'
import { getMessagesCache } from './sessionStore.ts'
import { getCloudStateSidecar, setCloudStateSidecar } from './cloudState.ts'

export interface TaCommitment {
  id: string
  sessionId: string
  sourceMessageId?: number
  sourceTs: number
  text: string
  dueDay?: string
  dueAt?: number
  dueText?: string
  createdAt: number
  remindedAt?: number
}

const KEEP = 120
const SIDECAR = 'ta_commitment_v1'

const ZH_PROMISE_RE = /(?:我(?:会|一定会|保证|答应你|答应|记得|到时候会)|我.{0,14}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i
const ZH_SELF_ACTION_RE = /(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i
const ZH_NEGATED_SELF_ACTION_RE = /我.{0,10}(?:不能|不会|不想|不打算|没法|没办法|无法|不方便).{0,12}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i
const ZH_THIRD_PARTY_ACTOR_RE = /我.{0,8}(?:觉得|认为|猜|估计|听说|感觉).{0,10}(?:他|她|TA|ta|对方|别人).{0,10}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i

const EN_SELF_ACTION = '(?:remind|wake|call|message|text|tell|send|come|go|check|help|stay|join|bring|give|meet|accompany|be\\s+there)'
const EN_PROMISE_RE = new RegExp(
  `(?:\\bi(?:['’]ll|\\s+will)\\s+${EN_SELF_ACTION}\\b|\\bi\\s+(?:promise|swear|guarantee)(?:\\s+you)?\\b|\\bi\\s+won['’]t\\s+forget(?:\\s+to)?\\b|\\bi(?:['’]ll|\\s+will)\\s+remember(?:\\s+to)?\\b|\\bleave\\s+it\\s+to\\s+me\\b)`,
  'i',
)
const EN_NEGATED_SELF_ACTION_RE = new RegExp(
  `\\bi\\s+(?:can['’]?t|cannot|won['’]?t|will\\s+not|don['’]?t|do\\s+not|am\\s+not\\s+going\\s+to)\\s+(?:\\w+\\s+){0,5}${EN_SELF_ACTION}\\b`,
  'i',
)
const EN_THIRD_PARTY_ACTOR_RE = /\bi\s+(?:think|believe|guess|suppose|feel|heard?)\s+(?:that\s+)?(?:he|she|they|someone|somebody)\b/i

function readAll(): TaCommitment[] {
  const saved = getCloudStateSidecar<TaCommitment[]>(SIDECAR)
  return Array.isArray(saved) ? [...saved] : []
}

function writeAll(list: TaCommitment[], silent = false): boolean {
  const ok = setCloudStateSidecar(SIDECAR, list.slice(0, KEEP))
  if (ok && !silent) notifyDataChanged()
  return ok
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function localDayKeyFromOffset(ts: number, dayOffset: number): string {
  const d = new Date(ts)
  d.setDate(d.getDate() + dayOffset)
  return localDayKey(d.getTime())
}

function localMidnight(day: string): number | undefined {
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const ts = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0).getTime()
  return Number.isFinite(ts) ? ts : undefined
}

interface ClockHit {
  hour: number
  minute: number
  raw: string
}

function parseClock(text: string): ClockHit | null {
  const source = String(text ?? '')
  const zh = source.match(/(?:上午|早上|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})(?::|：|点)(\d{1,2})?\s*(?:分)?/)
  if (zh) {
    let hour = Number(zh[1])
    const minute = zh[2] ? Number(zh[2]) : 0
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
    const prefix = zh[0]
    if (/下午|傍晚|晚上|今晚/.test(prefix) && hour < 12) hour += 12
    if (/中午/.test(prefix) && hour < 11) hour += 12
    if (/上午|早上/.test(prefix) && hour === 12) hour = 0
    if (hour < 0 || hour > 23) return null
    return { hour, minute, raw: zh[0].trim() }
  }

  const en = source.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i)
    ?? source.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i)
  if (!en) return null
  let hour = Number(en[1])
  const minute = en[2] ? Number(en[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 23) return null
  const marker = String(en[3] ?? '').toLowerCase().replace(/\./g, '')
  if (marker === 'pm' && hour < 12) hour += 12
  if (marker === 'am' && hour === 12) hour = 0
  if (!marker && /\b(?:afternoon|evening|tonight)\b/i.test(source) && hour < 12) hour += 12
  return { hour, minute, raw: en[0].trim() }
}

function dueAtFor(day: string | undefined, clock: ClockHit | null): number | undefined {
  if (!day || !clock) return undefined
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const d = new Date(parts[0], parts[1] - 1, parts[2], clock.hour, clock.minute, 0, 0)
  const ts = d.getTime()
  return Number.isFinite(ts) ? ts : undefined
}

interface FutureHit {
  when: string
  dayOffset: number
}

const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function parseEnglishFutureTime(text: string, now: Date): FutureHit | null {
  const source = String(text ?? '')
  let match = source.match(/\b(the\s+day\s+after\s+tomorrow|tomorrow|tonight|today)\b/i)
  if (match) {
    const token = match[1].toLowerCase()
    return {
      when: match[0],
      dayOffset: token.includes('day after') ? 2 : token === 'tomorrow' ? 1 : 0,
    }
  }

  match = source.match(/\bin\s+(\d{1,2})\s+days?\b/i)
  if (match) {
    const days = Number(match[1])
    if (Number.isFinite(days) && days >= 0 && days <= 60) return { when: match[0], dayOffset: days }
  }

  match = source.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i)
  if (match) {
    const target = EN_WEEKDAYS[match[2].toLowerCase()]
    let diff = target - now.getDay()
    if (diff <= 0) diff += 7
    if (match[1]) diff += 7
    return { when: match[0], dayOffset: diff }
  }

  match = source.match(/\bnext\s+week\b/i)
  if (match) return { when: match[0], dayOffset: 7 }

  return null
}

function parseDue(text: string, sourceTs: number): { dueDay?: string; dueAt?: number; dueText?: string } {
  const now = new Date(sourceTs)
  const zhTime = parseFutureTime(text, now)
  const enTime = parseEnglishFutureTime(text, now)
  const time = zhTime
    ? { when: zhTime.when, dayOffset: zhTime.dayOffset ?? 0 }
    : enTime
  const dueDay = time ? localDayKeyFromOffset(sourceTs, time.dayOffset) : undefined
  const clock = parseClock(text)
  const dueAt = dueAtFor(dueDay, clock)
  const dueText = [time?.when, clock?.raw].filter(Boolean).join(' ').trim() || undefined
  return {
    ...(dueDay ? { dueDay } : {}),
    ...(typeof dueAt === 'number' ? { dueAt } : {}),
    ...(dueText ? { dueText } : {}),
  }
}

function hasFutureAnchor(text: string, sourceTs: number): boolean {
  return Boolean(parseFutureTime(text, new Date(sourceTs)) || parseEnglishFutureTime(text, new Date(sourceTs)))
}

function isPositiveSelfCommitmentClause(clause: string): boolean {
  const clean = clause.trim()
  if (!clean) return false

  if (ZH_PROMISE_RE.test(clean)) {
    if (ZH_NEGATED_SELF_ACTION_RE.test(clean)) return false
    if (ZH_THIRD_PARTY_ACTOR_RE.test(clean)) return false
    const action = clean.match(ZH_SELF_ACTION_RE)
    if (!action || action.index == null) {
      return /(?:我(?:一定会|保证|答应你|答应|记得|到时候会)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i.test(clean)
    }
    const beforeAction = clean.slice(0, action.index)
    if (!beforeAction.includes('我')) return false
    if (/(?:他|她|TA|ta|对方|别人).{0,8}$/.test(beforeAction)) return false
    return true
  }

  if (!EN_PROMISE_RE.test(clean)) return false
  // “I won't forget to …”是正向承诺；除此之外的明确否定不能反转成承诺。
  if (!/\bi\s+won['’]t\s+forget\b/i.test(clean) && EN_NEGATED_SELF_ACTION_RE.test(clean)) return false
  if (EN_THIRD_PARTY_ACTOR_RE.test(clean)) return false
  return true
}

interface CommitmentClause {
  text: string
  index: number
}

function positiveCommitmentClauses(text: string, sourceTs: number): CommitmentClause[] {
  const clean = String(text ?? '').replace(/[\t\r]+/g, ' ').trim()
  if (!clean) return []

  const result: CommitmentClause[] = []
  let index = 0
  const sentences = clean.split(/[。！？!?；;\n]+/).map((part) => part.trim()).filter(Boolean)
  for (const sentence of sentences) {
    const commaParts = sentence.split(/[，,]+/).map((part) => part.trim()).filter(Boolean)
    for (let i = 0; i < commaParts.length; i += 1) {
      const clause = commaParts[i]
      if (!isPositiveSelfCommitmentClause(clause)) continue

      let scoped = clause
      // 英文常写 “Tomorrow at 8, I'll remind you …”。只有当前承诺段本身没有时间，
      // 且紧邻前段只是时间上下文时才合并；不会把别人的“明天 8 点考试”借给后面的后天承诺。
      if (!hasFutureAnchor(clause, sourceTs) && i > 0) {
        const previous = commaParts[i - 1]
        if (
          previous.length <= 48
          && hasFutureAnchor(previous, sourceTs)
          && !isPositiveSelfCommitmentClause(previous)
          && !/(?:你|他|她|they|he|she)\b/i.test(previous)
        ) {
          scoped = `${previous}, ${clause}`
        }
      }
      result.push({ text: scoped.replace(/\s+/g, ' ').trim(), index })
      index += 1
    }
  }
  return result
}

function stableClauseHash(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function detectTaCommitments(
  text: string,
  sessionId: string,
  sourceTs: number,
  sourceMessageId?: number,
): TaCommitment[] {
  const sid = String(sessionId ?? '').trim()
  if (!sid || !Number.isFinite(sourceTs)) return []
  const clauses = positiveCommitmentClauses(text, sourceTs)
  if (clauses.length === 0) return []

  const base = typeof sourceMessageId === 'number' ? `m${sourceMessageId}` : `t${sourceTs}`
  const createdAt = Date.now()
  return clauses.map((clause) => {
    const due = parseDue(clause.text, sourceTs)
    return {
      id: `promise-${sid}-${base}-${stableClauseHash(clause.text)}`,
      sessionId: sid,
      ...(typeof sourceMessageId === 'number' ? { sourceMessageId } : {}),
      sourceTs,
      text: clause.text.slice(0, 280),
      ...due,
      createdAt,
    }
  })
}

export function detectTaCommitment(
  text: string,
  sessionId: string,
  sourceTs: number,
  sourceMessageId?: number,
): TaCommitment | null {
  return detectTaCommitments(text, sessionId, sourceTs, sourceMessageId)[0] ?? null
}

export function loadTaCommitments(sessionId?: string): TaCommitment[] {
  const sid = String(sessionId ?? '')
  return readAll()
    .filter((item) => !sid || item.sessionId === sid)
    .sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || b.createdAt - a.createdAt)
}

export function saveTaCommitment(item: TaCommitment): boolean {
  if (!item?.id || !item.sessionId || !item.text) return false
  const all = readAll().filter((entry) => entry.id !== item.id)
  return writeAll([item, ...all])
}

export function captureLatestTaCommitment(sessionId: string): TaCommitment | null {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return null
  const messages = getMessagesCache(sid)
  const latest = [...messages].reverse().find((message) => (
    message.role === 'assistant'
    && message.replyState !== 'interrupted'
    && message.content.trim()
  ))
  if (!latest) return null

  // 同一轮被拆成多个 assistant bubble 时，它们共享 assistantTs。
  // 按每个正向承诺子句分别建档：多个承诺不能互相借错时间，也不能只留下第一条。
  const batch = messages.filter((message) => (
    message.role === 'assistant'
    && message.replyState !== 'interrupted'
    && message.ts === latest.ts
    && message.content.trim()
  ))
  const batchText = batch.map((message) => message.content.trim()).join('\n')
  const detected = detectTaCommitments(batchText, sid, latest.ts)
  if (detected.length === 0) return null

  const existing = readAll()
  const existingIds = new Set(existing.map((item) => item.id))
  const fresh = detected.filter((item) => !existingIds.has(item.id))
  if (fresh.length > 0 && !writeAll([...fresh, ...existing])) return null
  return detected[0]
}

export function collectDueTaCommitments(now = Date.now()): TaCommitment[] {
  const today = localDayKey(now)
  return readAll().filter((item) => {
    if (item.remindedAt) return false
    if (typeof item.dueAt === 'number') return item.dueAt <= now
    if (item.dueDay) return item.dueDay <= today
    return false
  })
}

export function nextTaCommitmentCheckAt(now = Date.now()): number | null {
  let next: number | null = null
  for (const item of readAll()) {
    if (item.remindedAt) continue
    const candidate = typeof item.dueAt === 'number'
      ? item.dueAt
      : item.dueDay
        ? localMidnight(item.dueDay)
        : undefined
    if (typeof candidate !== 'number' || candidate <= now) continue
    if (next == null || candidate < next) next = candidate
  }
  return next
}

export function markCommitmentReminded(id: string, at = Date.now()): TaCommitment | null {
  const all = readAll()
  const index = all.findIndex((item) => item.id === id)
  if (index < 0) return null
  const next = { ...all[index], remindedAt: at }
  all[index] = next
  return writeAll(all) ? next : null
}

export function removeTaCommitmentsForSession(sessionId: string): number {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return 0
  const current = readAll()
  const next = current.filter((item) => item.sessionId !== sid)
  const removed = current.length - next.length
  if (removed > 0) writeAll(next)
  return removed
}

export function collectAllTaCommitments(): TaCommitment[] {
  return readAll()
}

export function upsertTaCommitmentFromCloud(item: TaCommitment): void {
  if (!item?.id || !item.sessionId || !item.text) return
  const current = readAll()
  const local = current.find((entry) => entry.id === item.id)
  // pull 总在 push 前：本机刚标记“已提醒”但 pending 还没上传时，
  // 旧云端 canonical 不能把 remindedAt 擦掉，否则同一承诺会再次弹。
  const remindedAt = Math.max(local?.remindedAt ?? 0, item.remindedAt ?? 0) || undefined
  const merged = remindedAt ? { ...item, remindedAt } : item
  writeAll([merged, ...current.filter((entry) => entry.id !== item.id)], true)
}

export function deleteTaCommitmentFromCloud(id: string): void {
  if (!id) return
  writeAll(readAll().filter((entry) => entry.id !== id), true)
}
