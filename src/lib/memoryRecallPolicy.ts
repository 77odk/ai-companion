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
  '今天', '昨天', '明天', '前天', '后天', '最近', '现在', '刚才', '刚刚',
  '今年', '本月', '这个月', '每天', '每日', '天天', '每年', '每月', '每周', '每星期',
  '周末', '工作日', '平时', '经常', '总是', '有时', '偶尔',
  '凌晨', '早晨', '早上', '上午', '中午', '下午', '傍晚', '晚上', '深夜', '今早', '今晚',
  '感觉', '觉得', '喜欢', '真的', '还是', '可以', '需要', '可能',
  '就是', '这个', '那个', '其实', '然后', '但是', '因为', '所以',
].sort((a, b) => b.length - a.length)

const GENERIC_TOPIC_SEGMENTS = new Set([
  '工作', '饮食', '宠物', '家人', '健康', '日子', '其他',
])

/** 这些词描述“属性槽位”而不是所属实体；单独重合不足以证明是同一条事实。 */
const GENERIC_ATTRIBUTE_SEGMENTS = new Set([
  '工资', '体重', '身高', '年龄', '岁数', '血压', '体温',
])

const COMMON_ENGLISH = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from',
  'that', 'this', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'we', 'our', 'ours', 'they', 'their', 'them',
  'user', 'self', 'like', 'likes', 'liked', 'want', 'wants', 'wanted', 'think', 'thinks',
  'know', 'knows', 'today', 'yesterday', 'tomorrow', 'now', 'recently', 'really', 'very',
])

const GENERIC_ENGLISH_UNITS = new Set([
  'kg', 'kgs', 'kilogram', 'kilograms', 'lb', 'lbs', 'pound', 'pounds',
  'cm', 'centimeter', 'centimeters', 'meter', 'meters', 'yuan', 'dollar', 'dollars',
  'year', 'years', 'month', 'months', 'day', 'days', 'hour', 'hours', 'minute', 'minutes',
])

const ZH_NUM = '〇零一二三四五六七八九十百千两廿卅'

/**
 * 统一剥离“何时”而不是靠枚举单词补洞。
 * 时间相同不代表事实相同；真正动作/对象会留给后续事实匹配。
 */
function stripChineseTimeExpressions(text: string): string {
  const zh = ZH_NUM
  return text
    // 星期：周一 / 星期一 / 礼拜一 / 本周一 / 下星期三。
    .replace(new RegExp(`(?:上|下|这|本)?(?:周|星期|礼拜)[一二三四五六日天]`, 'g'), ' ')
    .replace(/(?:上|下|这|本)?周末/g, ' ')
    .replace(/(?:上|下|这|本)(?:周|星期|礼拜|个月|月)/g, ' ')
    // 阿拉伯数字日期：2026年10月4日、10月4号、2026-10-04、10/04。
    .replace(/\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}/g, ' ')
    .replace(/\d{1,2}[-/.]\d{1,2}/g, ' ')
    // 中文数字日期：十月四日、二〇二六年十月四日、每月一号/每个月一号。
    .replace(new RegExp(`[${zh}]{2,4}\\s*年\\s*[${zh}]{1,3}\\s*月\\s*[${zh}]{1,3}\\s*[日号]?`, 'g'), ' ')
    .replace(new RegExp(`每(?:个)?月\\s*(?:\\d{1,2}|[${zh}]{1,3})\\s*[日号]`, 'g'), ' ')
    .replace(new RegExp(`[${zh}]{1,3}\\s*月\\s*[${zh}]{1,3}\\s*[日号]`, 'g'), ' ')
    // 完整周期日期先吃掉后，再清理剩余“每年/每月/每周”等纯时间骨架，避免留下“一号”。
    .replace(/每(?:个)?(?:年|月|周|星期|天|日)/g, ' ')
    // 纯时长不是事实实体：半小时、30分钟、三天等。
    .replace(new RegExp(`(?:半|\\d+(?:\\.\\d+)?|[${zh}]{1,6})\\s*(?:个)?\\s*(?:秒|分钟|小时|刻钟|天|周|月|年)(?:后|前|内|左右)?`, 'g'), ' ')
    // 钟点：8点、8:30、上午8点半、晚上九点。
    .replace(new RegExp(`(?:凌晨|早上|上午|中午|下午|傍晚|晚上|深夜)?\\s*(?:\\d{1,2}|[${zh}]{1,3})\\s*(?::|：)\\s*\\d{1,2}`, 'g'), ' ')
    .replace(new RegExp(`(?:凌晨|早上|上午|中午|下午|傍晚|晚上|深夜)?\\s*(?:\\d{1,2}|[${zh}]{1,3})\\s*(?:点|时)(?:半|\\d{1,2}\\s*分)?`, 'g'), ' ')
}

/**
 * 量词/单位只有和数字一起才有辨识力；先剥离，避免“岁/元/公斤”自己变成实体证据。
 * 例如“咪咪今年3岁”会留下“咪咪”，使 3→4 岁的纠正仍能凭实体命中。
 */
function stripNumericUnits(text: string): string {
  const zh = ZH_NUM
  return text.replace(
    new RegExp(`(?:\\d+(?:\\.\\d+)?|[${zh}]{1,6})\\s*(?:岁|元|块钱?|只|个|公斤|千克|斤|厘米|毫米|公里|次)`, 'g'),
    ' ',
  )
}

function chineseSpecificSegments(text: string): string[] {
  let raw = stripNumericUnits(
    stripChineseTimeExpressions(
      String(text ?? '')
        .toLowerCase()
        .replace(/用户|对方|ta/g, ' '),
    ),
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
    .filter((part) => Boolean(part) && !GENERIC_TOPIC_SEGMENTS.has(part))
}

function numberUnitAnchors(text: string): Set<string> {
  // 先去掉日期/钟点/时长，防止时间数字自己成为事实锚点。
  const raw = stripChineseTimeExpressions(String(text ?? '').toLowerCase())
  const anchors = new Set<string>()
  const zh = ZH_NUM
  const matches = raw.match(
    new RegExp(`(?:\\d+(?:\\.\\d+)?|[${zh}]{1,6})\\s*(?:岁|元|块钱?|只|个|公斤|千克|斤|厘米|毫米|公里|次)`, 'g'),
  ) ?? []
  for (const match of matches) anchors.add(match.replace(/\s+/g, ''))
  return anchors
}

function englishSpecificWords(text: string): string[] {
  return (String(text ?? '').toLowerCase().match(/[a-z]+/g) ?? [])
    .filter((word) =>
      word.length >= 3 &&
      !COMMON_ENGLISH.has(word) &&
      !GENERIC_ENGLISH_UNITS.has(word),
    )
}

function lexicalSignals(text: string): {
  source: string
  raw: string
  english: string[]
  chinese: string[]
  numberAnchors: Set<string>
} {
  const source = String(text ?? '')
  const raw = source.toLowerCase()
  return {
    source,
    raw,
    english: englishSpecificWords(raw),
    chinese: chineseSpecificSegments(raw),
    numberAnchors: numberUnitAnchors(raw),
  }
}

const SELF_OWNER = '__self__'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^{}()|[\]\\]/g, '\\$&')
}

function normalizeOwner(value: string | undefined | null): string | null {
  const owner = String(value ?? '').trim().toLowerCase().replace(/[’']/g, '')
  if (!owner) return null
  if (COMMON_ENGLISH.has(owner) || GENERIC_ENGLISH_UNITS.has(owner)) return null
  if (GENERIC_TOPIC_SEGMENTS.has(owner) || GENERIC_ATTRIBUTE_SEGMENTS.has(owner)) return null
  if (GENERIC_ZH_PHRASES.includes(owner)) return null
  return owner
}

/**
 * owner 只在共享事实附近抽取，不把整句压成 self/non-self。
 * - my weight / 我的工资 → __self__
 * - Mimi's weight / weight of Mimi / 小夏的工资 → 对应实体
 * - 没有明确 owner → null（允许用户省略主语继续说同一件事）
 */
function explicitEnglishOwner(raw: string, evidence: string): string | null {
  const word = escapeRegExp(evidence)
  if (new RegExp(`\\b(?:my|mine|myself|user(?:['’]s)?)\\s+${word}\\b`, 'i').test(raw)) {
    return SELF_OWNER
  }

  const possessive = raw.match(new RegExp(`\\b([a-z][a-z'-]{1,30})['’]s\\s+${word}\\b`, 'i'))
  const possessiveOwner = normalizeOwner(possessive?.[1])
  if (possessiveOwner) return possessiveOwner

  const after = raw.match(new RegExp(`\\b${word}\\s+of\\s+([a-z][a-z'-]{1,30})\\b`, 'i'))
  return normalizeOwner(after?.[1])
}

function capitalizedEnglishContextOwner(source: string, evidence: string): string | null {
  const word = escapeRegExp(evidence)
  const before = source.match(new RegExp(`\\b([A-Z][A-Za-z'-]{1,30})\\s+${word}\\b`))
  const beforeOwner = normalizeOwner(before?.[1])
  if (beforeOwner) return beforeOwner
  const after = source.match(new RegExp(`\\b${word}\\s+(?:of\\s+)?([A-Z][A-Za-z'-]{1,30})\\b`))
  return normalizeOwner(after?.[1])
}

/** 主谓句里的实体也属于事实 owner；不能只认紧贴属性词的所有格。 */
function grammaticalEnglishOwner(source: string, evidence: string): string | null {
  const word = escapeRegExp(evidence)
  const subject = source.match(
    new RegExp(
      `\\b(I|[A-Z][A-Za-z'-]{1,30})\\s+(?:(?:am|is|are|was|were|has|have|had|does|do|did|can|could|will|would|feels?|gets?)\\s+)?(?:[a-z]+\\s+){0,2}${word}\\b`,
    ),
  )
  if (!subject?.[1]) return null
  if (/^i$/i.test(subject[1])) return SELF_OWNER
  return normalizeOwner(subject[1])
}

function explicitChineseOwner(raw: string, evidence: string): string | null {
  const compact = String(raw ?? '').replace(/\\s+/g, '')
  const shared = escapeRegExp(evidence)

  if (new RegExp(`(?:我|本人|自己)(?:的)?${shared}`).test(compact)) return SELF_OWNER

  const possessive = compact.match(new RegExp(`([\\u4e00-\\u9fff]{1,6})的${shared}`))
  const possessiveOwner = normalizeOwner(possessive?.[1])
  if (possessiveOwner) return possessiveOwner

  const after = compact.match(new RegExp(`${shared}(?:是|属于)?([\\u4e00-\\u9fff]{1,4})的`))
  return normalizeOwner(after?.[1])
}

function normalizeChineseSubject(value: string | undefined): string | null {
  const subject = String(value ?? '').trim()
  if (!subject) return null
  if (subject === '我' || subject === '本人' || subject === '自己' || subject === '用户') return SELF_OWNER
  if (subject === '我的' || subject === '本人的' || subject === '自己的') return SELF_OWNER
  return normalizeOwner(subject)
}

/** “我妹妹喜欢咖啡 / 小夏工资…”这类主谓结构的主体必须参与 owner 校验。 */
function grammaticalChineseOwner(raw: string, evidence: string): string | null {
  const compact = String(raw ?? '').replace(/\\s+/g, '')
  const index = compact.lastIndexOf(evidence)
  if (index < 0) return null
  const clause = compact.slice(0, index).split(/[，。！？；]/).at(-1) ?? ''

  // 证据本身就是“工资/体重/年龄”等属性槽位时，谓词已被 slice 掉。
  // 此时直接从属性前缀里去掉时间/语气词，剩下的就是主体（小夏最近工资 → 小夏）。
  if (GENERIC_ATTRIBUTE_SEGMENTS.has(evidence)) {
    let ownerPrefix = stripChineseTimeExpressions(clause)
    for (const phrase of GENERIC_ZH_PHRASES) ownerPrefix = ownerPrefix.replaceAll(phrase, '')
    ownerPrefix = ownerPrefix.replace(/(?:最近|目前|现在|还是|又|刚|刚刚|大概|大约|差不多)+$/g, '')
    const owner = normalizeChineseSubject(ownerPrefix)
    if (owner) return owner
  }

  const match = clause.match(
    /^([\u4e00-\u9fff]{1,8}?)(?:特别|非常|比较|有点)?(?:喜欢|爱吃|爱喝|爱|讨厌|害怕|怕|过敏|工资|体重|身高|年龄|岁数|血压|体温|是|有|养|喝|吃)/,
  )
  return normalizeChineseSubject(match?.[1])
}

function contextOwnerFromText(value: string, evidence: string): string | null {
  const index = value.indexOf(evidence)
  if (index < 0) return null
  const before = value.slice(0, index).trim()
  const after = value.slice(index + evidence.length).trim()
  // 这里只是无“的”的实体兜底（咪咪体重 / 小夏工资）。
  // 单字前后缀更常是“想/要/又/涨”等动作或语气，不能当 owner，否则会把正常续聊误判成跨实体。
  const beforeOwner = before.length >= 2 ? normalizeOwner(before.slice(-6)) : null
  // 属性词后的内容是“涨了/变了/六千元”等谓语或值，不是 owner。
  // 用户只说“工资最近涨了”时应视为省略主体继续上一事实，而不是把“最近涨了”当实体。
  if (GENERIC_ATTRIBUTE_SEGMENTS.has(evidence)) return beforeOwner
  const afterOwner = after.length >= 2 ? normalizeOwner(after.slice(0, 6)) : null
  return beforeOwner || afterOwner
}

function evidenceOwnersCompatible(
  memoryExplicit: string | null,
  userExplicit: string | null,
  memoryContext: string | null,
  userContext: string | null,
): boolean {
  // 显式 owner（我的 / X 的 / X's / of X）优先。
  const memoryOwner = memoryExplicit || memoryContext
  const userOwner = userExplicit || userContext

  // 一边省略主语继续说同一件事时不做否决；双方都有 owner/context 才比较。
  if (!memoryOwner || !userOwner) return true
  return memoryOwner === userOwner
}

function hasSpecificEnglishOverlap(
  memorySource: string,
  userSource: string,
  memoryRaw: string,
  userRaw: string,
  memoryWords: string[],
  userWords: string[],
): boolean {
  const userSet = new Set(userWords)
  for (const word of memoryWords) {
    if (!userSet.has(word)) continue

    const memoryExplicit = explicitEnglishOwner(memoryRaw, word)
    const userExplicit = explicitEnglishOwner(userRaw, word)
    // 英文普通相邻动词/形容词（weight changed）不是 owner；
    // 省略所有格时只把保留大小写的专名（Mimi weight）当实体上下文。
    const memoryContext = grammaticalEnglishOwner(memorySource, word) || capitalizedEnglishContextOwner(memorySource, word)
    const userContext = grammaticalEnglishOwner(userSource, word) || capitalizedEnglishContextOwner(userSource, word)

    if (!evidenceOwnersCompatible(memoryExplicit, userExplicit, memoryContext, userContext)) continue
    return true
  }
  return false
}

function hasSpecificChineseOverlap(
  memoryRaw: string,
  userRaw: string,
  memorySegments: string[],
  userSegments: string[],
): boolean {
  for (const memory of memorySegments) {
    for (const user of userSegments) {
      const shorter = memory.length <= user.length ? memory : user
      const longer = memory.length <= user.length ? user : memory
      if (shorter.length < 2 || !longer.includes(shorter)) continue

      const memoryExplicit = explicitChineseOwner(memoryRaw, shorter)
      const userExplicit = explicitChineseOwner(userRaw, shorter)
      const memoryContext = grammaticalChineseOwner(memoryRaw, shorter) || contextOwnerFromText(memory, shorter)
      const userContext = grammaticalChineseOwner(userRaw, shorter) || contextOwnerFromText(user, shorter)
      if (!evidenceOwnersCompatible(memoryExplicit, userExplicit, memoryContext, userContext)) continue

      // 裸属性词本身不是事实实体；只有双方都明确绑定到同一 owner 才足以 exact。
      if (GENERIC_ATTRIBUTE_SEGMENTS.has(shorter)) {
        const memoryOwner = memoryExplicit || memoryContext
        const userOwner = userExplicit || userContext
        if (memoryOwner && userOwner && memoryOwner === userOwner) return true
        continue
      }
      return true
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
 * topic 相同、通用词相同、裸数字相同都不够；
 * 必须有具体中文实体/动作、具体英文词，或完整“数字+单位”锚点。
 */
export function isSpecificMemoryMatch(item: MemoryItem, userText: string): boolean {
  const memoryText = String(item?.text ?? '').trim()
  const user = String(userText ?? '').trim()
  if (!memoryText || !user) return false

  const mem = lexicalSignals(memoryText)
  const usr = lexicalSignals(user)

  const sharedNumberAnchor = [...mem.numberAnchors].some((anchor) => usr.numberAnchors.has(anchor))

  const sharedEnglish = hasSpecificEnglishOverlap(
    mem.source,
    usr.source,
    mem.raw,
    usr.raw,
    mem.english,
    usr.english,
  )
  const sharedChinese = hasSpecificChineseOverlap(
    mem.raw,
    usr.raw,
    mem.chinese,
    usr.chinese,
  )
  const anchorOnly =
    mem.english.length === 0 &&
    usr.english.length === 0 &&
    mem.chinese.length === 0 &&
    usr.chinese.length === 0
  const numberAnchorCompatible = sharedNumberAnchor && (sharedChinese || sharedEnglish || anchorOnly)

  // 数字变化不提前否决：若仍有“咪咪”等具体实体证据，纠正旧事实必须能命中。
  // 相同数字+单位也不能绕过所属实体：跨实体必须另有实体证据。
  return numberAnchorCompatible || sharedEnglish || sharedChinese
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
 * - 入场资格：pinned → 本轮精确提到 → 既有候选顺序
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

  if (list.length === 0) {
    return { items: [], estimatedTokens: 0, truncated: false }
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

  // pinned 是用户明确要求“恒带”的事实：普通 working-set 数量 / token 上限只能裁普通候选，
  // 不能静默淘汰 pinned。若 pinned 自身超过预算，宁可让 reported tokens 超预算，也不丢事实。
  const selectedIndexes = new Set<number>(pinnedIndexes)

  if (tokenBudget > 0 && maxItems > 0) {
    for (const candidate of admissionOrder) {
      if (pinnedIndexes.has(candidate.index)) continue
      if (selectedIndexes.size >= maxItems) break

      const trialIndexes = [...selectedIndexes, candidate.index].sort((a, b) => a - b)
      const trial = trialIndexes.map((index) => list[index])
      if (selectionTokens(trial, options.renderBlock) > tokenBudget) continue
      selectedIndexes.add(candidate.index)
    }
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
