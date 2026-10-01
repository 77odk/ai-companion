// 自定义角色创建的临时 persona 修复事务。
//
// repair 元数据绑定到角色自己的 ai_profile_<sessionId> 本地资料；
// 不新增 storage key、不改 sessions cache 的账号隔离语义，也不上传 Cloud State。
// pending = persona 尚未确认完整，UI/路由必须隐藏；repaired = 已修好，供旧标签页复用同一创建事务。

import { needsPersonaPersistenceRepair } from './customPersona.ts'
import { patchSession, type Session } from './sessionApi.ts'
import {
  clearLocalPersonaRepair,
  loadLocalPersonaRepair,
  saveLocalPersonaRepair,
  type LocalPersonaRepair,
} from './storage.ts'
import { getSessionsCache } from './sessionStore.ts'

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

function repairForSession(session: Session, account: string): PendingPersonaRepair | null {
  const marker = loadLocalPersonaRepair(String(session.id))
  if (!marker || marker.account !== account) return null
  return {
    account: marker.account,
    id: session.id,
    persona: marker.persona,
    title: marker.title,
    transactionId: marker.transactionId,
  }
}

function findRepairSession(
  sessions: Session[],
  account: string,
  transactionId?: string,
  state?: LocalPersonaRepair['state'],
): { session: Session; marker: LocalPersonaRepair; repair: PendingPersonaRepair } | null {
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const marker = loadLocalPersonaRepair(String(session.id))
    if (!marker || marker.account !== account) continue
    if (transactionId && marker.transactionId !== transactionId) continue
    if (state && marker.state !== state) continue
    const repair = repairForSession(session, account)
    if (repair) return { session, marker, repair }
  }
  return null
}

export function newPersonaRepairTransactionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `persona_repair_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function readPendingPersonaRepair(
  account: string,
  sessions: Session[] = getSessionsCache(),
): PendingPersonaRepair | null {
  return findRepairSession(sessions, account, undefined, 'pending')?.repair ?? null
}

/** PATCH 前记录当前创建事务；跟 session 自己走，不碰全局会话缓存。 */
export function writePendingPersonaRepair(
  session: Session,
  value: Omit<PendingPersonaRepair, 'id'>,
): void {
  saveLocalPersonaRepair(String(session.id), {
    account: value.account,
    persona: value.persona,
    title: value.title,
    transactionId: value.transactionId,
    state: 'pending',
  })
}

/** 修好后保留 completed transaction，旧标签页拿同 transactionId 时直接复用，避免重复 POST。 */
export function rememberCompletedPersonaRepair(
  session: Session,
  value: PendingPersonaRepair,
): void {
  saveLocalPersonaRepair(String(session.id), {
    account: value.account,
    persona: value.persona,
    title: value.title,
    transactionId: value.transactionId,
    state: 'repaired',
  })
}

export function clearPendingPersonaRepair(account: string, id?: number): void {
  for (const session of getSessionsCache()) {
    if (id != null && session.id !== id) continue
    const marker = loadLocalPersonaRepair(String(session.id))
    if (!marker || marker.account !== account) continue
    clearLocalPersonaRepair(String(session.id))
  }
}

/** 当前账号 pending 角色在事务完成前不能进入正常 UI / Chat。其它账号不会出现在当前 server sessions 中。 */
export function filterPendingPersonaRepairSession(sessions: Session[], account: string): Session[] {
  return (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const marker = loadLocalPersonaRepair(String(session.id))
    return !(marker?.account === account && marker.state === 'pending')
  })
}

/**
 * sessions cache 保持原语义：只缓存当前账号 server sessions。
 * repair 元数据独立保存在 session 级 ai_profile 里，所以这里不再混入跨账号条目。
 */
export function preservePendingPersonaRepairInCache(sessions: Session[], _account: string): Session[] {
  return Array.isArray(sessions) ? sessions : []
}

/**
 * 尝试修复当前账号尚未确认完整的人设。
 * transactionId 用于仍停留在旧创建页的标签：
 * 若另一个标签已修好同一事务，直接返回 repaired session，绝不再 POST。
 */
export async function attemptPendingPersonaRepair(
  token: string,
  account: string,
  transactionId?: string,
  sessions: Session[] = getSessionsCache(),
): Promise<PendingPersonaRepairAttempt> {
  if (transactionId) {
    const completed = findRepairSession(sessions, account, transactionId, 'repaired')
    if (completed) {
      return { kind: 'repaired', pending: completed.repair, session: completed.session }
    }
  }

  let pendingMatch = transactionId
    ? findRepairSession(sessions, account, transactionId, 'pending')
    : findRepairSession(sessions, account, undefined, 'pending')
  // 新标签页 / 重载后的创建页会生成新的 transactionId；若账号下仍有旧 pending，先修它，不能再 POST。
  if (!pendingMatch && transactionId) {
    pendingMatch = findRepairSession(sessions, account, undefined, 'pending')
  }
  if (!pendingMatch) return { kind: 'none' }

  const { session, repair: pending } = pendingMatch
  const repaired = await patchSession(token, pending.id, {
    persona: pending.persona,
    title: pending.title,
  })
  if (!repaired.ok) {
    if (repaired.status === 404) {
      clearLocalPersonaRepair(String(session.id), pending.transactionId)
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

  rememberCompletedPersonaRepair(repaired.data, pending)
  return { kind: 'repaired', pending, session: repaired.data }
}
