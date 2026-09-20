// Reply length preference (per TA / per session).
// Default stays "medium" so existing users keep the current behavior.
// Local value is durable on-device; Cloud State adapter syncs it across devices.

import { notifyDataChanged } from './dataChange.ts'

export type ReplyLength = 'short' | 'medium' | 'long'

export const DEFAULT_REPLY_LENGTH: ReplyLength = 'medium'
const KEY_PREFIX = 'ai_companion_reply_length_'

function storageKey(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return value === 'short' || value === 'medium' || value === 'long'
}

export function getReplyLength(sessionId?: string | null): ReplyLength {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return DEFAULT_REPLY_LENGTH
  try {
    const raw = localStorage.getItem(storageKey(sid))
    return isReplyLength(raw) ? raw : DEFAULT_REPLY_LENGTH
  } catch {
    return DEFAULT_REPLY_LENGTH
  }
}

export function saveReplyLength(sessionId: string, value: ReplyLength): boolean {
  const sid = String(sessionId ?? '').trim()
  if (!sid || !isReplyLength(value)) return false
  try {
    localStorage.setItem(storageKey(sid), value)
    const ok = localStorage.getItem(storageKey(sid)) === value
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

export function removeReplyLength(sessionId: string): void {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return
  try {
    localStorage.removeItem(storageKey(sid))
    notifyDataChanged()
  } catch {
    // localStorage unavailable: keep the default behavior silently.
  }
}

export function collectReplyLengths(sessionIds: string[]): Map<string, ReplyLength> {
  const out = new Map<string, ReplyLength>()
  for (const rawId of sessionIds) {
    const sid = String(rawId ?? '').trim()
    if (!sid) continue
    try {
      const raw = localStorage.getItem(storageKey(sid))
      if (isReplyLength(raw)) out.set(sid, raw)
    } catch {
      // Ignore unreadable local state; it must not block other roles.
    }
  }
  return out
}

export function applyReplyLengthFromCloud(sessionId: string, payload: unknown): void {
  const sid = String(sessionId ?? '').trim()
  if (!sid || payload == null || typeof payload !== 'object') return
  const mode = (payload as { mode?: unknown }).mode
  if (!isReplyLength(mode)) return
  try {
    localStorage.setItem(storageKey(sid), mode)
  } catch {
    // Cloud replay must remain non-fatal when storage is unavailable.
  }
}

export function deleteReplyLengthFromCloud(sessionId: string): void {
  const sid = String(sessionId ?? '').trim()
  if (!sid) return
  try {
    localStorage.removeItem(storageKey(sid))
  } catch {
    // Keep replay non-fatal.
  }
}

export function replyLengthLabel(value: ReplyLength): string {
  if (value === 'short') return '短'
  if (value === 'long') return '长'
  return '中'
}

export function replyLengthMaxBubbleChars(value: ReplyLength): number {
  if (value === 'short') return 42
  if (value === 'long') return 90
  return 60
}

export function buildReplyLengthInstruction(value: ReplyLength, lang: 'zh' | 'en' = 'zh'): string {
  if (lang === 'en') {
    if (value === 'short') {
      return '[Reply length] Short. Usually answer in 1–2 concise sentences. Prefer 1–2 chat bubbles. Do not omit an important fact just to stay short.'
    }
    if (value === 'long') {
      return '[Reply length] Long. You may explain more fully, usually around 4–7 sentences when the topic supports it. Split naturally into several chat bubbles, but do not repeat or pad.'
    }
    return '[Reply length] Medium. Usually answer in 2–4 sentences and 1–3 natural chat bubbles. Be complete without turning it into an essay.'
  }
  if (value === 'short') {
    return '【回复长度】短。通常用 1–2 句简洁回应，优先 1–2 个聊天气泡；不要为了变短而漏掉关键事实。'
  }
  if (value === 'long') {
    return '【回复长度】长。话题需要时可以更完整地展开，通常 4–7 句，自然拆成几个聊天气泡；不要重复、不要灌水。'
  }
  return '【回复长度】中。通常 2–4 句，自然拆成 1–3 个聊天气泡；信息完整，但不要写成小作文。'
}
