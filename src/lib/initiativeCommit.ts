import { getAccount } from './sync.ts'
import { postMessage } from './sessionApi.ts'
import { getMessagesCache, getSessionsCache, saveMessagesCache } from './sessionStore.ts'
import type { StoredMessage } from './storage.ts'
import { appendConfirmedMessageToBranch } from './conversationState.ts'

export interface InitiativeCommitInput {
  sessionId: string
  content: string
  token: string
  accountId: string
  conversationBranchId?: string
}

function sameAccount(accountId: string, token: string): boolean {
  const account = getAccount()
  return Boolean(account && account.account === accountId && account.token === token)
}

/**
 * 主动消息只在服务端 messages 成功落库后才算投递。
 * 不新造 outbox / job；网络不确定时宁可不展示，避免重复主动消息。
 */
export async function commitInitiativeMessage(input: InitiativeCommitInput): Promise<StoredMessage | null> {
  const sessionId = String(input.sessionId ?? '').trim()
  const content = String(input.content ?? '').trim()
  if (!sessionId || !content || !input.token || !input.accountId) return null
  if (!sameAccount(input.accountId, input.token)) return null
  if (!getSessionsCache().some((session) => String(session.id) === sessionId)) return null

  const response = await postMessage(input.token, sessionId, {
    role: 'assistant',
    content,
  })
  if (!response.ok) return null

  // 请求途中若已经换账号，服务端结果属于旧账号：不再写当前浏览器缓存，也不触达新账号。
  if (!sameAccount(input.accountId, input.token)) return null
  if (!getSessionsCache().some((session) => String(session.id) === sessionId)) return null

  const serverTs = Date.parse(response.data.createdAt)
  const message: StoredMessage = {
    id: response.data.id,
    role: 'assistant',
    content: response.data.content,
    ts: Number.isFinite(serverTs) ? serverTs : Date.now(),
    ...(input.conversationBranchId ? { conversationBranchId: input.conversationBranchId } : {}),
  }

  const current = getMessagesCache(sessionId)
  const alreadyThere = current.some((item) =>
    (typeof item.id === 'number' && item.id === message.id) ||
    (item.role === message.role && item.content === message.content && item.ts === message.ts),
  )
  if (!alreadyThere) {
    saveMessagesCache(
      sessionId,
      [...current, message].sort((a, b) => a.ts - b.ts),
      false,
    )
  }
  if (input.conversationBranchId) {
    appendConfirmedMessageToBranch(sessionId, input.conversationBranchId, response.data.id)
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('yiwem:ai-reply-committed', {
      detail: { sid: sessionId },
    }))
  }
  return message
}
