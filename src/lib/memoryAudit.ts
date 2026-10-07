import { notifyDataChanged } from './dataChange.ts'
import { getAccount } from './sync.ts'
import type { MemoryItem } from './memory.ts'

export type MemoryAuditKind = 'global' | 'session'
export type MemoryAuditAction = 'create' | 'edit' | 'delete' | 'rollback'

export interface MemoryAuditEntry {
  id: string
  sessionId: string
  memoryKind: MemoryAuditKind
  memoryId: string
  action: MemoryAuditAction
  at: number
  before?: MemoryItem
  after?: MemoryItem
  source?: 'manual-message' | 'detail' | 'rollback'
  parentAuditId?: string
}

const KEEP = 240
const byAccount = new Map<string, MemoryAuditEntry[]>()

function accountId(): string {
  return getAccount()?.account.trim() ?? ''
}

function readAll(): MemoryAuditEntry[] {
  const account = accountId()
  if (!account) return []
  return [...(byAccount.get(account) ?? [])]
}

function writeAll(entries: MemoryAuditEntry[], silent = false): boolean {
  const account = accountId()
  if (!account) return false
  byAccount.set(account, entries.slice(0, KEEP))
  if (!silent) notifyDataChanged()
  return true
}

export function loadMemoryAudit(sessionId?: string): MemoryAuditEntry[] {
  const sid = String(sessionId ?? '')
  return readAll()
    .filter((entry) => entry.memoryKind === 'global' || entry.sessionId === sid)
    .sort((a, b) => b.at - a.at)
}

export function appendMemoryAudit(
  entry: Omit<MemoryAuditEntry, 'id' | 'at'> & Partial<Pick<MemoryAuditEntry, 'id' | 'at'>>,
): MemoryAuditEntry | null {
  if (!accountId()) return null
  const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : Date.now()
  const id = entry.id?.trim() || `mem-audit-${at}-${Math.random().toString(36).slice(2, 8)}`
  const next: MemoryAuditEntry = {
    ...entry,
    id,
    at,
    sessionId: String(entry.sessionId ?? ''),
    memoryId: String(entry.memoryId ?? ''),
  }
  if (!next.memoryId) return null
  const all = readAll().filter((item) => item.id !== id)
  return writeAll([next, ...all]) ? next : null
}

export function collectAllMemoryAudit(): MemoryAuditEntry[] {
  return readAll()
}

export function upsertMemoryAuditFromCloud(entry: MemoryAuditEntry): void {
  if (!entry?.id || !entry.memoryId || !accountId()) return
  const all = readAll().filter((item) => item.id !== entry.id)
  writeAll([entry, ...all].sort((a, b) => b.at - a.at), true)
}

export function deleteMemoryAuditFromCloud(id: string): void {
  if (!id || !accountId()) return
  writeAll(readAll().filter((entry) => entry.id !== id), true)
}

export function resetMemoryAuditRuntime(): void {
  const account = accountId()
  if (account) byAccount.delete(account)
}
