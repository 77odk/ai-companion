import { notifyDataChanged } from './dataChange.ts'
import { parseFutureIntent, parseFutureTime, futureDayKey } from './futureIntent.ts'
import { getMessagesCache } from './sessionStore.ts'

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

const KEY = 'ai_companion_ta_commitments_v1'
const CAPTURE_KEY = 'ai_companion_ta_commitment_last_seen_v1'
const KEEP = 120

const PROMISE_RE = /(?:我(?:会|一定会|保证|答应你|答应|记得|到时候会)|我.{0,14}(?:会|提醒你|叫你|陪你|告诉你|发给你)|放心.{0,8}我会|这事交给我|我不会忘|我记着)/i

function readAll(): TaCommitment[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is TaCommitment => (
      item != null
      && typeof item.id === 'string'
      && typeof item.sessionId === 'string'
      && typeof item.sourceTs === 'number'
      && Number.isFinite(item.sourceTs)
      && typeof item.text === 'string'
      && typeof item.createdAt === 'number'
      && Number.isFinite(item.createdAt)
    ))
  } catch {
    return []
  }
}

function writeAll(list: TaCommitment[], silent = false): boolean {
  const payload = JSON.stringify(list.slice(0, KEEP))
  try {
    localStorage.setItem(KEY, payload)
    if (!silent) notifyDataChanged()
    return localStorage.getItem(KEY) === payload
  } catch {
    return false
  }
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

function dueAtFor(day: string | undefined, clock: { hour: number; minute: number } | null): number | undefined {
  if (!day || !clock) return undefined
  const parts = day.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const d = new Date(parts[0], parts[1] - 1, parts[2], clock.hour, clock.minute, 0, 0)
  const ts = d.getTime()
  return Number.isFinite(ts) ? ts : undefined
}

export function detectTaCommitment(
  text: string,
  sessionId: string,
  sourceTs: number,
  sourceMessageId?: number,
): TaCommitment | null {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!clean || !PROMISE_RE.test(clean)) return null

  const plan = parseFutureIntent(clean, new Date(sourceTs))
  const time = parseFutureTime(clean, new Date(sourceTs))
  const dueDay = plan
    ? futureDayKey(plan, new Date(sourceTs))
    : time && time.dayOffset != null
      ? localDayKeyFromOffset(sourceTs, time.dayOffset)
      : undefined
  const clock = parseClock(clean)
  const dueAt = dueAtFor(dueDay, clock)

  // A promise can be filed without an exact clock. In that case the app
  // reminds on the first active check of the due day, rather than inventing a time.
  const dueText = [plan?.when ?? time?.when, clock?.raw].filter(Boolean).join(' ').trim() || undefined
  const base = typeof sourceMessageId === 'number' ? `m${sourceMessageId}` : `t${sourceTs}`

  return {
    id: `promise-${sessionId}-${base}`,
    sessionId,
    ...(typeof sourceMessageId === 'number' ? { sourceMessageId } : {}),
    sourceTs,
    text: clean.slice(0, 280),
    ...(dueDay ? { dueDay } : {}),
    ...(typeof dueAt === 'number' ? { dueAt } : {}),
    ...(dueText ? { dueText } : {}),
    createdAt: Date.now(),
  }
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
  const latest = [...getMessagesCache(sid)].reverse().find((message) => message.role === 'assistant' && message.content.trim())
  if (!latest) return null

  const fingerprint = `${sid}:${latest.id ?? latest.ts}:${latest.ts}`
  try {
    const seen = JSON.parse(localStorage.getItem(CAPTURE_KEY) ?? '{}') as Record<string, string>
    if (seen[sid] === fingerprint) return null
    seen[sid] = fingerprint
    localStorage.setItem(CAPTURE_KEY, JSON.stringify(seen))
  } catch {
    // Failure to persist the dedupe cursor must not block chat.
  }

  const commitment = detectTaCommitment(latest.content, sid, latest.ts, typeof latest.id === 'number' ? latest.id : undefined)
  if (!commitment) return null
  return saveTaCommitment(commitment) ? commitment : null
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
  const all = readAll().filter((entry) => entry.id !== item.id)
  writeAll([item, ...all], true)
}

export function deleteTaCommitmentFromCloud(id: string): void {
  if (!id) return
  writeAll(readAll().filter((entry) => entry.id !== id), true)
}
