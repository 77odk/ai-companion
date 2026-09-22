import type { ApiMessage } from './api.ts'
import { estimateToken, truncateByToken } from './token.ts'

export const CONTEXT_HARD_BUDGET = 64000
export const CONTEXT_SOFT_BUDGET = 45000

/** 上下文压缩后保留的最近消息条数（PR #99：Compact 结构性压缩，无 LLM） */
export const COMPACT_KEEP_RECENT = 12
/** 自动压缩触发阈值：context usage（totalTokens / hardBudget）≥ 0.7 时，未压缩过则自动压缩一次 */
export const COMPACT_USAGE_THRESHOLD = 0.7

/**
 * 结构性上下文压缩（PR #99）：把 history 折叠为「最近 keepRecent 条」。
 * 纯注入层裁剪：原聊天记录（本地缓存 / 后端）一律不动，绝不删除。
 * 返回 compacted=true 表示真的发生了折叠（history 变短了）。
 */
export function compactHistory(history: ApiMessage[], keepRecent: number = COMPACT_KEEP_RECENT): { history: ApiMessage[]; compacted: boolean } {
  if (!Array.isArray(history) || history.length === 0) return { history: [], compacted: false }
  if (history.length <= keepRecent) return { history, compacted: false }
  return { history: history.slice(-keepRecent), compacted: true }
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
