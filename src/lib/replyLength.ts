import { notifyDataChanged } from './dataChange.ts'
import type { Lang } from './langDetect.ts'

/**
 * 回复长度偏好（2026-09-20 重做，取代「短/中/长 + 句数硬规定」版）
 *
 * 设计口径（七七拍板）：
 * - 四档：natural（自然）/ short / medium / long。默认 natural = 什么都不注入，
 *   升级前后聊天体感完全不变——用户没动过设置就永远不受影响。
 * - 只有用户主动选了 short/medium/long 才注入一行「【回复偏好】…」，而且只说篇幅感，
 *   不写句数、不写字数、不写上限目标。
 * - 「自然」= 没有显式值（全局）；单 TA 的「自然」= 一个明确的 override 值，
 *   用来在全局设了 non-natural 时让某个 TA 回到自然；「跟随全局」= 没有 override。
 * - 长度和气泡拆分是两件事：这里只决定 TA 想说多少，怎么拆由 sessionStore 的拆分器管。
 */
export type ReplyLength = 'natural' | 'short' | 'medium' | 'long'
export type ReplyLengthOverride = ReplyLength | null

/** 账号级默认。「自然」= 不注入任何长度指令。 */
export const DEFAULT_GLOBAL_REPLY_LENGTH: ReplyLength = 'natural'

const GLOBAL_KEY_PREFIX = 'ai_companion_reply_length_global_'
const OVERRIDE_KEY_PREFIX = 'ai_companion_reply_length_override_'

function globalStorageKey(accountId: string): string {
  return `${GLOBAL_KEY_PREFIX}${encodeURIComponent(accountId.trim())}`
}

function overrideStorageKey(accountId: string, sessionId: string): string {
  return `${OVERRIDE_KEY_PREFIX}${encodeURIComponent(accountId.trim())}_${encodeURIComponent(sessionId.trim())}`
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return value === 'natural' || value === 'short' || value === 'medium' || value === 'long'
}

/** 全局档位：没存过 / 存的是自然 → null（= 没有显式值） */
export function getStoredGlobalReplyLength(accountId: string): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  if (!account) return null
  try {
    const raw = localStorage.getItem(globalStorageKey(account))
    if (raw === 'natural') return null
    return isReplyLength(raw) ? raw : null
  } catch {
    return null
  }
}

export function getGlobalReplyLength(accountId: string): ReplyLength {
  return getStoredGlobalReplyLength(accountId) ?? DEFAULT_GLOBAL_REPLY_LENGTH
}

/**
 * 保存全局档位。「自然」= 删掉显式值（不是存一个 natural），
 * 这样旧版本/新版本、手机/电脑读到的都是「什么都没设置」。
 */
export function saveGlobalReplyLength(accountId: string, value: ReplyLength): boolean {
  const account = String(accountId ?? '').trim()
  if (!account || !isReplyLength(value)) return false
  try {
    const key = globalStorageKey(account)
    if (value === 'natural') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
    const ok = getStoredGlobalReplyLength(account) === (value === 'natural' ? null : value)
    if (ok) notifyDataChanged()
    return ok
  } catch {
    return false
  }
}

/** 云端下发全局档位：payload={mode}；mode=natural → 清掉本地显式值 */
export function applyGlobalReplyLengthFromCloud(accountId: string, payload: unknown): ReplyLength | null {
  const account = String(accountId ?? '').trim()
  if (!account || payload == null || typeof payload !== 'object') return null
  const mode = (payload as { mode?: unknown }).mode
  if (!isReplyLength(mode)) return null
  try {
    const key = globalStorageKey(account)
    if (mode === 'natural') localStorage.removeItem(key)
    else localStorage.setItem(key, mode)
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

/** 单 TA 覆盖：null = 跟随全局（没有显式值）；'natural' = 明确要求这个 TA 用自然档 */
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

/** 「跟随全局」= 删除 override，不复制一份当前 global。 */
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
  const override = getReplyLengthOverride(accountId, sessionId)
  if (override) return override
  return getGlobalReplyLength(accountId)
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
  if (value === 'medium') return '中'
  if (value === 'long') return '长'
  return '自然'
}

/**
 * 注入用的一行偏好。自然档返回空串（调用方判断为空就什么都不加）。
 * 只说篇幅感：不出现句数、不出现字数、不出现「上限」。
 */
export function buildReplyLengthInstruction(value: ReplyLength, lang: Lang = 'zh'): string {
  if (lang === 'en') {
    if (value === 'short') return 'Reply preference: keep it short and natural, a few sentences is plenty.'
    if (value === 'medium') return 'Reply preference: keep a moderate length.'
    if (value === 'long') return 'Reply preference: feel free to say a bit more and let it flow with the topic.'
    return ''
  }
  if (value === 'short') return '【回复偏好】简短自然，几句话说完。'
  if (value === 'medium') return '【回复偏好】保持适中长度。'
  if (value === 'long') return '【回复偏好】可以多说一点，按话题自然展开。'
  return ''
}
