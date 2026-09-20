import { notifyDataChanged } from './dataChange.ts'
import type { Lang } from './langDetect.ts'

export type ReplyLength = 'short' | 'medium' | 'long'
export type ReplyLengthOverride = ReplyLength | null

/** 账号级默认。用户没设置过时也保持原先定稿：默认短。 */
export const DEFAULT_GLOBAL_REPLY_LENGTH: ReplyLength = 'short'

const GLOBAL_KEY_PREFIX = 'ai_companion_reply_length_global_'
const OVERRIDE_KEY_PREFIX = 'ai_companion_reply_length_override_'

function globalStorageKey(accountId: string): string {
  return `${GLOBAL_KEY_PREFIX}${encodeURIComponent(accountId.trim())}`
}

function overrideStorageKey(accountId: string, sessionId: string): string {
  return `${OVERRIDE_KEY_PREFIX}${encodeURIComponent(accountId.trim())}_${encodeURIComponent(sessionId.trim())}`
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return value === 'short' || value === 'medium' || value === 'long'
}

export function getStoredGlobalReplyLength(accountId: string): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  if (!account) return null
  try {
    const raw = localStorage.getItem(globalStorageKey(account))
    return isReplyLength(raw) ? raw : null
  } catch {
    return null
  }
}

export function getGlobalReplyLength(accountId: string): ReplyLength {
  return getStoredGlobalReplyLength(accountId) ?? DEFAULT_GLOBAL_REPLY_LENGTH
}

export function saveGlobalReplyLength(accountId: string, value: ReplyLength): boolean {
  const account = String(accountId ?? '').trim()
  if (!account || !isReplyLength(value)) return false
  try {
    const key = globalStorageKey(account)
    localStorage.setItem(key, value)
    const ok = localStorage.getItem(key) === value
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

export function applyGlobalReplyLengthFromCloud(accountId: string, payload: unknown): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  if (!account || payload == null || typeof payload !== 'object') return null
  const mode = (payload as { mode?: unknown }).mode
  if (!isReplyLength(mode)) return null
  try {
    localStorage.setItem(globalStorageKey(account), mode)
    return mode
  } catch {
    return null
  }
}

export function deleteGlobalReplyLengthFromCloud(accountId: string): void {
  const account = String(accountId ?? '').trim()
  if (!account) return
  try {
    localStorage.removeItem(globalStorageKey(account))
  } catch {
    // Cloud replay must remain non-fatal.
  }
}

export function getReplyLengthOverride(accountId: string, sessionId: string): ReplyLengthOverride {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return null
  try {
    const raw = localStorage.getItem(overrideStorageKey(account, sid))
    return isReplyLength(raw) ? raw : null
  } catch {
    return null
  }
}

export function saveReplyLengthOverride(accountId: string, sessionId: string, value: ReplyLength): boolean {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid || !isReplyLength(value)) return false
  try {
    const key = overrideStorageKey(account, sid)
    localStorage.setItem(key, value)
    const ok = localStorage.getItem(key) === value
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

/** “跟随全局”就是删除 override，不复制一份当前 global。 */
export function clearReplyLengthOverride(accountId: string, sessionId: string): void {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return
  try {
    localStorage.removeItem(overrideStorageKey(account, sid))
    notifyDataChanged()
  } catch {
    // Keep chat usable even when storage is unavailable.
  }
}

export function getEffectiveReplyLength(accountId: string, sessionId: string): ReplyLength {
  return getReplyLengthOverride(accountId, sessionId) ?? getGlobalReplyLength(accountId)
}

export function applyReplyLengthOverrideFromCloud(
  accountId: string,
  sessionId: string,
  payload: unknown,
): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid || payload == null || typeof payload !== 'object') return null
  const mode = (payload as { mode?: unknown }).mode
  if (!isReplyLength(mode)) return null
  try {
    localStorage.setItem(overrideStorageKey(account, sid), mode)
    return mode
  } catch {
    return null
  }
}

export function deleteReplyLengthOverrideFromCloud(accountId: string, sessionId: string): void {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return
  try {
    localStorage.removeItem(overrideStorageKey(account, sid))
  } catch {
    // Cloud replay must remain non-fatal.
  }
}

export function collectStoredReplyLengthOverrides(
  accountId: string,
  sessionIds: string[],
): Map<string, ReplyLength> {
  const out = new Map<string, ReplyLength>()
  const account = String(accountId ?? '').trim()
  if (!account) return out
  for (const raw of sessionIds) {
    const sid = String(raw ?? '').trim()
    if (!sid) continue
    const value = getReplyLengthOverride(account, sid)
    if (value) out.set(sid, value)
  }
  return out
}

export function replyLengthLabel(value: ReplyLength): string {
  if (value === 'short') return '短'
  if (value === 'long') return '长'
  return '中'
}

export function buildReplyLengthInstruction(value: ReplyLength, lang: Lang = 'zh'): string {
  if (lang === 'en') {
    if (value === 'short') {
      return '[Reply length] Keep this reply short: usually 1–2 concise sentences. Do not omit an important fact just to be brief.'
    }
    if (value === 'long') {
      return '[Reply length] Prefer a longer reply when the topic supports it: usually around 4–7 sentences. Stay natural; do not pad or repeat.'
    }
    return '[Reply length] Use a medium reply: usually 2–4 sentences. Be complete and natural without turning it into an essay.'
  }
  if (value === 'short') {
    return '【回复长度】尽量短：通常 1–2 句，直接自然；不要为了变短漏掉关键事实。'
  }
  if (value === 'long') {
    return '【回复长度】偏长：话题需要时通常 4–7 句，可以展开一点；保持自然，不灌水、不重复。'
  }
  return '【回复长度】中等：通常 2–4 句，信息完整、自然，不写成小作文。'
}
