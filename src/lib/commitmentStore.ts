import { notifyDataChanged } from './dataChange.ts'
import { parseFutureIntent, parseFutureTime, futureDayKey } from './futureIntent.ts'
import { getMessagesCache, getSessionsCache } from './sessionStore.ts'
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

const EN_ACTION_RE = /\b(?:remind|tell|message|text|call|send|check in|be there|stay with you|come|get back to you)\b/i
const EN_PROMISE_RE = /\b(?:i(?:['’]ll| will).{0,56}(?:remind|tell|message|text|call|send|check in|be there|stay with you|come|get back to you)|i promise\b)/i
const EN_NEGATED_RE = /\b(?:i won['’]t|i will not|i can['’]t|i cannot|i don['’]t plan to|i(?:['’]m| am) not going to)\b/i
const EN_THIRD_PARTY_RE = /\bi\s+(?:think|guess|believe|heard|feel).{0,30}\b(?:he|she|they|someone|the other person)\b/i

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

function parseClock(text: string): { hour: number; minute: number; raw: string } | null {
  const m = String(text ?? '').match(/(?:上午|早上|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})(?::|：|点)(\d{1,2})?\s*(?:分)?/)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
  const prefix = m[0]
  if (/下午|傍晚|晚上|今晚/.test(prefix) && hour < 12) hour += 12
  if (/中午/.test(prefix) && hour < 11) hour += 12
  if (/上午|早上/.test(prefix) && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null
  return { hour, minute, raw: m[0].trim() }
}

function parseEnglishClock(text: string): { hour: number; minute: number; raw: string } | null {
  const m = String(text ?? '').match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
  const meridiem = (m[3] ?? '').toLowerCase()
  if (meridiem.startsWith('p') && hour < 12) hour += 12
  if (meridiem.startsWith('a') && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null
  return { hour, minute, raw: m[0].trim() }
}

function englishFutureDay(text: string, sourceTs: number): { day?: string; when?: string } {
  const lower = String(text ?? '').toLowerCase()
  if (/\b(?:the day after tomorrow|in two days)\b/.test(lower)) {
    return { day: localDayKeyFromOffset(sourceTs, 2), when: 'the day after tomorrow' }
  }
  if (/\btomorrow\b/.test(lower)) {
    return { day: localDayKeyFromOffset(sourceTs, 1), when: 'tomorrow' }
  }
  if (/\b(?:today|tonight|this evening|this morning|this afternoon)\b/.test(lower)) {
    return { day: localDayKey(sourceTs), when: lower.match(/\b(?:today|tonight|this evening|this morning|this afternoon)\b/)?.[0] }
  }
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
  const weekday = lower.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (weekday) {
    const target = weekdays.indexOf(weekday[1])
    const current = new Date(sourceTs)
    let offset = (target - current.getDay() + 7) % 7
    if (offset === 0 || /^next\s+/i.test(weekday[0])) offset += 7
    return { day: localDayKeyFromOffset(sourceTs, offset), when: weekday[0] }
  }
  return {}
}

function positivePromiseClause(clause: string): boolean {
  const clean = clause.trim()
  if (!clean) return false
  if (ZH_PROMISE_RE.test(clean)) {
    if (ZH_NEGATED_SELF_ACTION_RE.test(clean) || ZH_THIRD_PARTY_ACTOR_RE.test(clean)) return false
    const action = clean.match(ZH_SELF_ACTION_RE)
    if (!action || action.index == null) {
      return /(?:我(?:一定会|保证|答应你|答应|记得|到时候会)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i.test(clean)
    }
    const beforeAction = clean.slice(0, action.index)
    if (!beforeAction.includes('我')) return false
    if (/(?:他|她|TA|ta|对方|别人).{0,8}$/.test(beforeAction)) return false
    return true
  }
  if (!EN_PROMISE_RE.test(clean) || EN_NEGATED_RE.test(clean) || EN_THIRD_PARTY_RE.test(clean)) return false
  return /\bi promise\b/i.test(clean) || EN_ACTION_RE.test(clean)
}

function splitPromiseClauses(text: string): string[] {
  const parts = String(text ?? '')
    .split(/[。！？!?；;\n]+|\.(?=\s|$)|[，,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const out: string[] = []
  let pendingTime = ''
  for (const part of parts) {
    const normalized = part.replace(/\s+/g, ' ').trim()
    const chineseTimeOnly = /^(?:(?:今天|明天|后天|今晚|明早|明晚|周[一二三四五六日天]|星期[一二三四五六日天]|下周[一二三四五六日天])(?:\s*(?:上午|早上|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:(?::|：|点)\d{0,2})?\s*(?:分)?)?|(?:上午|早上|中午|下午|傍晚|晚上)?\s*\d{1,2}(?:(?::|：|点)\d{0,2})?\s*(?:分)?)$/i.test(normalized)
    const englishTimeOnly = /^(?:(?:tomorrow|today|tonight|this evening|this morning|this afternoon|the day after tomorrow|in two days|(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)?|at\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)$/i.test(normalized)
    const timeOnly = chineseTimeOnly || englishTimeOnly
    if (!positivePromiseClause(part) && timeOnly) {
      pendingTime = part
      continue
    }
    const candidate = pendingTime && positivePromiseClause(part) ? `${pendingTime} ${part}` : part
    pendingTime = ''
    if (positivePromiseClause(candidate)) out.push(candidate)
  }
  return out
}

function timingForClause(clause: string, sourceTs: number): {
  dueDay?: string
  dueAt?: number
  dueText?: string
} {
  const plan = parseFutureIntent(clause, new Date(sourceTs))
  const time = parseFutureTime(clause, new Date(sourceTs))
  const en = englishFutureDay(clause, sourceTs)
  const dueDay = plan
    ? futureDayKey(plan, new Date(sourceTs))
    : time && time.dayOffset != null
      ? localDayKeyFromOffset(sourceTs, time.dayOffset)
      : en.day
  const clock = parseClock(clause) ?? parseEnglishClock(clause)
  const dueAt = dueAtFor(dueDay, clock)
  const dueText = [plan?.when ?? time?.when ?? en.when, clock?.raw].filter(Boolean).join(' ').trim() || undefined
  return {
    ...(dueDay ? { dueDay } : {}),
    ...(typeof dueAt === 'number' ? { dueAt } : {}),
    ...(dueText ? { dueText } : {}),
  }
}

function dueAtFor(day: string | undefined, clock: { hour: number; minute: number } | null): number | undefined {
  if (!day || !clock) return undefined
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const d = new Date(parts[0], parts[1] - 1, parts[2], clock.hour, clock.minute, 0, 0)
  const ts = d.getTime()
  return Number.isFinite(ts) ? ts : undefined
}

export function detectTaCommitments(
  text: string,
  sessionId: string,
  sourceTs: number,
  sourceMessageId?: number,
): TaCommitment[] {
  const clean = String(text ?? '').replace(/[\t\f\v ]+/g, ' ').trim()
  if (!clean) return []
  const clauses = splitPromiseClauses(clean)
  if (clauses.length === 0) return []
  const base = typeof sourceMessageId === 'number' ? `m${sourceMessageId}` : `t${sourceTs}`
  return clauses.map((clause, index) => {
    const timing = timingForClause(clause, sourceTs)
    const suffix = clauses.length > 1 ? `-c${index + 1}` : ''
    return {
      id: `promise-${sessionId}-${base}${suffix}`,
      sessionId,
      ...(typeof sourceMessageId === 'number' ? { sourceMessageId } : {}),
      sourceTs,
      text: clause.slice(0, 280),
      ...timing,
      createdAt: Date.now(),
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
  let first: TaCommitment | null = null
  for (const commitment of detected) {
    const already = existing.find((item) => item.id === commitment.id)
    if (already) {
      if (!first) first = already
      continue
    }
    if (saveTaCommitment(commitment) && !first) first = commitment
  }
  return first
}

export function deleteTaCommitmentsForSession(sessionId: string): boolean {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return false
  const all = readAll()
  const next = all.filter((item) => item.sessionId !== sid)
  if (next.length === all.length) return true
  // notifyDataChanged 让既有 Cloud State capture 产生 ta_commitment tombstone；不另开删除接口。
  return writeAll(next)
}


function existingSessionIds(): Set<string> {
  return new Set(getSessionsCache().map((session) => String(session.id)))
}

export function collectDueTaCommitments(now = Date.now()): TaCommitment[] {
  const today = localDayKey(now)
  const sessions = existingSessionIds()
  return readAll().filter((item) => {
    if (!sessions.has(item.sessionId) || item.remindedAt) return false
    if (typeof item.dueAt === 'number') return item.dueAt <= now
    if (item.dueDay) return item.dueDay <= today
    return false
  })
}

export function nextTaCommitmentCheckAt(now = Date.now()): number | null {
  let next: number | null = null
  const sessions = existingSessionIds()
  for (const item of readAll()) {
    if (!sessions.has(item.sessionId)) continue
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

