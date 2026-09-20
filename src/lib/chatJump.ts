// UI2-03B-1 Memory「看原对话」：exact-match 跳转辅助。
// 只做 provenance 定位：唯一匹配 user 消息 → 返回一次性 jump target；不猜、不模糊、不跨会话。
// 目标页是「聊天记录」，所以查当前角色的全量消息，不受「刷新对话」的 sessionStart 影响。

import type { StoredMessage } from './storage.ts'
import { getMessagesCache, mergeSessionMessages, saveMessagesCache } from './sessionStore.ts'
import { getSession } from './sessionApi.ts'

/** 三态：唯一命中 / 0 命中 / 多次命中（无法确定是哪一次） */
export type ChatJumpStatus = 'unique' | 'not_found' | 'ambiguous'

/** 一次性 jump target：只作为本次跳转的临时 UI 锚点，绝不持久化。 */
/**
 * 从 Memory Detail 跳聊天记录时记下的「返回目标」：只存在内存，不进 localStorage / sync / backend / URL / message schema。
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
 * 在当前 session 的完整聊天记录中查找与 source 完全一致的用户消息。
 * - 只查 active session 的消息缓存，绝不跨角色 / 全账号搜索；
 * - 只允许 exact equality（trim 后全等），禁止 includes / startsWith / 模糊匹配；
 * - 不应用 sessionStart：刷新对话前的旧消息仍属于聊天记录，可以定位。
 */
function findChatRecordJumpTargetInMessages(
  sessionId: string | null,
  source: string,
  all: StoredMessage[],
): ChatJumpResult {
  const src = (source ?? '').trim()
  if (!sessionId || !src) return { status: 'not_found', target: null }

  const matches = all.filter(
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

export function findChatRecordJumpTarget(sessionId: string | null, source: string): ChatJumpResult {
  if (!sessionId) return { status: 'not_found', target: null }
  return findChatRecordJumpTargetInMessages(sessionId, source, getMessagesCache(sessionId))
}

/**
 * 点击时优先用后端完整会话确认唯一性，避免本地缓存不完整时把重复原话误判成唯一。
 * 后端不可用时安全回落本地；云端尚未收到本地 pending 消息时，也允许使用本地可靠结果。
 */
export async function findChatRecordJumpTargetHydrated(
  sessionId: string | null,
  source: string,
  token: string | null,
): Promise<ChatJumpResult> {
  const local = findChatRecordJumpTarget(sessionId, source)
  if (!sessionId || !token) return local

  const res = await getSession(token, sessionId)
  if (!res.ok) return local

  const cloud: StoredMessage[] = res.data.messages
    .map((message) => ({
      role: message.role,
      content: message.content,
      ts: Date.parse(message.createdAt),
      thinking: message.thinking,
    }))
    .filter((message) => Number.isFinite(message.ts))

  // provenance 的唯一性必须按服务端原始消息判断；不能用 merge 后的列表，
  // 因为 mergeSessionMessages 会按 role+content 去重，同一句真实说过两次时会把它压成一条。
  const cloudResult = findChatRecordJumpTargetInMessages(sessionId, source, cloud)
  const merged = mergeSessionMessages(getMessagesCache(sessionId), cloud)
  saveMessagesCache(sessionId, merged)
  return cloudResult.status === 'not_found' ? local : cloudResult
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
