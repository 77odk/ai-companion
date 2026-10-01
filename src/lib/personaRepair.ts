// 自定义角色创建的临时 persona 修复事务。
//
// 不新增 storage key：直接复用现有 sessions cache，在未完成 session 上挂一个仅本地字段。
// 该字段不会发送给后端 / Cloud State；服务端 session 仍是权威数据。
// 目的：POST 已成功但 persona 补写尚未确认时，跨刷新 / 关标签页 / 多标签仍能识别并先修复。

import { needsPersonaPersistenceRepair } from './customPersona.ts'
import { patchSession, type Session } from './sessionApi.ts'
import { getSessionsCache, setSessionsCache } from './sessionStore.ts'

interface PersonaRepairMarker {
  account: string
  persona: string
  title: string
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
}

export type PendingPersonaRepairAttempt =
  | { kind: 'none' }
  | { kind: 'missing'; pending: PendingPersonaRepair }
  | { kind: 'repaired'; pending: PendingPersonaRepair; session: Session }
  | { kind: 'blocked'; pending: PendingPersonaRepair; status?: number; message: string }

function pendingCachedSessions(account: string): RepairCachedSession[] {
  if (!account) return []
  return getSessionsCache().filter((session): session is RepairCachedSession => {
    const marker = (session as RepairCachedSession).__personaRepair
    return Boolean(
      marker &&
      marker.account === account &&
      typeof marker.persona === 'string' &&
      typeof marker.title === 'string',
    )
  })
}

export function readPendingPersonaRepair(account: string): PendingPersonaRepair | null {
  const session = pendingCachedSessions(account)[0]
  const marker = session?.__personaRepair
  if (!session || !marker) return null
  return {
    account: marker.account,
    id: session.id,
    persona: marker.persona,
    title: marker.title,
  }
}

/**
 * 把“尚未确认 persona 完整”的 server session 放进现有 sessions cache，并挂仅本地 repair 标记。
 * 这一步必须发生在 PATCH 前，这样即使刷新、关标签页或另一个标签页打开，也不会失去修复目标。
 */
export function writePendingPersonaRepair(
  session: Session,
  value: Omit<PendingPersonaRepair, 'id'>,
): void {
  const marked: RepairCachedSession = {
    ...session,
    __personaRepair: {
      account: value.account,
      persona: value.persona,
      title: value.title,
    },
  }
  setSessionsCache([
    ...getSessionsCache().filter((item) => String(item.id) !== String(session.id)),
    marked,
  ])
}

/** 修复完成后只清本地标记，保留 session；后续 server 返回会覆盖成干净对象。 */
export function clearPendingPersonaRepair(account: string, id?: number): void {
  const next = getSessionsCache().map((session) => {
    const repair = (session as RepairCachedSession).__personaRepair
    if (!repair || repair.account !== account) return session
    if (id != null && session.id !== id) return session
    const { __personaRepair: _discard, ...clean } = session as RepairCachedSession
    return clean as Session
  })
  setSessionsCache(next)
}

/** server 已确认该 session 不存在时，把对应本地 repair 占位一起清掉。 */
function removePendingPersonaRepairSession(account: string, id: number): void {
  setSessionsCache(
    getSessionsCache().filter((session) => {
      const repair = (session as RepairCachedSession).__personaRepair
      return !(session.id === id && repair?.account === account)
    }),
  )
}

/** 待修复角色在事务完成前不能出现在正常角色列表/路由候选里。 */
export function filterPendingPersonaRepairSession(sessions: Session[], account: string): Session[] {
  const pendingIds = new Set(pendingCachedSessions(account).map((session) => session.id))
  if (pendingIds.size === 0) return Array.isArray(sessions) ? sessions : []
  return (Array.isArray(sessions) ? sessions : []).filter((session) => !pendingIds.has(session.id))
}

/**
 * 刷新 server sessions 时保留本地 repair 占位，避免 listSessions 覆盖掉恢复事务。
 * UI / 路由仍应使用 filterPendingPersonaRepairSession 后的可见列表。
 */
export function preservePendingPersonaRepairInCache(sessions: Session[], account: string): Session[] {
  const pending = pendingCachedSessions(account)
  if (pending.length === 0) return Array.isArray(sessions) ? sessions : []
  const pendingIds = new Set(pending.map((session) => session.id))
  return [
    ...(Array.isArray(sessions) ? sessions : []).filter((session) => !pendingIds.has(session.id)),
    ...pending,
  ]
}

/**
 * 尝试修复当前账号尚未确认完整的人设。
 * - 404：session 已不存在，清掉本地 repair 占位；
 * - PATCH 成功且 persona 完整：用修好的 server session 覆盖本地占位并清标记；
 * - 其它失败/仍不完整：保留占位，调用方必须把该 session 排除在正常路由之外。
 */
export async function attemptPendingPersonaRepair(
  token: string,
  account: string,
): Promise<PendingPersonaRepairAttempt> {
  const pending = readPendingPersonaRepair(account)
  if (!pending) return { kind: 'none' }

  const repaired = await patchSession(token, pending.id, {
    persona: pending.persona,
    title: pending.title,
  })
  if (!repaired.ok) {
    if (repaired.status === 404) {
      removePendingPersonaRepairSession(account, pending.id)
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

  setSessionsCache([
    ...getSessionsCache().filter((session) => String(session.id) !== String(pending.id)),
    repaired.data,
  ])
  return { kind: 'repaired', pending, session: repaired.data }
}
