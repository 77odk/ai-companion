import type { MemoryItem } from './memory.ts'
import { inferTopic } from './memory.ts'
import { estimateToken } from './token.ts'

/**
 * Memory Recall 2.0 的薄治理层。
 * 不改 MemoryItem / memory.ts / sessionStore 数据层，只对“本轮准备注入的候选”做二次筛选。
 */
export const MEMORY_WORKING_SET_TOKEN_BUDGET = 1200
export const MEMORY_WORKING_SET_MAX_ITEMS = 10

/** buildMemoryBlock 的标题、日期、source 标签等固定开销兜底；生产路径优先按最终渲染块精确计费。 */
const MEMORY_BLOCK_RESERVE_TOKENS = 80
const MEMORY_LINE_OVERHEAD_TOKENS = 20

export interface MemoryWorkingSetOptions {
  tokenBudget?: number
  maxItems?: number
  /** 只用于保护“用户这一轮精确提到”的候选；不改变底层召回与存储。 */
  userText?: string
  /**
   * 生产路径传 buildMemoryBlock 渲染器，用最终真正发送给模型的字符串计 token。
   * 未传时只用于纯逻辑场景的保守兜底估算。
   */
  renderBlock?: (items: MemoryItem[]) => string | null
}

export interface MemoryWorkingSetResult {
  items: MemoryItem[]
  estimatedTokens: number
  truncated: boolean
}

const STOP_CHARS = new Set(
  '的了是在有和与跟也都就不很好吧吗呢啊呀哦嗯我你他她它们这那个谁什么要会能可去来到上下着过被让把对又再还只才最更太真却向从为因于以及'.split(''),
)

const COMMON_ZH_PHRASES = new Set([
  '喜欢', '今天', '最近', '现在', '觉得', '真的', '还是', '可以', '需要', '可能', '就是', '这个', '那个',
])

const COMMON_ZH_CHARS = new Set(
  '喜欢今天最近现在觉得真的还是可以需要可能就是这个那个'.split(''),
)

const COMMON_ENGLISH = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
  'that', 'this', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'their', 'them',
  'user', 'self', 'like', 'likes', 'liked', 'want', 'wants', 'wanted', 'think', 'thinks',
  'know', 'knows', 'today', 'now', 'really', 'very',
])

function normalize(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/用户|对方|ta/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function lexicalSignals(text: string): {
  english: Set<string>
  chineseBigrams: Set<string>
  chineseSingles: Set<string>
} {
  const raw = String(text ?? '').toLowerCase()
  const english = new Set(
    (raw.match(/[a-z]+/g) ?? [])
      .filter((word) => word.length >= 3 && !COMMON_ENGLISH.has(word)),
  )
  const chineseSingles = new Set<string>()
  const chineseBigrams = new Set<string>()

  for (const run of raw.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (const char of run) {
      if (!STOP_CHARS.has(char) && !COMMON_ZH_CHARS.has(char)) chineseSingles.add(char)
    }
    for (let i = 0; i < run.length - 1; i++) {
      const pair = run.slice(i, i + 2)
      if (
        [...pair].every((char) => !STOP_CHARS.has(char)) &&
        !COMMON_ZH_PHRASES.has(pair)
      ) {
        chineseBigrams.add(pair)
      }
    }
  }

  return { english, chineseBigrams, chineseSingles }
}

/**
 * 判断“当前用户原话”是否确实点到这条记忆。
 * 这里故意比候选召回更严格：topic 相同、通用词相同都不够，必须有能标识具体事实的词汇证据。
 */
export function isSpecificMemoryMatch(item: MemoryItem, userText: string): boolean {
  const memoryText = String(item?.text ?? '').trim()
  const user = String(userText ?? '').trim()
  if (!memoryText || !user) return false

  const a = normalize(memoryText)
  const b = normalize(user)
  if (!a || !b) return false

  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (
    shorter.length >= 2 &&
    !COMMON_ZH_PHRASES.has(shorter) &&
    longer.includes(shorter)
  ) {
    return true
  }
  if (
    shorter.length === 1 &&
    !STOP_CHARS.has(shorter) &&
    !COMMON_ZH_CHARS.has(shorter) &&
    longer.includes(shorter)
  ) {
    return true
  }

  const mem = lexicalSignals(memoryText)
  const usr = lexicalSignals(user)

  for (const word of mem.english) if (usr.english.has(word)) return true
  for (const pair of mem.chineseBigrams) if (usr.chineseBigrams.has(pair)) return true

  let sharedSpecificSingles = 0
  for (const char of mem.chineseSingles) {
    if (!usr.chineseSingles.has(char)) continue
    sharedSpecificSingles++
    if (sharedSpecificSingles >= 2) return true
  }

  // topic 只允许辅助一个“具体字符”证据，绝不单独触发整组 touch。
  const memoryTopic = item.topic?.trim() || inferTopic(memoryText)
  const userTopic = inferTopic(user)
  return memoryTopic !== '其他' && memoryTopic === userTopic && sharedSpecificSingles >= 1
}

function roughSelectionTokens(items: MemoryItem[]): number {
  if (items.length === 0) return 0
  return MEMORY_BLOCK_RESERVE_TOKENS + items.reduce(
    (sum, item) => sum + estimateToken(item.text) + MEMORY_LINE_OVERHEAD_TOKENS,
    0,
  )
}

function selectionTokens(
  items: MemoryItem[],
  renderBlock?: (items: MemoryItem[]) => string | null,
): number {
  if (items.length === 0) return 0
  if (!renderBlock) return roughSelectionTokens(items)
  return estimateToken(renderBlock(items) ?? '')
}

/**
 * 二段式召回的“选择层”：
 * - 候选排序仍沿用现有 recallRelevantMemories（pinned / explicit / recency 等规则不重写）
 * - 入场资格先保护本轮“精确提到”的候选，再按既有排序填剩余预算
 * - 最终返回顺序仍恢复为候选原顺序，不重新洗牌
 * - 生产路径按 buildMemoryBlock 的最终渲染字符串计 token，防止格式展开后实际超预算
 */
export function selectMemoryWorkingSet(
  candidates: MemoryItem[],
  options: MemoryWorkingSetOptions = {},
): MemoryWorkingSetResult {
  const list = Array.isArray(candidates)
    ? candidates.filter((m): m is MemoryItem => m != null && typeof m.text === 'string' && m.text.trim().length > 0)
    : []
  const tokenBudget = Math.max(0, Math.floor(options.tokenBudget ?? MEMORY_WORKING_SET_TOKEN_BUDGET))
  const maxItems = Math.max(0, Math.floor(options.maxItems ?? MEMORY_WORKING_SET_MAX_ITEMS))

  if (list.length === 0 || tokenBudget <= 0 || maxItems === 0) {
    return { items: [], estimatedTokens: 0, truncated: list.length > 0 }
  }

  const indexed = list.map((item, index) => ({ item, index }))
  const exact = options.userText
    ? indexed.filter(({ item }) => isSpecificMemoryMatch(item, options.userText ?? ''))
    : []
  const exactIndexes = new Set(exact.map(({ index }) => index))
  const admissionOrder = [
    ...exact,
    ...indexed.filter(({ index }) => !exactIndexes.has(index)),
  ]

  const selectedIndexes = new Set<number>()

  for (const candidate of admissionOrder) {
    if (selectedIndexes.size >= maxItems) break

    const trialIndexes = [...selectedIndexes, candidate.index].sort((a, b) => a - b)
    const trial = trialIndexes.map((index) => list[index])
    if (selectionTokens(trial, options.renderBlock) > tokenBudget) continue
    selectedIndexes.add(candidate.index)
  }

  const items = [...selectedIndexes]
    .sort((a, b) => a - b)
    .map((index) => list[index])
  const estimatedTokens = selectionTokens(items, options.renderBlock)

  return {
    items,
    estimatedTokens,
    truncated: items.length < list.length,
  }
}

/**
 * lastMentionedAt 只能由“用户真的再次提到”推进。
 * 系统把一条记忆召回/注入，不再等价于用户提到它，避免热点自强化。
 */
export function shouldTouchMemoryFromUser(item: MemoryItem, userText: string): boolean {
  return isSpecificMemoryMatch(item, userText)
}
