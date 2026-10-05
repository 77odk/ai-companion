import { getAccount } from './sync.ts'
import { postMessage } from './sessionApi.ts'
import { getMessagesCache, getSessionsCache, saveMessagesCache } from './sessionStore.ts'
import type { StoredMessage } from './storage.ts'
import { appendConfirmedMessageToBranch } from './conversationState.ts'
import { enqueueSessionMessageCommit } from './sessionMessageQueue.ts'

export interface InitiativeCommitInput {
  sessionId: string
  content: string
  token: string
  accountId: string
  conversationBranchId?: string
  /** 真正拿到同 session 提交锁后再复核；false 时不发送 POST。 */
  shouldCommit?: () => boolean
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

  return enqueueSessionMessageCommit(sessionId, async () => {
    // 前台用户消息可能在主动生成期间先进入本地缓存并排到队列前面。
    // 真正拿到 session 提交权后再看一次，条件已经变化就宁可漏掉这次主动消息。
    if (input.shouldCommit && !input.shouldCommit()) return null
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
  })
}
