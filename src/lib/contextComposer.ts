import type { ApiMessage } from './api.ts'
import { estimateToken, truncateByToken } from './token.ts'

export const CONTEXT_HARD_BUDGET = 64000
export const CONTEXT_SOFT_BUDGET = 45000

/** 上下文压缩后保留的最近原始消息条数（Compact = 较老历史压成 summary + 保留最近原始消息） */
export const COMPACT_KEEP_RECENT = 12
/** Session Bridge：bridge 生成后临时参与对话的轮次数（约 6–10 轮，取 8） */
export const BRIDGE_ACTIVE_TURNS = 8
/** Session Bridge：从上一会话取聊天尾部参与承接的最大消息条数（有限尾部，禁止搬完整旧聊天） */
export const BRIDGE_TAIL_COUNT = 30

/**
 * PR #99：Compact 之后的注入列表 = [较老历史摘要(system)] + [最近 keepRecent 条原始消息]。
 * summary 为空时退回只注入最近原始消息。
 * 纯注入层组装：原聊天记录（本地缓存 / 后端）一律不动，绝不删除。
 */
export function buildCompactedHistory(
  summary: string,
  history: ApiMessage[],
  keepRecent: number = COMPACT_KEEP_RECENT,
): ApiMessage[] {
  if (!Array.isArray(history) || history.length === 0) return []
  const recent = history.length > keepRecent ? history.slice(-keepRecent) : history
  const s = summary.trim()
  return s ? [{ role: 'system', content: s }, ...recent] : recent
}

export type ContextPriority = 'core' | 'memory' | 'event' | 'runtime' | 'ambient'

export interface ContextBlock {
  id: string
  content: string
  priority: ContextPriority
  relevant?: boolean
}

export interface ComposedContext {
  messages: ApiMessage[]
  totalTokens: number
  hardBudget: number
  softBudget: number
  usage: number
  includedBlockIds: string[]
}

const PRIORITY: Record<ContextPriority, number> = {
  core: 0,
  memory: 1,
  event: 2,
  runtime: 3,
  ambient: 4,
}

export function composeContext(
  core: ApiMessage[],
  history: ApiMessage[],
  blocks: ContextBlock[],
  tail: ApiMessage[] = [],
  hardBudget = CONTEXT_HARD_BUDGET,
): ComposedContext {
  const relevant = blocks
    .filter((block) => block.relevant !== false && block.content.trim())
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority])

  const fixed = [...core, ...tail]
  const fixedTokens = fixed.reduce((sum, message) => sum + estimateToken(message.content), 0)
  let remaining = Math.max(0, hardBudget - fixedTokens)
  const included: ApiMessage[] = []
  const includedBlockIds: string[] = []

  for (const block of relevant) {
    const tokens = estimateToken(block.content)
    if (tokens > remaining) continue
    included.push({ role: 'system', content: block.content })
    includedBlockIds.push(block.id)
    remaining -= tokens
  }

  const keptHistory = truncateByToken(history, remaining)
  const messages = [...core, ...included, ...keptHistory, ...tail]
  const totalTokens = messages.reduce((sum, message) => sum + estimateToken(message.content), 0)

  return {
    messages,
    totalTokens,
    hardBudget,
    softBudget: CONTEXT_SOFT_BUDGET,
    usage: hardBudget > 0 ? totalTokens / hardBudget : 1,
    includedBlockIds,
  }
}
