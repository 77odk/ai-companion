import { notifyDataChanged } from './dataChange.ts'

const DEFAULT_ROLE_PREFIX = 'ai_companion_default_role_'

function storageKey(accountId: string): string {
  return `${DEFAULT_ROLE_PREFIX}${encodeURIComponent(accountId.trim())}`
}

export function getDefaultRoleId(accountId?: string | null): string {
  const account = String(accountId ?? '').trim()
  if (!account) return ''
  try {
    return (localStorage.getItem(storageKey(account)) ?? '').trim()
  } catch {
    return ''
  }
}

export function setDefaultRoleId(accountId: string, sessionId: string): boolean {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return false
  try {
    localStorage.setItem(storageKey(account), sid)
    const ok = localStorage.getItem(storageKey(account)) === sid
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

export function clearDefaultRoleId(accountId: string): void {
  const account = String(accountId ?? '').trim()
  if (!account) return
  try {
    localStorage.removeItem(storageKey(account))
    notifyDataChanged()
  } catch {
    // Keep role management usable even if storage is unavailable.
  }
}

export function applyDefaultRoleFromCloud(accountId: string, payload: unknown): string {
  const account = String(accountId ?? '').trim()
  if (!account || payload == null || typeof payload !== 'object') return ''
  const raw = (payload as { sessionId?: unknown }).sessionId
  const sid = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
  if (!sid) return ''
  try {
    localStorage.setItem(storageKey(account), sid)
    return sid
  } catch {
    return ''
  }
}

export function deleteDefaultRoleFromCloud(accountId: string): void {
  const account = String(accountId ?? '').trim()
  if (!account) return
  try {
    localStorage.removeItem(storageKey(account))
  } catch {
    // Cloud replay must remain non-fatal.
  }
}
