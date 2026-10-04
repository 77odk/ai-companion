import type { Anniversary } from './anniversary.ts'
import type { ChatTopic } from './chatTopics.ts'
import type { CompanionEvent } from './eventStore.ts'
import type { InitiativePreference } from './storage.ts'

export const INITIATIVE_MIN_AWAY_MS = 2 * 60 * 60 * 1000
export const INITIATIVE_BASE_COOLDOWN_MS = 6 * 60 * 60 * 1000
export const INITIATIVE_MAX_COOLDOWN_MS = 48 * 60 * 60 * 1000

export type InitiativeReason = 'future-intent' | 'event' | 'anniversary'

export interface InitiativeCandidate {
  key: string
  reason: InitiativeReason
  evidence: string
  evidenceAt: number
  priority: number
}

export interface InitiativePolicyInput {
  preference: InitiativePreference
  lastActiveAt: number
  now: number
  futureTopics: ChatTopic[]
  events: CompanionEvent[]
  anniversaries: Anniversary[]
}

function localDayKey(ts: number): string {
  const d = new Date(ts)
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function anniversaryDayKey(a: Anniversary, now: number): string | null {
  const value = String(a?.date ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const recurring = /^(\d{2})-(\d{2})$/.exec(value)
  if (!recurring) return null
  const d = new Date(now)
  return `${d.getFullYear()}-${recurring[1]}-${recurring[2]}`
}

export function isInitiativeQuietHour(
  now: number,
  startHour: number,
  endHour: number,
): boolean {
  const hour = new Date(now).getHours()
  if (startHour === endHour) return false
  if (startHour < endHour) return hour >= startHour && hour < endHour
  return hour >= startHour || hour < endHour
}

export function initiativeCooldownMs(ignoredStreak: number): number {
  const streak = Math.max(0, Math.min(4, Math.floor(ignoredStreak || 0)))
  return Math.min(INITIATIVE_MAX_COOLDOWN_MS, INITIATIVE_BASE_COOLDOWN_MS * (2 ** streak))
}

function currentDeliveredCount(preference: InitiativePreference, today: string): number {
  return preference.deliveredDay === today ? preference.deliveredCount : 0
}

function futureIntentCandidates(
  topics: ChatTopic[],
  lastActiveAt: number,
  now: number,
): InitiativeCandidate[] {
  const today = localDayKey(now)
  const lastDay = lastActiveAt > 0 ? localDayKey(lastActiveAt) : ''
  const longEnough = now - lastActiveAt >= INITIATIVE_MIN_AWAY_MS
  const out: InitiativeCandidate[] = []
  for (const topic of Array.isArray(topics) ? topics : []) {
    if (!topic?.futureDay || !/^\d{4}-\d{2}-\d{2}$/.test(topic.futureDay)) continue
    if (topic.futureDay > today) continue
    const crossedDay = Boolean(lastDay && topic.futureDay > lastDay)
    if (!crossedDay && !(topic.futureDay === today && longEnough)) continue
    const evidence = String(topic.t ?? '').trim()
    if (!evidence) continue
    out.push({
      key: `future:${topic.futureDay}:${topic.ts}:${evidence.slice(0, 32)}`,
      reason: 'future-intent',
      evidence,
      evidenceAt: Number.isFinite(topic.ts) ? topic.ts : now,
      priority: 300,
    })
  }
  return out
}

function eventCandidates(
  events: CompanionEvent[],
  lastActiveAt: number,
  now: number,
): InitiativeCandidate[] {
  return (Array.isArray(events) ? events : [])
    .filter((event) =>
      event &&
      event.deletedAt == null &&
      Number.isFinite(event.occurredAt) &&
      event.occurredAt > lastActiveAt &&
      event.occurredAt <= now &&
      typeof event.title === 'string' &&
      event.title.trim().length > 0,
    )
    .map((event) => ({
      key: `event:${event.id}`,
      reason: 'event' as const,
      evidence: event.title.trim(),
      evidenceAt: event.occurredAt,
      priority: event.type === 'milestone' || event.type === 'celebration' ? 260 : 220,
    }))
}

function anniversaryCandidates(
  anniversaries: Anniversary[],
  lastActiveAt: number,
  now: number,
): InitiativeCandidate[] {
  const today = localDayKey(now)
  const lastDay = lastActiveAt > 0 ? localDayKey(lastActiveAt) : ''
  const crossedDay = Boolean(lastDay && lastDay !== today)
  const longEnough = now - lastActiveAt >= INITIATIVE_MIN_AWAY_MS
  if (!crossedDay && !longEnough) return []

  const out: InitiativeCandidate[] = []
  for (const anniversary of Array.isArray(anniversaries) ? anniversaries : []) {
    const day = anniversaryDayKey(anniversary, now)
    if (day !== today) continue
    const label = String(anniversary.label ?? '').trim()
    if (!label) continue
    out.push({
      key: `anniversary:${anniversary.id}:${today}`,
      reason: 'anniversary',
      evidence: label,
      evidenceAt: new Date(now).setHours(0, 0, 0, 0),
      priority: 280,
    })
  }
  return out
}

/**
 * P3-A2 候选选择：只做“有没有真实理由”的本地判定，不调用模型。
 * 没有真实 evidence / 被限频 / 夜间 / 连续不回应冷却中 → null。
 */
export function chooseInitiativeCandidate(input: InitiativePolicyInput): InitiativeCandidate | null {
  const { preference, lastActiveAt, now } = input
  if (!preference.enabled) return null
  if (!Number.isFinite(now) || now <= 0 || !Number.isFinite(lastActiveAt) || lastActiveAt <= 0) return null
  if (now <= lastActiveAt) return null

  const today = localDayKey(now)
  const lastDay = localDayKey(lastActiveAt)
  const awayMs = now - lastActiveAt
  // A2 不是“每次切回来都发”：同一天至少离开 2 小时；跨天则允许补算。
  if (awayMs < INITIATIVE_MIN_AWAY_MS && lastDay === today) return null

  if (
    isInitiativeQuietHour(now, preference.quietStartHour, preference.quietEndHour)
  ) return null

  if (currentDeliveredCount(preference, today) >= preference.dailyLimit) return null

  if (
    preference.lastDeliveredAt > 0 &&
    now - preference.lastDeliveredAt < initiativeCooldownMs(preference.ignoredStreak)
  ) return null

  const candidates = [
    ...futureIntentCandidates(input.futureTopics, lastActiveAt, now),
    ...anniversaryCandidates(input.anniversaries, lastActiveAt, now),
    ...eventCandidates(input.events, lastActiveAt, now),
  ]
    .filter((candidate) => candidate.key !== preference.lastCandidateKey)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return b.evidenceAt - a.evidenceAt
    })

  return candidates[0] ?? null
}

export function markInitiativeDelivered(
  preference: InitiativePreference,
  candidate: InitiativeCandidate,
  now: number,
): InitiativePreference {
  const day = localDayKey(now)
  const sameDay = preference.deliveredDay === day
  return {
    ...preference,
    lastDeliveredAt: now,
    deliveredDay: day,
    deliveredCount: (sameDay ? preference.deliveredCount : 0) + 1,
    lastCandidateKey: candidate.key,
  }
}

export function markInitiativeIgnored(preference: InitiativePreference): InitiativePreference {
  return {
    ...preference,
    ignoredStreak: Math.min(8, Math.max(0, preference.ignoredStreak) + 1),
  }
}

export function markInitiativeEngaged(preference: InitiativePreference): InitiativePreference {
  return {
    ...preference,
    ignoredStreak: 0,
  }
}
