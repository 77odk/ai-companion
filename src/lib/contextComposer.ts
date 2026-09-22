import type { ApiMessage } from './api.ts'
import { estimateToken, truncateByToken } from './token.ts'

export const CONTEXT_HARD_BUDGET = 64000
export const CONTEXT_SOFT_BUDGET = 45000
/** Compact 的单次模型输入预算：为 instruction / 输出预留余量，禁止 Compact 自己先爆 context。 */
export const COMPACT_INPUT_BUDGET = 42000

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

/**
 * Compact 只允许一次 LLM 调用，所以先在本地把“较老历史”限制到安全输入预算。
 * 优先保留离当前最近的旧消息；若单条旧消息本身超预算，只截取该条尾部用于摘要，
 * 原始聊天记录本身完全不修改。
 */
export function buildCompactSource(
  history: ApiMessage[],
  budget: number = COMPACT_INPUT_BUDGET,
): ApiMessage[] {
  if (!Array.isArray(history) || history.length === 0 || budget <= 0) return []
  const result: ApiMessage[] = []
  let used = 0

  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    const tokens = estimateToken(message.content)
    const remaining = budget - used
    if (remaining <= 0) break

    if (tokens <= remaining) {
      result.unshift(message)
      used += tokens
      continue
    }

    // 仅 Compact 的临时输入允许截取旧消息；真实存储和正常聊天 payload 不改写用户文本。
    if (result.length === 0 && message.content) {
      let lo = 0
      let hi = message.content.length
      let best = ''
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const candidate = mid === 0 ? '' : message.content.slice(-mid)
        if (estimateToken(candidate) <= remaining) {
          best = candidate
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      if (best) result.unshift({ ...message, content: best })
    }
    break
  }

  return result
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
  /** true = 当前消息或固定核心本身已无法在 hardBudget 内安全发送；调用方必须停止 provider 请求。 */
  overBudget: boolean
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

  // 当前用户消息优先于任何可选 block。若 fixed + newest 本身就放不下，直接标记 overBudget，
  // 不允许 truncateByToken 为了“至少保留一条”把最终 payload 顶破 hard cap。
  const newest = history.at(-1)
  const newestTokens = newest ? estimateToken(newest.content) : 0
  const newestFits = newestTokens <= remaining

  const included: ApiMessage[] = []
  const includedBlockIds: string[] = []
  if (newestFits) {
    for (const block of relevant) {
      const tokens = estimateToken(block.content)
      // 永远为当前最新消息预留空间；可选上下文不准挤掉用户本轮输入。
      if (tokens > remaining - newestTokens) continue
      included.push({ role: 'system', content: block.content })
      includedBlockIds.push(block.id)
      remaining -= tokens
    }
  }

  const keptHistory = newestFits ? truncateByToken(history, remaining) : []
  const messages = [...core, ...included, ...keptHistory, ...tail]
  const totalTokens = messages.reduce((sum, message) => sum + estimateToken(message.content), 0)
  const overBudget = fixedTokens > hardBudget || !newestFits || totalTokens > hardBudget

  return {
    messages,
    totalTokens,
    hardBudget,
    softBudget: CONTEXT_SOFT_BUDGET,
    usage: hardBudget > 0 ? totalTokens / hardBudget : 1,
    includedBlockIds,
    overBudget,
  }
}
