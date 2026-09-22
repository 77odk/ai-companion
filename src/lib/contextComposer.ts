import type { ApiMessage } from './api'
import { estimateToken, truncateByToken } from './token'

export const CONTEXT_HARD_BUDGET = 64000
export const CONTEXT_SOFT_BUDGET = 45000

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
