import { notifyDataChanged } from './dataChange.ts'
import type { Lang } from './langDetect.ts'

export type ReplyLength = 'short' | 'medium' | 'long'

export const DEFAULT_REPLY_LENGTH: ReplyLength = 'medium'
const KEY_PREFIX = 'ai_companion_reply_length_'

function storageKey(accountId: string, sessionId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(accountId.trim())}_${encodeURIComponent(sessionId.trim())}`
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return value === 'short' || value === 'medium' || value === 'long'
}

export function getStoredReplyLength(accountId: string, sessionId: string): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return null
  try {
    const raw = localStorage.getItem(storageKey(account, sid))
    return isReplyLength(raw) ? raw : null
  } catch {
    return null
  }
}

export function getReplyLength(accountId: string, sessionId: string): ReplyLength {
  return getStoredReplyLength(accountId, sessionId) ?? DEFAULT_REPLY_LENGTH
}

export function saveReplyLength(accountId: string, sessionId: string, value: ReplyLength): boolean {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid || !isReplyLength(value)) return false
  try {
    const key = storageKey(account, sid)
    localStorage.setItem(key, value)
    const ok = localStorage.getItem(key) === value
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

export function clearReplyLength(accountId: string, sessionId: string): void {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return
  try {
    localStorage.removeItem(storageKey(account, sid))
    notifyDataChanged()
  } catch {
    // Keep role/chat flows usable even when localStorage is unavailable.
  }
}

export function applyReplyLengthFromCloud(accountId: string, sessionId: string, payload: unknown): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid || payload == null || typeof payload !== 'object') return null
  const mode = (payload as { mode?: unknown }).mode
  if (!isReplyLength(mode)) return null
  try {
    localStorage.setItem(storageKey(account, sid), mode)
    return mode
  } catch {
    return null
  }
}

export function deleteReplyLengthFromCloud(accountId: string, sessionId: string): void {
  const account = String(accountId ?? '').trim()
  const sid = String(sessionId ?? '').trim()
  if (!account || !sid) return
  try {
    localStorage.removeItem(storageKey(account, sid))
  } catch {
    // Cloud replay must remain non-fatal.
  }
}

export function collectStoredReplyLengths(
  accountId: string,
  sessionIds: string[],
): Map<string, ReplyLength> {
  const out = new Map<string, ReplyLength>()
  const account = String(accountId ?? '').trim()
  if (!account) return out
  for (const raw of sessionIds) {
    const sid = String(raw ?? '').trim()
    if (!sid) continue
    const value = getStoredReplyLength(account, sid)
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
      return '[Reply length] This TA is set to longer replies. When the topic supports it, answer more fully, usually around 4–7 sentences. Stay natural and do not pad or repeat.'
    }
    return '[Reply length] Use a medium reply: usually 2–4 sentences. Be complete, natural, and avoid turning it into an essay.'
  }
  if (value === 'short') {
    return '【回复长度】这次尽量短：通常 1–2 句，直接自然；不要为了变短漏掉关键事实。'
  }
  if (value === 'long') {
    return '【回复长度】这个 TA 设为偏长回复：话题需要时可以更完整地展开，通常 4–7 句；保持自然，不灌水、不重复。'
  }
  return '【回复长度】保持中等：通常 2–4 句，信息完整、自然，不写成小作文。'
}
