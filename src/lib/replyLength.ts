import { notifyDataChanged } from './dataChange.ts'
import type { Lang } from './langDetect.ts'
import type { StoredMessage } from './storage.ts'

/**
 * 回复长度偏好（2026-09-20 重做，取代「短/中/长 + 句数硬规定」版）
 *
 * 设计口径（七七拍板）：
 * - 四档：natural（自然）/ short（简洁）/ medium（适中）/ long（详细）。默认 natural = 什么都不注入，
 *   升级前后聊天体感完全不变——用户没动过设置就永远不受影响。
 * - 只有用户主动选了简洁/适中/详细才注入一行「【回复偏好】…」，而且只说展开程度，
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
  if (value === 'short') return '简洁'
  if (value === 'medium') return '适中'
  if (value === 'long') return '详细'
  return '自然'
}

/**
 * 注入用的一行偏好。自然档返回空串（调用方判断为空就什么都不加）。
 * 只说篇幅感：不出现句数、不出现字数、不出现「上限」。
 */
export function buildReplyLengthInstruction(value: ReplyLength, lang: Lang = 'zh'): string {
  if (lang === 'en') {
    if (value === 'short') return '[Reply preference] Keep the reply concise and natural; skip unnecessary elaboration.'
    if (value === 'medium') return '[Reply preference] Use a moderate level of detail; say what needs to be said without stretching it out.'
    if (value === 'long') return '[Reply preference] Feel free to develop the reply more fully and include relevant details and thoughts, without repeating yourself or padding it with unrelated content.'
    return ''
  }
  if (value === 'short') return '【回复偏好】回复简洁自然，省掉不必要的展开。'
  if (value === 'medium') return '【回复偏好】保持适中的展开程度，把该说的说完整，不必刻意拉长。'
  if (value === 'long') return '【回复偏好】可以更充分地展开，把相关细节和想法说完整，但不要为了变长重复或堆无关内容。'
  return ''
}


/**
 * 「详细」模式的展示拆分：
 * - 正常长度的一整段优先保留成一个气泡，不沿用普通聊天的 60 字 / 一句一泡节奏；
 * - 模型本身分了自然段，就按自然段保留；
 * - 只有单个自然段真的很长时，才在完整句子/自然停顿处做少量拆分。
 *
 * 这里的阈值只是 UI 防护，不进入 prompt，也不代表 TA 必须写到某个字数。
 */
const DETAILED_BUBBLE_SOFT_LIMIT = 420
const DETAILED_SENT_END = '。！？!?…'
const DETAILED_PAUSE = '，、；：,;:'

function detailedSentenceUnits(text: string): string[] {
  const units: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const isEnglishPeriod = ch === '.' && (i === text.length - 1 || /\s/.test(text[i + 1]))
    if (DETAILED_SENT_END.includes(ch) || isEnglishPeriod) {
      const unit = text.slice(start, i + 1).trim()
      if (unit) units.push(unit)
      start = i + 1
    }
  }
  const tail = text.slice(start).trim()
  if (tail) units.push(tail)
  return units
}

function splitOversizedDetailedUnit(text: string, limit: number): string[] {
  const input = text.trim()
  if (!input || input.length <= limit) return input ? [input] : []

  const result: string[] = []
  let rest = input
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let breakPos = -1
    for (let i = window.length - 1; i >= Math.floor(limit * 0.55); i--) {
      const ch = window[i]
      if (DETAILED_PAUSE.includes(ch) || /\s/.test(ch)) {
        breakPos = i + 1
        break
      }
    }
    if (breakPos < 0) {
      for (let i = limit; i < rest.length; i++) {
        const ch = rest[i]
        if (DETAILED_SENT_END.includes(ch) || DETAILED_PAUSE.includes(ch) || /\s/.test(ch)) {
          breakPos = i + 1
          break
        }
      }
    }
    // 连续长 token / 没有自然断点：宁可保留整段，也不硬切词。
    if (breakPos < 0) {
      result.push(rest)
      rest = ''
      break
    }
    const piece = rest.slice(0, breakPos).trim()
    if (piece) result.push(piece)
    rest = rest.slice(breakPos).trim()
  }
  if (rest) result.push(rest)
  return result
}

function splitDetailedParagraph(paragraph: string): string[] {
  const text = paragraph.trim()
  if (!text) return []
  if (text.length <= DETAILED_BUBBLE_SOFT_LIMIT) return [text]

  const units = detailedSentenceUnits(text)
  if (units.length <= 1) return splitOversizedDetailedUnit(text, DETAILED_BUBBLE_SOFT_LIMIT)

  const chunks: string[] = []
  let current = ''
  for (const unit of units) {
    if (!current) {
      current = unit
      continue
    }
    const candidate = `${current}${/^[A-Za-z0-9]/.test(unit) ? ' ' : ''}${unit}`
    if (candidate.length <= DETAILED_BUBBLE_SOFT_LIMIT) {
      current = candidate
      continue
    }
    chunks.push(...splitOversizedDetailedUnit(current, DETAILED_BUBBLE_SOFT_LIMIT))
    current = unit
  }
  if (current) chunks.push(...splitOversizedDetailedUnit(current, DETAILED_BUBBLE_SOFT_LIMIT))
  return chunks
}

export function splitDetailedAssistantReply(content: string, ts: number): StoredMessage[] {
  const text = String(content ?? '').trim()
  if (!text) return []

  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean)

  const pieces = (paragraphs.length > 0 ? paragraphs : [text]).flatMap(splitDetailedParagraph)
  return pieces.map((piece) => ({ role: 'assistant' as const, content: piece, ts }))
}
