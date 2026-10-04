import type { ApiMessage } from './api.ts'
import { estimateToken } from './token.ts'

export const CONTEXT_HARD_BUDGET = 64000
export const CONTEXT_SOFT_BUDGET = 45000
/** Compact 的单次模型输入预算：为 instruction / 输出预留余量，禁止 Compact 自己先爆 context。 */
export const COMPACT_INPUT_BUDGET = 42000

/** 上下文压缩后保留的最近原始消息条数（Compact = 较老历史压成 summary + 保留最近原始消息） */
export const COMPACT_KEEP_RECENT = 12
/** Session Bridge：bridge 生成后临时参与对话的轮次数（约 6–10 轮，取 8） */
export const BRIDGE_ACTIVE_TURNS = 8
/** Session Bridge 单次模型输入预算：同样给 instruction / 输出留余量，不能只限消息条数。 */
export const BRIDGE_INPUT_BUDGET = 42000
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
export type ContextFreshness = 'stable' | 'session' | 'turn'
export type ContextLedgerKind = 'core' | 'history' | 'block' | 'latest' | 'tail'
export type ContextLedgerReason =
  | 'required'
  | 'required-over-budget'
  | 'priority-core'
  | 'active-thread'
  | 'priority-memory'
  | 'priority-context'
  | 'history-fill'
  | 'priority-ambient'
  | 'partial-budget'
  | 'budget'
  | 'irrelevant'
  | 'empty'

/** 最近对话优先保留窗口：包含最新消息本身。 */
export const CONTEXT_ACTIVE_THREAD_MESSAGES = 12

export interface ContextBlock {
  id: string
  content: string
  priority: ContextPriority
  relevant?: boolean
  /** 仅用于 Context Ledger 可观测性；未声明的动态块保守视为 turn 级。 */
  freshness?: ContextFreshness
}

export interface ContextLedgerEntry {
  /** 注入来源，例如 core / history:active / memory / current-time。 */
  source: string
  kind: ContextLedgerKind
  priority?: ContextPriority
  freshness: ContextFreshness
  estimatedTokens: number
  includedTokens: number
  included: boolean
  reason: ContextLedgerReason
  messageCount?: number
  includedMessageCount?: number
}

export interface ComposedContext {
  messages: ApiMessage[]
  totalTokens: number
  hardBudget: number
  softBudget: number
  usage: number
  includedBlockIds: string[]
  /** P0-C：本轮上下文来源、预算去留原因与新鲜度，仅做运行时可观测，不写用户数据层。 */
  ledger: ContextLedgerEntry[]
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

function messageTokens(messages: ApiMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateToken(message.content), 0)
}

/**
 * 可降级历史严格按预算保留最近的连续片段。
 * 与 truncateByToken 不同，这里不会为了“至少留一条”而把可选历史撑爆 hard budget。
 */
function fitRecentHistory(messages: ApiMessage[], budget: number): ApiMessage[] {
  if (budget <= 0 || messages.length === 0) return []
  const kept: ApiMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateToken(messages[i].content)
    if (used + tokens > budget) break
    kept.unshift(messages[i])
    used += tokens
  }
  return kept
}

function historyLedger(
  source: string,
  freshness: ContextFreshness,
  all: ApiMessage[],
  kept: ApiMessage[],
  fullReason: ContextLedgerReason,
): ContextLedgerEntry {
  const estimatedTokens = messageTokens(all)
  const includedTokens = messageTokens(kept)
  let reason: ContextLedgerReason = fullReason
  if (all.length > 0 && kept.length === 0) reason = 'budget'
  else if (kept.length < all.length) reason = 'partial-budget'
  return {
    source,
    kind: 'history',
    freshness,
    estimatedTokens,
    includedTokens,
    included: kept.length > 0,
    reason,
    messageCount: all.length,
    includedMessageCount: kept.length,
  }
}

export function composeContext(
  core: ApiMessage[],
  history: ApiMessage[],
  blocks: ContextBlock[],
  tail: ApiMessage[] = [],
  hardBudget = CONTEXT_HARD_BUDGET,
): ComposedContext {
  const newest = history.at(-1)
  const olderHistory = newest ? history.slice(0, -1) : history
  const activeHistoryLimit = Math.max(0, CONTEXT_ACTIVE_THREAD_MESSAGES - (newest ? 1 : 0))
  const activeHistory =
    activeHistoryLimit > 0 ? olderHistory.slice(-activeHistoryLimit) : []
  const archivedHistory =
    activeHistoryLimit > 0 ? olderHistory.slice(0, Math.max(0, olderHistory.length - activeHistory.length)) : olderHistory

  const coreTokens = messageTokens(core)
  const newestTokens = newest ? estimateToken(newest.content) : 0
  const tailTokens = messageTokens(tail)
  const fixedTokens = coreTokens + newestTokens + tailTokens
  const newestFits = fixedTokens <= hardBudget
  let remaining = newestFits ? Math.max(0, hardBudget - fixedTokens) : 0

  const candidates = blocks.map((block, index) => ({
    block,
    index,
    tokens: estimateToken(block.content),
  }))
  const relevant = candidates
    .filter(({ block }) => block.relevant !== false && block.content.trim())
    .sort((a, b) => PRIORITY[a.block.priority] - PRIORITY[b.block.priority] || a.index - b.index)

  const selectedIndexes = new Set<number>()
  const selectedReasons = new Map<number, ContextLedgerReason>()

  const selectBlocks = (
    list: typeof relevant,
    reason: ContextLedgerReason,
  ) => {
    for (const candidate of list) {
      if (candidate.tokens > remaining) continue
      selectedIndexes.add(candidate.index)
      selectedReasons.set(candidate.index, reason)
      remaining -= candidate.tokens
    }
  }

  let keptActive: ApiMessage[] = []
  let keptArchive: ApiMessage[] = []

  if (newestFits) {
    // Token Budgeter tiers:
    // 1) stable core + latest + tail are protected above;
    // 2) core context rules;
    // 3) active thread continuity;
    // 4) memory;
    // 5) event/runtime;
    // 6) older history fill;
    // 7) ambient/background.
    selectBlocks(relevant.filter(({ block }) => block.priority === 'core'), 'priority-core')

    keptActive = fitRecentHistory(activeHistory, remaining)
    remaining -= messageTokens(keptActive)

    selectBlocks(relevant.filter(({ block }) => block.priority === 'memory'), 'priority-memory')
    selectBlocks(
      relevant.filter(({ block }) => block.priority === 'event' || block.priority === 'runtime'),
      'priority-context',
    )

    keptArchive = fitRecentHistory(archivedHistory, remaining)
    remaining -= messageTokens(keptArchive)

    selectBlocks(relevant.filter(({ block }) => block.priority === 'ambient'), 'priority-ambient')
  }

  // 输出顺序继续遵守 P0-B：稳定 core/history 前缀 -> 动态块 -> 最新消息 -> tail。
  const keptHistory = [...keptArchive, ...keptActive]
  const included = relevant
    .filter(({ index }) => selectedIndexes.has(index))
    .map(({ block }) => ({ role: 'system' as const, content: block.content }))
  const includedBlockIds = relevant
    .filter(({ index }) => selectedIndexes.has(index))
    .map(({ block }) => block.id)

  const messages = [
    ...core,
    ...keptHistory,
    ...included,
    ...(newestFits && newest ? [newest] : []),
    ...tail,
  ]
  const totalTokens = messageTokens(messages)
  const overBudget = fixedTokens > hardBudget || totalTokens > hardBudget

  const ledger: ContextLedgerEntry[] = [
    {
      source: 'core',
      kind: 'core',
      freshness: 'stable',
      estimatedTokens: coreTokens,
      includedTokens: coreTokens,
      included: core.length > 0,
      reason: 'required',
      messageCount: core.length,
      includedMessageCount: core.length,
    },
    historyLedger('history:archive', 'session', archivedHistory, keptArchive, 'history-fill'),
    historyLedger('history:active', 'turn', activeHistory, keptActive, 'active-thread'),
    ...candidates.map(({ block, index, tokens }) => {
      const empty = !block.content.trim()
      const irrelevant = block.relevant === false
      const selected = selectedIndexes.has(index)
      const reason: ContextLedgerReason = empty
        ? 'empty'
        : irrelevant
          ? 'irrelevant'
          : selected
            ? (selectedReasons.get(index) ?? 'priority-context')
            : 'budget'
      return {
        source: block.id,
        kind: 'block' as const,
        priority: block.priority,
        freshness: block.freshness ?? 'turn',
        estimatedTokens: tokens,
        includedTokens: selected ? tokens : 0,
        included: selected,
        reason,
      }
    }),
    ...(newest
      ? [{
          source: 'latest-message',
          kind: 'latest' as const,
          freshness: 'turn' as const,
          estimatedTokens: newestTokens,
          includedTokens: newestFits ? newestTokens : 0,
          included: newestFits,
          reason: newestFits ? 'required' as const : 'required-over-budget' as const,
          messageCount: 1,
          includedMessageCount: newestFits ? 1 : 0,
        }]
      : []),
    {
      source: 'tail',
      kind: 'tail',
      freshness: 'turn',
      estimatedTokens: tailTokens,
      includedTokens: tailTokens,
      included: tail.length > 0,
      reason: 'required',
      messageCount: tail.length,
      includedMessageCount: tail.length,
    },
  ]

  return {
    messages,
    totalTokens,
    hardBudget,
    softBudget: CONTEXT_SOFT_BUDGET,
    usage: hardBudget > 0 ? totalTokens / hardBudget : 1,
    includedBlockIds,
    ledger,
    overBudget,
  }
}
