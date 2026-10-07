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

  // 只把 SELF 真正承担的承诺建档。否定句和“我觉得他/她会……”属于非承诺，
  // 不能反转成「TA 答应你的事」。
  const clauses = clean.split(/[，,。！？!?；;\n]+/).map((part) => part.trim()).filter(Boolean)
  const hasPositiveSelfCommitment = clauses.some((clause) => {
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
  })
  if (!hasPositiveSelfCommitment) return null

  const plan = parseFutureIntent(clean, new Date(sourceTs))
  const time = parseFutureTime(clean, new Date(sourceTs))
  const dueDay = plan
    ? futureDayKey(plan, new Date(sourceTs))
    : time && time.dayOffset != null
      ? localDayKeyFromOffset(sourceTs, time.dayOffset)
      : undefined
  const clock = parseClock(clean)
  const dueAt = dueAtFor(dueDay, clock)
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
  const commitment = detectTaCommitment(batchText, sid, latest.ts)
  if (!commitment) return null
  const existing = readAll().find((item) => item.id === commitment.id)
  if (existing) return existing
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

