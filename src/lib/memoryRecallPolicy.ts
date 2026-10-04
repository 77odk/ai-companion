import type { MemoryItem } from './memory.ts'
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

const GENERIC_ZH_PHRASES = [
  '特别喜欢', '非常喜欢', '比较喜欢', '有点喜欢',
  '今天', '昨天', '明天', '最近', '现在', '刚才', '刚刚', '今年', '本月', '这个月',
  '每天', '每日', '天天', '每周', '每星期', '周末', '工作日', '平时', '经常', '总是', '有时', '偶尔',
  '凌晨', '早晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '今早', '今晚',
  '感觉', '觉得', '喜欢', '真的', '还是', '可以', '需要', '可能',
  '就是', '这个', '那个', '其实', '然后', '但是', '因为', '所以',
].sort((a, b) => b.length - a.length)

const COMMON_ENGLISH = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
  'that', 'this', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'their', 'them',
  'user', 'self', 'like', 'likes', 'liked', 'want', 'wants', 'wanted', 'think', 'thinks',
  'know', 'knows', 'today', 'yesterday', 'tomorrow', 'now', 'recently', 'really', 'very',
])

function stripChineseTimeExpressions(text: string): string {
  return text
    // 星期骨架：周一 / 星期一 / 礼拜一，以及“本周一 / 下星期三”等。
    .replace(/(?:上|下|这|本)?(?:周|星期|礼拜)[一二三四五六日天]/g, ' ')
    .replace(/(?:上|下|这|本)?周末/g, ' ')
    // 数字日期：2026年10月4日、10月4号、2026-10-04、10/04。
    .replace(/\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[-/.]\d{1,2}/g, ' ')
    // 中文数字日期：十月四日、二〇二六年十月四日、每月一号。
    .replace(/[〇零一二三四五六七八九十百千]{2,4}\s*年\s*[〇零一二三四五六七八九十廿卅]{1,3}\s*月\s*[〇零一二三四五六七八九十廿卅]{1,3}\s*[日号]?/g, ' ')
    .replace(/每月\s*(?:\d{1,2}|[〇零一二三四五六七八九十廿卅]{1,3})\s*[日号]/g, ' ')
    .replace(/[〇零一二三四五六七八九十廿卅]{1,3}\s*月\s*[〇零一二三四五六七八九十廿卅]{1,3}\s*[日号]/g, ' ')
    // 纯时长不是事实实体：半小时、30分钟、三天等先剥离；真正动作/对象仍留在文本里。
    .replace(/(?:半|\d+(?:\.\d+)?|[一二三四五六七八九十百]{1,4})\s*(?:分钟|小时|天|周|个月|月|年)/g, ' ')
    // 钟点：8点、8:30、上午8点半、晚上九点（中文数字钟点也覆盖）。
    .replace(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上|深夜)?\s*(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?::|：)\s*\d{1,2}/g, ' ')
    .replace(/(?:凌晨|早上|上午|中午|下午|傍晚|晚上|深夜)?\s*(?:\d{1,2}|[一二三四五六七八九十]{1,3})\s*(?:点|时)(?:半|\d{1,2}\s*分)?/g, ' ')
}

function chineseSpecificSegments(text: string): string[] {
  let raw = stripChineseTimeExpressions(
    String(text ?? '')
      .toLowerCase()
      .replace(/用户|对方|ta/g, ' '),
  )

  for (const phrase of GENERIC_ZH_PHRASES) raw = raw.split(phrase).join(' ')

  let normalized = ''
  for (const char of raw) {
    if (/[\u4e00-\u9fff]/.test(char) && !STOP_CHARS.has(char)) normalized += char
    else normalized += ' '
  }

  return normalized
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function lexicalSignals(text: string): {
  english: Set<string>
  chinese: string[]
  numberAnchors: Set<string>
} {
  const raw = String(text ?? '').toLowerCase()
  return {
    english: new Set(
      (raw.match(/[a-z]+/g) ?? [])
        .filter((word) => word.length >= 3 && !COMMON_ENGLISH.has(word)),
    ),
    chinese: chineseSpecificSegments(raw),
    numbers: new Set(raw.match(/\d+(?:\.\d+)?/g) ?? []),
  }
}

function hasSpecificChineseOverlap(memorySegments: string[], userSegments: string[]): boolean {
  for (const memory of memorySegments) {
    for (const user of userSegments) {
      const shorter = memory.length <= user.length ? memory : user
      const longer = memory.length <= user.length ? user : memory
      // 两字以上的具体连续片段才足以构成事实级证据；不再用任意二元窗口。
      if (shorter.length >= 2 && longer.includes(shorter)) return true
    }
  }

  // 单字实体只在用户本轮真正只点了这一个具体字时放行，例如“猫”。
  const userSingle = userSegments.length === 1 && userSegments[0].length === 1
    ? userSegments[0]
    : null
  if (!userSingle) return false
  return memorySegments.some((segment) => segment.includes(userSingle))
}

/**
 * 判断“当前用户原话”是否确实点到这条记忆。
 * topic 相同、通用词相同、任意中文二元窗口相同都不够；
 * 必须有具体中文片段、具体英文词或明确数字证据。
 */
export function isSpecificMemoryMatch(item: MemoryItem, userText: string): boolean {
  const memoryText = String(item?.text ?? '').trim()
  const user = String(userText ?? '').trim()
  if (!memoryText || !user) return false

  const mem = lexicalSignals(memoryText)
  const usr = lexicalSignals(user)

  const sharedNumberAnchor = [...mem.numberAnchors].some((anchor) => usr.numberAnchors.has(anchor))

  let sharedEnglish = false
  for (const word of mem.english) {
    if (!usr.english.has(word)) continue
    sharedEnglish = true
    break
  }
  const sharedChinese = hasSpecificChineseOverlap(mem.chinese, usr.chinese)

  // 裸数字永远不能单独构成事实级证据；“数字+单位”可作为一个完整事实锚点。
  // 数字发生变化也不提前否决：若仍有“咪咪”等具体实体证据，纠正旧事实必须能命中。
  return sharedNumberAnchor || sharedEnglish || sharedChinese
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
  const pinned = indexed.filter(({ item }) => item.pinned === true)
  const pinnedIndexes = new Set(pinned.map(({ index }) => index))
  const exact = options.userText
    ? indexed.filter(({ item, index }) =>
        !pinnedIndexes.has(index) && isSpecificMemoryMatch(item, options.userText ?? ''),
      )
    : []
  const exactIndexes = new Set(exact.map(({ index }) => index))
  const admissionOrder = [
    ...pinned,
    ...exact,
    ...indexed.filter(({ index }) => !pinnedIndexes.has(index) && !exactIndexes.has(index)),
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
