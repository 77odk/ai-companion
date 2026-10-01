// 自定义角色创建的临时 persona 修复事务。
//
// 不新增 storage key：直接复用现有 sessions cache，在创建事务对应的 session 上挂仅本地字段。
// 该字段不会发送给后端 / Cloud State；服务端 session 仍是权威数据。
// pending = persona 尚未确认完整，UI/路由必须隐藏；repaired = 已修好，但保留事务 id 供旧标签页复用。

import { needsPersonaPersistenceRepair } from './customPersona.ts'
import { patchSession, type Session } from './sessionApi.ts'
import { getSessionsCache, setSessionsCache } from './sessionStore.ts'

type PersonaRepairState = 'pending' | 'repaired'

interface PersonaRepairMarker {
  account: string
  persona: string
  title: string
  transactionId: string
  state: PersonaRepairState
}

type RepairCachedSession = Session & {
  /** 仅本地 sessions cache 使用；不得上传后端/Cloud State。 */
  __personaRepair?: PersonaRepairMarker
}

export interface PendingPersonaRepair {
  account: string
  id: number
  persona: string
  title: string
  transactionId: string
}

export type PendingPersonaRepairAttempt =
  | { kind: 'none' }
  | { kind: 'missing'; pending: PendingPersonaRepair }
  | { kind: 'repaired'; pending: PendingPersonaRepair; session: Session }
  | { kind: 'blocked'; pending: PendingPersonaRepair; status?: number; message: string }

function markerOf(session: Session): PersonaRepairMarker | null {
  const marker = (session as RepairCachedSession).__personaRepair
  if (
    !marker ||
    typeof marker.account !== 'string' ||
    typeof marker.persona !== 'string' ||
    typeof marker.title !== 'string' ||
    typeof marker.transactionId !== 'string' ||
    (marker.state !== 'pending' && marker.state !== 'repaired')
  ) return null
  return marker
}

function repairCachedSessions(): RepairCachedSession[] {
  return getSessionsCache().filter((session): session is RepairCachedSession => markerOf(session) !== null)
}

function toRepair(session: RepairCachedSession): PendingPersonaRepair | null {
  const marker = markerOf(session)
  if (!marker) return null
  return {
    account: marker.account,
    id: session.id,
    persona: marker.persona,
    title: marker.title,
    transactionId: marker.transactionId,
  }
}

function findRepairTransaction(
  account: string,
  transactionId: string,
): { session: RepairCachedSession; marker: PersonaRepairMarker; repair: PendingPersonaRepair } | null {
  if (!account || !transactionId) return null
  for (const session of repairCachedSessions()) {
    const marker = markerOf(session)
    const repair = toRepair(session)
    if (marker && repair && marker.account === account && marker.transactionId === transactionId) {
      return { session, marker, repair }
    }
  }
  return null
}

function replaceRepairSession(
  session: Session,
  marker: PersonaRepairMarker,
): RepairCachedSession {
  const marked: RepairCachedSession = { ...session, __personaRepair: marker }
  const current = getSessionsCache()
  setSessionsCache([
    ...current.filter((item) => {
      if (String(item.id) !== String(session.id)) return true
      const existingMarker = markerOf(item)
      return Boolean(existingMarker && existingMarker.account !== marker.account)
    }),
    marked,
  ])
  return marked
}

export function newPersonaRepairTransactionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `persona_repair_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function readPendingPersonaRepair(account: string): PendingPersonaRepair | null {
  if (!account) return null
  for (const session of repairCachedSessions()) {
    const marker = markerOf(session)
    const repair = toRepair(session)
    if (marker?.account === account && marker.state === 'pending' && repair) return repair
  }
  return null
}

/**
 * 把“尚未确认 persona 完整”的 server session 放进现有 sessions cache，并挂仅本地 repair 标记。
 * 必须发生在 PATCH 前，这样刷新、关标签页、换标签页或切账号都不会失去修复目标。
 */
export function writePendingPersonaRepair(
  session: Session,
  value: Omit<PendingPersonaRepair, 'id'>,
): Session {
  return replaceRepairSession(session, {
    account: value.account,
    persona: value.persona,
    title: value.title,
    transactionId: value.transactionId,
    state: 'pending',
  })
}

/**
 * persona 已确认完整后仍保留“repaired transaction”标记。
 * 正常 UI 会显示该 session；只有持有同 transactionId 的旧标签页会复用它，避免再次 POST。
 */
export function rememberCompletedPersonaRepair(
  session: Session,
  value: PendingPersonaRepair,
): Session {
  return replaceRepairSession(session, {
    account: value.account,
    persona: value.persona,
    title: value.title,
    transactionId: value.transactionId,
    state: 'repaired',
  })
}

/** 显式清理某账号的 repair 元数据；保留 session 本体。 */
export function clearPendingPersonaRepair(account: string, id?: number): void {
  const next = getSessionsCache().map((session) => {
    const marker = markerOf(session)
    if (!marker || marker.account !== account) return session
    if (id != null && session.id !== id) return session
    const { __personaRepair: _discard, ...clean } = session as RepairCachedSession
    return clean as Session
  })
  setSessionsCache(next)
}

/** server 已确认该 session 不存在时，只移除对应账号的 repair 占位。 */
function removePersonaRepairSession(account: string, id: number): void {
  setSessionsCache(
    getSessionsCache().filter((session) => {
      if (session.id !== id) return true
      return markerOf(session)?.account !== account
    }),
  )
}

/**
 * 正常 UI / 路由可见列表：
 * - 当前账号 pending：隐藏；
 * - 当前账号 repaired：可见；
 * - 其它账号的 repair 条目：永远隐藏，防账号串数据。
 */
export function filterPendingPersonaRepairSession(sessions: Session[], account: string): Session[] {
  const currentMarkers = new Map<number, PersonaRepairMarker>()
  for (const session of repairCachedSessions()) {
    const marker = markerOf(session)
    if (marker?.account === account) currentMarkers.set(session.id, marker)
  }

  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const ownMarker = markerOf(session)
    if (ownMarker) {
      if (ownMarker.account !== account) return false
      return ownMarker.state !== 'pending'
    }
    return currentMarkers.get(session.id)?.state !== 'pending'
  })
}

/**
 * server sessions 刷新/本地角色变更时保留所有账号的 repair transaction：
 * - 当前账号：用最新 server session 数据 + 本地 marker；
 * - 其它账号：原样保留 marker 条目，但由 filterPendingPersonaRepairSession 对当前账号隐藏。
 */
export function preservePendingPersonaRepairInCache(sessions: Session[], account: string): Session[] {
  const repairs = repairCachedSessions()
  if (repairs.length === 0) return Array.isArray(sessions) ? sessions : []

  const currentRepairs = repairs.filter((session) => markerOf(session)?.account === account)
  const foreignRepairs = repairs.filter((session) => markerOf(session)?.account !== account)
  const currentById = new Map(currentRepairs.map((session) => [session.id, session]))
  const source = (Array.isArray(sessions) ? sessions : []).filter((session) => markerOf(session) === null)

  const merged = source.map((session) => {
    const cached = currentById.get(session.id)
    const marker = cached ? markerOf(cached) : null
    return marker ? ({ ...session, __personaRepair: marker } as RepairCachedSession) : session
  })

  const sourceIds = new Set(source.map((session) => session.id))
  const missingCurrent = currentRepairs.filter((session) => !sourceIds.has(session.id))
  return [...merged, ...missingCurrent, ...foreignRepairs]
}

/**
 * 尝试修复当前账号尚未确认完整的人设。
 * transactionId 用于旧标签页：若别的标签页已经修好同一事务，直接返回 repaired session，不再 PATCH/POST。
 */
export async function attemptPendingPersonaRepair(
  token: string,
  account: string,
  transactionId?: string,
): Promise<PendingPersonaRepairAttempt> {
  if (transactionId) {
    const transaction = findRepairTransaction(account, transactionId)
    if (transaction?.marker.state === 'repaired') {
      return { kind: 'repaired', pending: transaction.repair, session: transaction.session }
    }
  }

  const pending = transactionId
    ? findRepairTransaction(account, transactionId)?.repair ?? readPendingPersonaRepair(account)
    : readPendingPersonaRepair(account)
  if (!pending) return { kind: 'none' }

  const repaired = await patchSession(token, pending.id, {
    persona: pending.persona,
    title: pending.title,
  })
  if (!repaired.ok) {
    if (repaired.status === 404) {
      removePersonaRepairSession(account, pending.id)
      return { kind: 'missing', pending }
    }
    return {
      kind: 'blocked',
      pending,
      status: repaired.status,
      message: repaired.message,
    }
  }

  if (needsPersonaPersistenceRepair(pending.persona, repaired.data.persona)) {
    return {
      kind: 'blocked',
      pending,
      message: '角色人设仍未完整保存',
    }
  }

  const completed = rememberCompletedPersonaRepair(repaired.data, pending)
  return { kind: 'repaired', pending, session: completed }
}
