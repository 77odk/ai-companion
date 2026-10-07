import { notifyDataChanged } from './dataChange.ts'
import { getCloudStateSidecar, setCloudStateSidecar } from './cloudState.ts'
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

const KEEP = 80
const SIDECAR = 'memory_audit_v1'

function readAll(): MemoryAuditEntry[] {
  const saved = getCloudStateSidecar<MemoryAuditEntry[]>(SIDECAR)
  return Array.isArray(saved) ? [...saved] : []
}

function writeAll(entries: MemoryAuditEntry[], silent = false): boolean {
  const ok = setCloudStateSidecar(SIDECAR, entries.slice(0, KEEP))
  if (ok && !silent) notifyDataChanged()
  return ok
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
  if (!entry?.id || !entry.memoryId) return
  const all = readAll().filter((item) => item.id !== entry.id)
  writeAll([entry, ...all].sort((a, b) => b.at - a.at), true)
}

export function deleteMemoryAuditFromCloud(id: string): void {
  if (!id) return
  writeAll(readAll().filter((entry) => entry.id !== id), true)
}

