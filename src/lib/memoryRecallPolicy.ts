import type { MemoryItem } from './memory.ts'
import { inferTopic } from './memory.ts'
import { estimateToken } from './token.ts'

/**
 * Memory Recall 2.0 的薄治理层。
 * 不改 MemoryItem / memory.ts / sessionStore 数据层，只对“本轮准备注入的候选”做二次筛选。
 */
export const MEMORY_WORKING_SET_TOKEN_BUDGET = 1200
export const MEMORY_WORKING_SET_MAX_ITEMS = 10

/** buildMemoryBlock 的标题、日期、source 标签等固定开销预留。 */
const MEMORY_BLOCK_RESERVE_TOKENS = 80
const MEMORY_LINE_OVERHEAD_TOKENS = 20

export interface MemoryWorkingSetOptions {
  tokenBudget?: number
  maxItems?: number
}

export interface MemoryWorkingSetResult {
  items: MemoryItem[]
  estimatedTokens: number
  truncated: boolean
}

/**
 * 二段式召回的“选择层”：
 * - 候选顺序完全沿用现有 recallRelevantMemories（pinned / explicit / recency 等现有规则不重写）
 * - 只做 token + item 双上限，防止 explicit fallback / topic 命中把整库全塞进 prompt
 * - 不修改输入数组，不写任何持久化状态
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

  if (list.length === 0 || tokenBudget <= MEMORY_BLOCK_RESERVE_TOKENS || maxItems === 0) {
    return { items: [], estimatedTokens: 0, truncated: list.length > 0 }
  }

  const selected: MemoryItem[] = []
  let used = MEMORY_BLOCK_RESERVE_TOKENS

  for (const item of list) {
    if (selected.length >= maxItems) break
    const tokens = estimateToken(item.text) + MEMORY_LINE_OVERHEAD_TOKENS
    if (used + tokens > tokenBudget) continue
    selected.push(item)
    used += tokens
  }

  return {
    items: selected,
    estimatedTokens: selected.length > 0 ? used : 0,
    truncated: selected.length < list.length,
  }
}

const STOP_CHARS = new Set(
  '的了是在有和与跟也都就不很好吧吗呢啊呀哦嗯我你他她它们这那个谁什么要会能可去来到上下着过被让把对又再还只才最更太真却向从为因于以及'.split(''),
)

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
  const english = new Set((raw.match(/[a-z]+/g) ?? []).filter((word) => word.length >= 3))
  const chineseSingles = new Set<string>()
  const chineseBigrams = new Set<string>()

  for (const run of raw.match(/[\u4e00-\u9fff]+/g) ?? []) {
    for (const char of run) {
      if (!STOP_CHARS.has(char)) chineseSingles.add(char)
    }
    for (let i = 0; i < run.length - 1; i++) {
      const pair = run.slice(i, i + 2)
      if ([...pair].every((char) => !STOP_CHARS.has(char))) chineseBigrams.add(pair)
    }
  }

  return { english, chineseBigrams, chineseSingles }
}

/**
 * lastMentionedAt 只能由“用户真的再次提到”推进。
 * 系统把一条记忆召回/注入，不再等价于用户提到它，避免热点自强化。
 */
export function shouldTouchMemoryFromUser(item: MemoryItem, userText: string): boolean {
  const memoryText = String(item?.text ?? '').trim()
  const user = String(userText ?? '').trim()
  if (!memoryText || !user) return false

  const a = normalize(memoryText)
  const b = normalize(user)
  if (!a || !b) return false

  // 明确短词（如“猫”）或较长短语直接出现，视为用户真实再次提到。
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length >= 2 && longer.includes(shorter)) return true
  if (shorter.length === 1 && !STOP_CHARS.has(shorter) && longer.includes(shorter)) return true

  const mem = lexicalSignals(memoryText)
  const usr = lexicalSignals(user)

  for (const word of mem.english) if (usr.english.has(word)) return true
  for (const pair of mem.chineseBigrams) if (usr.chineseBigrams.has(pair)) return true

  let sharedSingles = 0
  for (const char of mem.chineseSingles) {
    if (!usr.chineseSingles.has(char)) continue
    sharedSingles++
    if (sharedSingles >= 2) return true
  }

  // topic 只能作为辅助证据，不能因为都属于“工作/饮食”就把整组记忆一起 touch。
  const memoryTopic = item.topic?.trim() || inferTopic(memoryText)
  const userTopic = inferTopic(user)
  return memoryTopic !== '其他' && memoryTopic === userTopic && sharedSingles >= 1
}
