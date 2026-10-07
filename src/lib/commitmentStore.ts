import { notifyDataChanged } from './dataChange.ts'
import { parseFutureIntent, parseFutureTime, futureDayKey } from './futureIntent.ts'
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
const PROMISE_RE = /(?:我(?:会|一定会|保证|答应你|答应|记得|到时候会)|我.{0,14}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i
const SELF_ACTION_RE = /(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i
const NEGATED_SELF_ACTION_RE = /我.{0,10}(?:不能|不会|不想|不打算|没法|没办法|无法|不方便).{0,12}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i
const THIRD_PARTY_ACTOR_RE = /我.{0,8}(?:觉得|认为|猜|估计|听说|感觉).{0,10}(?:他|她|TA|ta|对方|别人).{0,10}(?:提醒你|叫你|陪你|告诉你|发给你|来找你|去找你|给你)/i
const EN_PROMISE_RE = /\b(?:i(?:'ll|’ll| will)\s+(?:remind|call|text|message|tell|send|come|meet|join|help|check|wake|follow\s+up|be\s+there|stay\s+with|keep\s+you\s+company)|i\s+promise(?:\s+you)?(?:\s+that)?\s+i(?:'ll|’ll| will)|i\s+promise\s+to\s+(?:remind|call|text|message|tell|send|come|meet|join|help|check|wake|follow\s+up)|i\s+won't\s+forget\s+to\s+(?:remind|call|text|message|tell|send|come|meet|join|help|check|wake|follow\s+up))\b/i
const EN_NEGATED_SELF_ACTION_RE = /\bi\s+(?:can't|cannot|won't|will\s+not|don't\s+plan\s+to|do\s+not\s+plan\s+to|am\s+not\s+going\s+to)\s+(?:remind|call|text|message|tell|send|come|meet|join|help|check|wake|follow\s+up|be\s+there|stay\s+with|keep\s+you\s+company)\b/i
const EN_WONT_FORGET_RE = /\bi\s+won't\s+forget\s+to\s+(?:remind|call|text|message|tell|send|come|meet|join|help|check|wake|follow\s+up)\b/i

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
  const rawText = String(text ?? '')
  const zh = rawText.match(/(?:上午|早上|中午|下午|傍晚|晚上|今晚)?\s*(\d{1,2})(?::|：|点)(\d{1,2})?\s*(?:分)?/)
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

  const en = rawText.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i)
  if (!en || (!en[2] && !en[3] && !/^at\s+/i.test(en[0]))) return null
  let hour = Number(en[1])
  const minute = en[2] ? Number(en[2]) : 0
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
  const meridiem = String(en[3] ?? '').toLowerCase().replace(/\./g, '')
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour < 0 || hour > 23) return null
  return { hour, minute, raw: en[0].trim() }
}

function dueAtFor(day: string | undefined, clock: { hour: number; minute: number } | null): number | undefined {
  if (!day || !clock) return undefined
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const d = new Date(parts[0], parts[1] - 1, parts[2], clock.hour, clock.minute, 0, 0)
  const ts = d.getTime()
  return Number.isFinite(ts) ? ts : undefined
}

function splitCommitmentClauses(text: string): string[] {
  return String(text ?? '')
    .replace(/\b(?:and|then)\s+(?=i(?:'ll|’ll| will| promise)\b)/gi, '\n')
    .replace(/(?:然后|而且|另外)(?=我(?:会|一定会|保证|答应你|答应|记得|到时候会))/g, '\n')
    .split(/[，,。！？!?；;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function isPositiveChineseCommitment(clause: string): boolean {
  if (!PROMISE_RE.test(clause)) return false
  if (NEGATED_SELF_ACTION_RE.test(clause)) return false
  if (THIRD_PARTY_ACTOR_RE.test(clause)) return false

  const action = clause.match(SELF_ACTION_RE)
  if (!action || action.index == null) {
    return /(?:我(?:一定会|保证|答应你|答应|记得|到时候会)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i.test(clause)
  }
  const beforeAction = clause.slice(0, action.index)
  if (!beforeAction.includes('我')) return false
  if (/(?:他|她|TA|ta|对方|别人).{0,8}$/.test(beforeAction)) return false
  return true
}

function isPositiveEnglishCommitment(clause: string): boolean {
  if (!EN_PROMISE_RE.test(clause)) return false
  if (EN_WONT_FORGET_RE.test(clause)) return true
  return !EN_NEGATED_SELF_ACTION_RE.test(clause)
}

function parseEnglishFutureTime(
  text: string,
  now: Date,
): { when: string; dayOffset: number | null } | null {
  const raw = String(text ?? '')
  let match = raw.match(/\bday\s+after\s+tomorrow\b/i)
  if (match) return { when: match[0], dayOffset: 2 }
  match = raw.match(/\btomorrow\b/i)
  if (match) return { when: match[0], dayOffset: 1 }
  match = raw.match(/\b(?:tonight|today|later\s+today|this\s+evening)\b/i)
  if (match) return { when: match[0], dayOffset: 0 }
  match = raw.match(/\bin\s+(\d{1,2})\s+days?\b/i)
  if (match) {
    const days = Number(match[1])
    if (Number.isFinite(days) && days >= 0 && days <= 60) return { when: match[0], dayOffset: days }
  }

  const weekdays: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  }
  match = raw.match(/\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (match) {
    const target = weekdays[match[1].toLowerCase()]
    let diff = target - now.getDay()
    if (diff <= 0) diff += 7
    return { when: match[0], dayOffset: diff }
  }
  return null
}

export function detectTaCommitments(
  text: string,
  sessionId: string,
  sourceTs: number,
  sourceMessageId?: number,
): TaCommitment[] {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const matched = splitCommitmentClauses(clean)
    .map((clause, index) => ({ clause, index }))
    .filter(({ clause }) => isPositiveChineseCommitment(clause) || isPositiveEnglishCommitment(clause))
  if (matched.length === 0) return []

  const base = typeof sourceMessageId === 'number' ? `m${sourceMessageId}` : `t${sourceTs}`
  const now = new Date(sourceTs)
  return matched.map(({ clause, index }) => {
    const plan = parseFutureIntent(clause, now)
    const time = parseFutureTime(clause, now) ?? parseEnglishFutureTime(clause, now)
    const dueDay = plan
      ? futureDayKey(plan, now)
      : time && time.dayOffset != null
        ? localDayKeyFromOffset(sourceTs, time.dayOffset)
        : undefined
    const clock = parseClock(clause)
    const dueAt = dueAtFor(dueDay, clock)
    const dueText = [plan?.when ?? time?.when, clock?.raw].filter(Boolean).join(' ').trim() || undefined
    const suffix = matched.length > 1 ? `-c${index + 1}` : ''

    return {
      id: `promise-${sessionId}-${base}${suffix}`,
      sessionId,
      ...(typeof sourceMessageId === 'number' ? { sourceMessageId } : {}),
      sourceTs,
      text: clause.slice(0, 280),
      ...(dueDay ? { dueDay } : {}),
      ...(typeof dueAt === 'number' ? { dueAt } : {}),
      ...(dueText ? { dueText } : {}),
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

  // 同一轮被拆成多个 assistant bubble 时，它们共享 assistantTs。
  // 必须检查整批，而不是只看最后一泡，否则“承诺 + 晚安”会漏掉前面的承诺。
  const batch = messages.filter((message) => (
    message.role === 'assistant'
    && message.replyState !== 'interrupted'
    && message.ts === latest.ts
    && message.content.trim()
  ))
  const batchText = batch.map((message) => message.content.trim()).join('\n')
  const commitments = detectTaCommitments(batchText, sid, latest.ts)
  if (commitments.length === 0) return null

  let first: TaCommitment | null = null
  for (const commitment of commitments) {
    const existing = readAll().find((item) => item.id === commitment.id)
    const stored = existing ?? (saveTaCommitment(commitment) ? commitment : null)
    if (!first && stored) first = stored
  }
  return first
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

export function collectAllTaCommitments(): TaCommitment[] {
  return readAll()
}

export function removeTaCommitmentsForSession(sessionId: string): number {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return 0
  const current = readAll()
  const next = current.filter((item) => item.sessionId !== sid)
  const removed = current.length - next.length
  if (removed <= 0) return 0
  return writeAll(next) ? removed : 0
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

