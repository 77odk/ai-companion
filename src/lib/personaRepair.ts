// 自定义角色创建的临时 persona 修复事务。
//
// 只保存当前浏览器 tab 生命周期内的恢复信息（sessionStorage），用于处理：
// POST /api/sessions 已成功，但返回 persona 为空/截断，后续 PATCH 尚未确认成功。
// 这不是产品数据，不进 localStorage / Cloud State；正常角色仍以后端 session 为权威。

import { needsPersonaPersistenceRepair } from './customPersona.ts'
import { patchSession, type Session } from './sessionApi.ts'

const PENDING_PERSONA_REPAIR_KEY = 'ai_companion_pending_persona_repair_session'

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

export function readPendingPersonaRepair(account: string): PendingPersonaRepair | null {
  if (!account) return null
  try {
    const raw = sessionStorage.getItem(PENDING_PERSONA_REPAIR_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingPersonaRepair>
    if (
      parsed.account !== account ||
      typeof parsed.id !== 'number' ||
      !Number.isFinite(parsed.id) ||
      typeof parsed.persona !== 'string' ||
      typeof parsed.title !== 'string'
    ) return null
    return parsed as PendingPersonaRepair
  } catch {
    return null
  }
}

export function writePendingPersonaRepair(value: PendingPersonaRepair): void {
  try {
    sessionStorage.setItem(PENDING_PERSONA_REPAIR_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage 不可用时，本轮 PATCH 仍照常执行；不让临时恢复标记打断创建流程。
  }
}

export function clearPendingPersonaRepair(account: string, id?: number): void {
  try {
    const current = readPendingPersonaRepair(account)
    if (!current) return
    if (id != null && current.id !== id) return
    sessionStorage.removeItem(PENDING_PERSONA_REPAIR_KEY)
  } catch {
    // ignore
  }
}

/** 待修复角色在事务完成前不能出现在正常角色列表/路由候选里。 */
export function filterPendingPersonaRepairSession(sessions: Session[], account: string): Session[] {
  const pending = readPendingPersonaRepair(account)
  if (!pending) return Array.isArray(sessions) ? sessions : []
  return (Array.isArray(sessions) ? sessions : []).filter((session) => session.id !== pending.id)
}

/**
 * 尝试修复当前账号尚未确认完整的人设。
 * - 404：session 已不存在，清掉过期事务标记；
 * - PATCH 成功且 persona 完整：清标记并返回修好的 session；
 * - 其它失败/仍不完整：保留标记，调用方必须把该 session 排除在正常路由之外。
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
      clearPendingPersonaRepair(account, pending.id)
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

  clearPendingPersonaRepair(account, pending.id)
  return { kind: 'repaired', pending, session: repaired.data }
}
