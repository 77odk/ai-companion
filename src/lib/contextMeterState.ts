// 聊天页 · 上下文用量估算（拆分第 7 刀）
// 从 Chat.tsx 的 send 流程整段搬出：算「刷新之后这一段」的 provider 口径估算值。
// 本文件是纯计算：落地写存储与 React 状态仍由 Chat.tsx 负责（保持原有写入时机不变）。
import { contentTokensOf, loadContextFactor, usageMessages } from './contextUsage'
import type { ContextUsageState, StoredMessage } from './storage'

export function buildEstimatedContextState(input: {
  roundVisibleMessages: StoredMessage[]
  userMsg: StoredMessage
  sessionStart: number
  hardBudget: number
  inputTokens: number
  now: number
}): ContextUsageState {
  const { roundVisibleMessages, userMsg, sessionStart, hardBudget, inputTokens, now } = input
  const sessionContentTokens = contentTokensOf(usageMessages(roundVisibleMessages, userMsg), loadContextFactor())
  return {
    sessionStart,
    used: sessionContentTokens,
    budget: hardBudget,
    source: 'estimate',
    inputTokens,
    updatedAt: now,
  }
}
