import type {
  ReplyInterruptionReason,
  ReplyLifecycleState,
  StoredMessage,
} from './storage.ts'

export interface RecoverableReply {
  userIndex: number
  userMessage: StoredMessage
  assistantMessages: StoredMessage[]
  reason: ReplyInterruptionReason
}

const activeReplyRuns = new Set<string>()

function runKey(sessionId: string | null | undefined, userTs: number): string {
  return `${sessionId || '__guest__'}:${userTs}`
}

export function registerActiveReplyRun(sessionId: string | null | undefined, userTs: number): void {
  activeReplyRuns.add(runKey(sessionId, userTs))
}

export function unregisterActiveReplyRun(sessionId: string | null | undefined, userTs: number): void {
  activeReplyRuns.delete(runKey(sessionId, userTs))
}

export function isActiveReplyRun(sessionId: string | null | undefined, userTs: number): boolean {
  return activeReplyRuns.has(runKey(sessionId, userTs))
}

function withLifecycle(
  message: StoredMessage,
  state: ReplyLifecycleState,
  reason?: ReplyInterruptionReason,
): StoredMessage {
  return {
    ...message,
    replyState: state,
    ...(state === 'interrupted'
      ? (reason ? { replyInterruptedReason: reason } : {})
      : { replyInterruptedReason: undefined }),
  }
}

/**
 * 给同一回复轮次打本地生命周期标记。
 * userTs 锁定用户原话；assistantTs 锁定这一轮可能拆成多泡、但共享 ts 的 TA 回复。
 * 字段只随现有消息缓存保存，不进入 messages API。
 */
export function setReplyLifecycle(
  messages: StoredMessage[],
  userTs: number,
  assistantTs: number | null,
  state: ReplyLifecycleState,
  reason?: ReplyInterruptionReason,
): StoredMessage[] {
  const list = Array.isArray(messages) ? messages : []
  let lastAssistantIndex = -1
  if (assistantTs != null) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]?.role === 'assistant' && list[i].ts === assistantTs) {
        lastAssistantIndex = i
        break
      }
    }
  }
  return list.map((message, index) => {
    if (message.role === 'user' && message.ts === userTs) return withLifecycle(message, state, reason)
    if (index === lastAssistantIndex) return withLifecycle(message, state, reason)
    return message
  })
}

/**
 * 页面真正重载后，内存 active-run 注册表会丢失。
 * 若现有消息缓存仍停在 pending / streaming，说明上一轮没有走到正常 finalize：
 * 只把它标成 interrupted，不删、不改用户原话，也不自动重试模型。
 */
export function normalizeStaleReplyLifecycle(
  messages: StoredMessage[],
  sessionId?: string | null,
): { messages: StoredMessage[]; changed: boolean } {
  const list = Array.isArray(messages) ? messages : []
  let userIndex = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') {
      userIndex = i
      break
    }
  }
  if (userIndex < 0) return { messages: list, changed: false }

  const user = list[userIndex]
  if (user.replyState !== 'pending' && user.replyState !== 'streaming') {
    return { messages: list, changed: false }
  }
  if (isActiveReplyRun(sessionId, user.ts)) return { messages: list, changed: false }

  const next = list.map((message, index) => {
    if (index === userIndex) return withLifecycle(message, 'interrupted', 'pagehide')
    if (index > userIndex && message.role === 'assistant' && message.replyState !== 'complete') {
      return withLifecycle(message, 'interrupted', 'pagehide')
    }
    return message
  })
  return { messages: next, changed: true }
}

export function findRecoverableReply(messages: StoredMessage[]): RecoverableReply | null {
  const list = Array.isArray(messages) ? messages : []
  let userIndex = -1
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === 'user') {
      userIndex = i
      break
    }
  }
  if (userIndex < 0) return null
  const user = list[userIndex]
  if (user.replyState !== 'interrupted') return null
  // 输入本身超出上下文时，原话仍保留，但“只重试 TA”不会改变结果，不能给误导入口。
  if (user.replyInterruptedReason === 'context-limit') return null

  return {
    userIndex,
    userMessage: user,
    assistantMessages: list.slice(userIndex + 1).filter((message) => message.role === 'assistant'),
    reason: user.replyInterruptedReason ?? 'unknown',
  }
}

function lifecycleFields(message: StoredMessage): Pick<StoredMessage, 'replyState' | 'replyInterruptedReason'> {
  return {
    ...(message.replyState ? { replyState: message.replyState } : {}),
    ...(message.replyInterruptedReason ? { replyInterruptedReason: message.replyInterruptedReason } : {}),
  }
}

/**
 * 后端消息仍是权威正文/身份；生命周期是本机 BYOK 请求态，不上传。
 * cloud merge 后把能确定属于同一条消息的本地状态贴回去，避免一次 pull 把“中断”提示抹掉。
 */
export function preserveReplyLifecycle(
  local: StoredMessage[],
  merged: StoredMessage[],
): StoredMessage[] {
  const source = (Array.isArray(local) ? local : []).filter(
    (message) => message.replyState || message.replyInterruptedReason,
  )
  if (source.length === 0) return merged

  return (Array.isArray(merged) ? merged : []).map((message) => {
    let match: StoredMessage | undefined
    if (typeof message.id === 'number') {
      match = source.find((candidate) => candidate.id === message.id)
    }
    if (!match) {
      match = source.find((candidate) =>
        candidate.role === message.role &&
        candidate.ts === message.ts &&
        candidate.content === message.content,
      )
    }
    // 不再按“唯一 role + content”猜身份：重复原话时会把一个 lifecycle 标记复制到另一条消息。
    // 没有 id 或精确本地身份就宁可不贴状态，权威消息正文/身份保持原样。
    return match ? { ...message, ...lifecycleFields(match) } : message
  })
}

export function interruptionReasonFromError(error: {
  kind?: string
  message?: string
} | null | undefined): ReplyInterruptionReason {
  const message = String(error?.message ?? '').toLowerCase()
  if (message.includes('429') || message.includes('too many requests') || message.includes('额度') || message.includes('频繁')) {
    return 'rate-limit'
  }
  if (message.includes('timeout') || message.includes('timed out') || message.includes('超时')) return 'timeout'
  if (error?.kind === 'network' || error?.kind === 'cors' || message.includes('网络')) return 'network'
  return 'unknown'
}
