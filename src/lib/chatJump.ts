// UI2-03B-1 Memory「看原对话」：exact-match 跳转辅助。
// 只做 provenance 定位：唯一匹配 user 消息 → 返回一次性 jump target；不猜、不模糊、不跨会话。
// 数据源与 Chat 渲染同源：getMessagesCache + sessionStart 过滤，保证「跳得到的一定是 Chat 会渲染的」。

import type { StoredMessage } from './storage.ts'
import { getMessagesCache } from './sessionStore.ts'
import { getSessionStart } from './storage.ts'
import { filterSessionMessages } from './aiSpaceDetail.ts'

/** 三态：唯一命中 / 0 命中 / 多次命中（无法确定是哪一次） */
export type ChatJumpStatus = 'unique' | 'not_found' | 'ambiguous'

/** 一次性 jump target：只作为本次跳转的临时 UI 锚点，绝不持久化。 */
/**
 * 从 Memory Detail 跳 Chat 时记下的「返回目标」：只存在内存，不进 localStorage / sync / backend / URL / message schema。
 * 用稳定 identity（memoryId + kind + sessionId）定位，返回时重新在当前数据里查，不靠 index 硬恢复。
 */
export interface MemoryReturnTarget {
  memoryId: string
  kind: 'global' | 'session'
  sessionId?: string
}

export interface ChatJumpTarget {
  sessionId: string
  ts: number
  source: string
}

export interface ChatJumpResult {
  status: ChatJumpStatus
  target: ChatJumpTarget | null
}

/**
 * 在当前 session 中查找与 source 完全一致的用户消息。
 * - 只查 active session 的消息缓存，绝不跨角色 / 全账号搜索；
 * - 只允许 exact equality（trim 后全等），禁止 includes / startsWith / 模糊匹配；
 * - 目标早于 sessionStart 的消息 Chat 不渲染，视为不可跳（按 not_found 处理）。
 */
export function findChatJumpTarget(sessionId: string | null, source: string): ChatJumpResult {
  const src = (source ?? '').trim()
  if (!sessionId || !src) return { status: 'not_found', target: null }

  const all = getMessagesCache(sessionId)
  const sessionStart = getSessionStart(sessionId)
  const visible = filterSessionMessages(all, sessionStart)

  const matches = visible.filter(
    (m) =>
      m != null &&
      m.role === 'user' &&
      typeof m.ts === 'number' &&
      Number.isFinite(m.ts) &&
      (m.content ?? '').trim() === src,
  )

  if (matches.length === 1) {
    const m = matches[0]
    return {
      status: 'unique',
      target: { sessionId: String(sessionId), ts: m.ts, source: src },
    }
  }
  if (matches.length > 1) return { status: 'ambiguous', target: null }
  return { status: 'not_found', target: null }
}

/**
 * Chat 真正滚动前的最终二次校验：
 * session 未变 + visibleMessages 中该 ts 存在 + content 与 source 完全一致 + 仍唯一。
 * 只凭 ts 不算数；任何一项不满足都不得滚动。
 */
export function verifyChatJumpTarget(
  target: ChatJumpTarget | null,
  activeSessionId: string | null,
  visibleMessages: StoredMessage[],
): boolean {
  if (!target) return false
  if (String(target.sessionId) !== String(activeSessionId)) return false
  const hits = visibleMessages.filter(
    (m) =>
      m != null &&
      m.role === 'user' &&
      typeof m.ts === 'number' &&
      m.ts === target.ts &&
      (m.content ?? '').trim() === (target.source ?? '').trim(),
  )
  return hits.length === 1
}
