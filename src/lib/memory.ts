// 记忆（记住的事实）读写，localStorage 存储
// 既有字段保持兼容：id / text / createdAt / source；新加的 topic / updatedAt 都是可选字段

import { notifyDataChanged } from './dataChange.ts'

export interface MemoryItem {
  id: string
  text: string
  /** 首次记录的时间戳，永远不变（去重命中也不会刷新） */
  createdAt: number
  /** 主题词：TA 记录时带的（如 饮食/宠物/家人…），手动添加可填；旧数据可能没有 */
  topic?: string
  /** 来源：哪次对话的摘要（TA 记住时记下，手动添加的没有此项） */
  source?: string
  /** 兼容旧数据：旧版本去重更新时刷新过的时间，现在不再使用 */
  updatedAt?: number
  /** 重要记忆：用户在记忆页置顶标记，注入时永远排最前、永不进入遗忘/淡化逻辑（旧数据没有 = 不置顶） */
  pinned?: boolean
  /** 最近一次被「想起/提起」的时间戳：很久没提的活跃度低，注入排序时自然沉底，但条目永不被删除（旧数据没有 = 从未被提起过） */
  lastMentionedAt?: number
  /** 双源信任：true=用户亲口明说的（手动添加），注入排序时优先；缺省/缺失=TA 从聊天里推断的、或旧数据（优先级低） */
  explicit?: boolean
}

const MEMORY_KEY = 'ai_companion_memory'

/** 记忆数据变更事件名：保存后广播，记忆页等监听到就重新读取 */
export const MEMORY_UPDATED_EVENT = 'memory-updated'

/** 广播"记忆有变化"：同页签内跨组件通知（storage 事件同页签不触发，所以用自定义事件） */
export function notifyMemoryUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(MEMORY_UPDATED_EVENT))
}

export function loadMemory(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(MEMORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is MemoryItem =>
        m != null && typeof m.id === 'string' && typeof m.text === 'string',
    )
  } catch {
    return []
  }
}

export function saveMemory(items: MemoryItem[]): void {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(items))
  notifyDataChanged()
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 生成一条新记忆的本地 id（本地库与会话缓存共用；后端记忆用后端数字 id 的字符串形式，不走这里） */
export function newMemoryItemId(): string {
  return newId()
}

/**
 * 手动添加一条记忆：可填主题，留空默认「其他」。
 * explicit 表示是否用户明说——手动输入框添加的是用户亲口说的，应传 true；
 * 缺省按 false（推断）处理，与聊天里 TA 自动提取的一致。
 */
export function addMemoryItem(text: string, topic?: string, explicit?: boolean): MemoryItem[] {
  const t = text.trim()
  if (!t) return loadMemory()
  const item: MemoryItem = {
    id: newId(),
    text: t,
    createdAt: Date.now(),
    topic: topic?.trim() || '其他',
    ...(explicit === true ? { explicit: true } : {}),
  }
  const next = [item, ...loadMemory()]
  saveMemory(next)
  return next
}

/**
 * 切换一条记忆的来源标记：explicit=true 记为「用户明说」，explicit=false 记为「TA 推断」。
 * 返回更新后的全部记忆，并广播记忆变更事件（与 togglePinMemory 一致）。
 */
export function setMemoryExplicit(id: string, explicit: boolean): MemoryItem[] {
  const next = loadMemory().map((m) => {
    if (m.id !== id) return m
    if (explicit) return { ...m, explicit: true }
    const { explicit: _drop, ...rest } = m
    return rest
  })
  saveMemory(next)
  notifyMemoryUpdated()
  return next
}

export function removeMemoryItem(id: string): MemoryItem[] {
  const next = loadMemory().filter((m) => m.id !== id)
  saveMemory(next)
  return next
}

/**
 * 编辑一条记忆的文字内容（手动改），返回更新后的全部记忆。
 * 只改 text，不动 createdAt/topic/source/pinned 等字段；找不到原条目则原样返回。
 */
export function updateMemoryItemContent(id: string, text: string): MemoryItem[] {
  const t = text.trim()
  if (!t) return loadMemory()
  const next = loadMemory().map((m) => (m.id === id ? { ...m, text: t } : m))
  saveMemory(next)
  notifyMemoryUpdated()
  return next
}

/** 切换一条记忆的「重要」标记（置顶/取消置顶），返回更新后的全部记忆 */
export function togglePinMemory(id: string): MemoryItem[] {
  const next = loadMemory().map((m) => (m.id === id ? { ...m, pinned: !m.pinned } : m))
  saveMemory(next)
  notifyMemoryUpdated()
  return next
}

/**
 * 刷新一条记忆的「最近提起」活跃度：把 lastMentionedAt 更新为 now
 * （用户提起相关话题、或注入对话时调用）。
 * 不广播 MEMORY_UPDATED_EVENT——这个调用比较频繁，广播会让记忆页跟着频繁刷新；
 * 只更新数据 + localStorage。返回更新后的全部记忆。
 */
export function touchMemory(id: string, now: number = Date.now()): MemoryItem[] {
  const next = loadMemory().map((m) => (m.id === id ? { ...m, lastMentionedAt: now } : m))
  saveMemory(next)
  return next
}

// ---- TA 自主记住：去重写入 ----

/** 归一化：去空白和常见标点，统一小写，用来比"像不像" */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　，。！？、,.!?;；：:""''（）()~～—\-·]/g, '')
}

/** 取字符二元组集合，用来算中文短句的相似度 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  return out
}

/** 去掉口水词/代词，保留关键词（用于短句近似去重） */
function stripNoise(s: string): string {
  return s
    .replace(/我喜欢|我爱|我特别|我超|人家|我的|我就是|就是|了|呢|啊|吧|的|很|也|都|还/g, '')
}

/** 两条记忆是否高度相似：完全相同、互相包含，或字符重合度很高 */
function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  // 口水词去除后再看互相包含（「我喜欢吃排骨话梅味的」vs「喜欢吃话梅味的排骨」→ 都剩「吃排骨话梅味」）
  const na = stripNoise(a)
  const nb = stripNoise(b)
  if (na && nb && (na.includes(nb) || nb.includes(na))) return true
  // 短句（去口水词后 ≤10 字）：比「关键词字符集合」重合——词序打乱也能识别
  //（「吃排骨话梅味」vs「话梅味排骨吃」→ 字符集合几乎相同）
  if (na && nb && na.length <= 10 && nb.length <= 10) {
    const charsA = new Set(na.split(''))
    const charsB = new Set(nb.split(''))
    let same = 0
    for (const c of charsA) if (charsB.has(c)) same++
    const union = charsA.size + charsB.size - same
    if (union > 0 && same / union > 0.7) return true
  }
  // 还不行就比二元组重合度
  const A = bigrams(a)
  const B = bigrams(b)
  let same = 0
  for (const g of A) if (B.has(g)) same++
  const union = A.size + B.size - same
  if (union === 0) return false
  return same / union > 0.6
}

/**
 * TA 记住一条内容：先去重——和已有记忆高度相似的，只保留原条目，
 * 不新增、不改 createdAt、不刷日期、不累计次数（首次记住的时间永远不变）。
 * 真没有相同内容才新增一条。返回更新后的全部记忆。
 */
export function upsertMemoryItem(text: string, source?: string, topic?: string, explicit?: boolean): MemoryItem[] {
  const trimmed = text.trim()
  if (!trimmed) return loadMemory()
  const items = loadMemory()
  const norm = normalize(trimmed)
  const idx = items.findIndex((m) => isSimilar(normalize(m.text), norm))
  if (idx >= 0) return items

  const item: MemoryItem = {
    id: newId(),
    text: trimmed,
    createdAt: Date.now(),
    source,
    ...(topic?.trim() ? { topic: topic.trim() } : {}),
    ...(explicit === true ? { explicit: true } : {}),
  }
  const next = [item, ...items]
  saveMemory(next)
  return next
}

/** 新内容是否与已有记忆高度相似（去重用；本地库与会话缓存共用同一套判断） */
export function isSimilarMemory(items: MemoryItem[], text: string): boolean {
  const norm = normalize(String(text ?? '').trim())
  if (!norm) return false
  return items.some((m) => m != null && typeof m.text === 'string' && isSimilar(normalize(m.text), norm))
}

// ---- 记忆主题推断（旧数据没有 topic 时展示用） ----

const TOPIC_RULES: Array<[RegExp, string]> = [
  [/吃|喝|辣|甜|口味|饭|菜|食|饿|饱|早餐|午餐|晚餐|奶茶|咖啡|零食/, '饮食'],
  [/猫|狗|宠物|猫咪|小狗|铲屎|毛孩子|遛/, '宠物'],
  [/爸|妈|父母|爸爸|妈妈|爷爷|奶奶|外公|外婆|哥哥|姐姐|弟弟|妹妹|女儿|儿子|家人|孩子|结婚/, '家人'],
  [/睡|病|血压|健康|身体|疼|痛|药|感冒|发烧|失眠|体检|医生|医院|熬夜|胃|头疼/, '健康'],
  [/工作|上班|公司|同事|加班|老板|出差|开会|项目|辞职|离职|入职|绩效|裁员/, '工作'],
  [/生日|纪念日|周年|节日|过节|日期|纪念|周末|长假/, '日子'],
]

/** 旧记忆没有主题时，按关键词猜一个主题；猜不出就是「其他」 */
export function inferTopic(text: string): string {
  for (const [re, topic] of TOPIC_RULES) {
    if (re.test(text)) return topic
  }
  return '其他'
}

// ---- 聊天消息里的记忆标记 ----

/** TA 自主记住时用的输出标记：一整行「【记忆】内容」或「【记忆·主题】内容」 */
export const MEMORY_MARKER = '【记忆】'

export interface ExtractedMemory {
  /** 主题词，可能没有（旧格式只写了【记忆】内容） */
  topic?: string
  text: string
}

/** 从一条回复里提取记忆（每个「【记忆】xxx」或「【记忆·主题】xxx」一行算一条） */
export function extractMemories(text: string): ExtractedMemory[] {
  const out: ExtractedMemory[] = []
  for (const line of text.split('\n')) {
    const m = /^\s*【记忆(?:[·・]\s*([^】]+))?】\s*(.+?)\s*$/.exec(line)
    if (m && m[2]) out.push({ ...(m[1]?.trim() ? { topic: m[1].trim() } : {}), text: m[2].trim() })
  }
  return out
}

/** 去掉回复里的记忆标记行（仅展示用；存储里保留原文） */
export function stripMemoryMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*【记忆/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---- 显式记忆指令检测（TASK-LM1：用户明说"帮我记一下"等硬触发；反问修复） ----

/** 显式指令关键词：命中任一即视为用户要求记住（导出供 Chat 与测试使用） */
export const MEMORY_INSTRUCTION_KEYWORDS = [
  '帮我记一下',
  '帮我记',
  '记一下',
  '记住',
  '记下来',
  '别忘了',
  '你要记住',
  '你记着',
  '你记住',
]

/** 反问/催促类：用户没直说"帮我记"但明显在要求记（关键词只是反问题里的片段，事实在上文） */
const MEMORY_RETORT_PHRASES = [
  '你不记一下吗',
  '记一下啊',
  '记住了吗',
  '你记住了吗',
  '你记住了没',
  '你记着点',
  '记着点',
  '你记住了吧',
  '记住了吧',
]

/**
 * 匹配用关键词：导出列表 + 常见口语组合"帮我记住"（不然会被"帮我记"先命中，去掉后剩"住…"不干净），
 * 按长度降序：优先命中更具体的词（"你要记住"先于"记住"，去掉后事实更完整）。
 */
const MEMORY_KEYWORDS_SORTED = [...new Set([...MEMORY_INSTRUCTION_KEYWORDS, '帮我记住'])].sort(
  (a, b) => b.length - a.length,
)

/** 是否反问/催促（"你不记一下吗""记住了吗"这类）：是 → 事实在上文，交给模型从上下文提取 */
export function isMemoryRetort(text: string): boolean {
  const t = String(text ?? '').trim()
  if (!t) return false
  return MEMORY_RETORT_PHRASES.some((p) => t.includes(p))
}

/**
 * 检测用户消息里的显式记忆指令（纯函数，可 Node 单测）：
 * - 命中任一关键词 → isInstruction=true；fact = 去掉关键词后的剩余文本（trim）
 * - 剩余为空或过短（中文 <4 字）→ fact=null（交给模型提取兜底）
 * - 反问/催促优先：'记住了吗' 含 '记住' 但不是指令，isInstruction=false（事实在上文）
 *   例：'帮我记一下我早班7:50-15:50上班' → { true, '我早班7:50-15:50上班' }
 *       '今天天气不错' → { false, null }
 */
export function detectMemoryInstruction(text: string): { isInstruction: boolean; fact: string | null } {
  const t = String(text ?? '').trim()
  if (!t) return { isInstruction: false, fact: null }
  if (isMemoryRetort(t)) return { isInstruction: false, fact: null }
  for (const kw of MEMORY_KEYWORDS_SORTED) {
    const idx = t.indexOf(kw)
    if (idx < 0) continue
    const fact = (t.slice(0, idx) + t.slice(idx + kw.length)).trim()
    return { isInstruction: true, fact: fact.length >= 4 ? fact : null }
  }
  return { isInstruction: false, fact: null }
}

/**
 * 偏好/事实句自动记忆（2026-08-25 七七反馈：AI 不总带【记忆】标记，靠它自觉靠不住）：
 * 「我喜欢/我爱吃/我讨厌/我害怕/我的XX是/我家的XX」这类客观事实句 → 保底提取存记忆。
 * 命中返回事实文本（可能含完整句子，稍作裁剪），没命中返回 null。
 * 只做浅层正则匹配，宁可漏不可错存（避免把"我喜欢你"这类情绪话当事实记）。
 */
const PREFERENCE_PATTERNS: RegExp[] = [
  /(?:我|人家)(?:最喜欢|最爱吃|喜欢吃|喜欢吃辣|喜欢喝|爱喝|喜欢(?:吃|喝|用|看|听|玩|养|穿))[，,。.！!？?\s](.{2,30})/,
  /我(?:特别|非常|超|很)?(?:喜欢吃|喜欢喝|爱喝|爱吃)(.{1,30})/,
  /我(?:讨厌|不喜欢|吃不了|怕|害怕|过敏|不能吃)(.{2,30})/,
  /我的(?:生日|名字|星座|血型|职业|工作|公司|学校|专业|老家|家乡|家|猫|狗|仓鼠)是(.{2,30})/,
  /我(?:住在|在|家养了|养了|有)(.{2,30})/,
  /我(?:每天|一般|通常|平时)(.{2,30})/,
]

export function detectPreferenceFact(text: string): string | null {
  const t = String(text ?? '').trim()
  if (!t || t.length > 60) return null
  for (const re of PREFERENCE_PATTERNS) {
    const m = re.exec(t)
    // 捕获组至少 1 字就算事实（"我爱吃辣"→"辣"；正则本身已足够具体，不会误抓情绪话）
    if (m && m[1] && m[1].trim().length >= 1) {
      return t
    }
  }
  return null
}

/** 去掉文本里的显式指令关键词（保底写入用）：返回剩余文本；无关键词原样返回 */
export function stripMemoryKeyword(text: string): string {
  const t = String(text ?? '').trim()
  for (const kw of MEMORY_KEYWORDS_SORTED) {
    const idx = t.indexOf(kw)
    if (idx >= 0) return (t.slice(0, idx) + t.slice(idx + kw.length)).trim()
  }
  return t
}

// ---- 记忆注入视角转换：用户说的「我」转成「对方」，防止模型把用户的"我"当成自己的"我" ----

/**
 * 记忆注入前的人称转换：用户聊天里的「我」是用户视角，直接喂给模型会被当成 TA 自己的「我」
 * （豆包 character 这类角色扮演模型尤其敏感）。统一转成「对方」：
 *   「我老公是李贝贝」→「对方老公是李贝贝」
 *   「我的生日是…」 →「对方的生日是…」
 * 「我们」原样保留（是双方的共同语境）。
 */
export function toPromptPerspective(text: string): string {
  return text
    .replace(/我们/g, '\u0000')
    .replace(/我的/g, '对方的')
    .replace(/我/g, '对方')
    .replace(/\u0000/g, '我们')
}

// ---- 记忆活跃度：最近提起的靠前，很久没提的沉底，但永不删除 ----

/** 一条记忆的活跃度时间戳：有最近提起用最近提起，否则用首次记录兜底；两者都没有的按最旧沉底 */
function recencyOf(m: MemoryItem, now: number): number {
  const t =
    typeof m.lastMentionedAt === 'number' && Number.isFinite(m.lastMentionedAt)
      ? m.lastMentionedAt
      : typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)
        ? m.createdAt
        : -Infinity
  // 未来时间戳（时钟漂移等）钳到 now，避免一条异常数据插到最前
  return t === -Infinity ? -Infinity : Math.min(t, now)
}

/**
 * 记忆「活跃度」排序（纯函数，可 Node 单测）：
 * - 重要记忆（pinned）恒排最前，组内保持原顺序（没有 pinned 时间，用原序）
 * - 其余按 lastMentionedAt 降序：最近被提起/想起的靠前；没有 lastMentionedAt 的按 createdAt 降序兜底
 * - 很久没提的自动沉底，但条目本身绝不被删除；用户一提起相关话题，这条又会排到前面去
 */
export function getMemoryRecencyRank(items: MemoryItem[], now: number = Date.now()): MemoryItem[] {
  const valid = (Array.isArray(items) ? items : []).filter(
    (m): m is MemoryItem => m != null && typeof m.text === 'string',
  )
  const pinned: MemoryItem[] = []
  const rest: MemoryItem[] = []
  for (const m of valid) {
    if (m.pinned === true) pinned.push(m)
    else rest.push(m)
  }
  rest.sort((a, b) => recencyOf(b, now) - recencyOf(a, now))
  return [...pinned, ...rest]
}

/**
 * 双源信任排序（仅对话注入用）：重要（pinned）恒最前 → 用户明说的（explicit）次之 → 其余按活跃度。
 * 与 getMemoryRecencyRank 的区别只在 explicit 一档：用户亲口说的信任优先级高于 TA 自己推断的。
 * 纯函数，不修改输入数组；组内稳定排序（活跃度相同保持输入顺序）。
 */
function rankDualSource(items: MemoryItem[], now: number): MemoryItem[] {
  const pinned: MemoryItem[] = []
  const explicit: MemoryItem[] = []
  const rest: MemoryItem[] = []
  for (const m of items) {
    if (m.pinned === true) pinned.push(m)
    else if (m.explicit === true) explicit.push(m)
    else rest.push(m)
  }
  const byRecency = (list: MemoryItem[]) =>
    list.slice().sort((a, b) => recencyOf(b, now) - recencyOf(a, now))
  return [...pinned, ...byRecency(explicit), ...byRecency(rest)]
}

// ---- 按需召回：只带与当前话题相关的记忆进对话，省 token、不稀释注意力 ----

/** 常见单字虚词/代词/助词：不算实词关键词（避免「我/你/的/了」到处命中） */
const STOP_CHARS = new Set(
  '的了是在有和与跟也都就不很好吧吗呢啊呀哦嗯我你他她它们这那个谁什么要会能可去来到上下着过被让把对又再还只才最更太真却向从为因于以及'.split(''),
)

/**
 * 抽候选关键词：
 * - 连续汉字块 ≥2 字：整块 + 逐字拆出的 2 字窗口都算词（长句里能捞到「火锅」「生日」这类词）
 * - 单独出现的单字实词（长度恰为 1 且非助词/代词）算词（如「猫」）
 * - 英文/数字词（≥2 字符）小写算词
 */
function extractKeywords(text: string): { multi: Set<string>; singles: Set<string> } {
  const multi = new Set<string>()
  const singles = new Set<string>()
  const t = String(text ?? '')
  for (const seg of t.split(/[^\p{L}\p{N}]+/u)) {
    if (!seg) continue
    if (/^[一-鿿]+$/.test(seg)) {
      if (seg.length === 1) {
        if (!STOP_CHARS.has(seg)) singles.add(seg)
      } else {
        multi.add(seg)
        for (let i = 0; i < seg.length - 1; i++) multi.add(seg.slice(i, i + 2))
      }
    } else if (seg.length >= 2) {
      multi.add(seg.toLowerCase())
    }
  }
  return { multi, singles }
}

/** 记忆 text 与 contextText 是否有共同实词：2 字以上词有交集，或任一侧的单字实词出现在另一侧文本里 */
function hasCommonKeyword(
  memText: string,
  ctxRaw: string,
  ctxMulti: Set<string>,
  ctxSingles: Set<string>,
): boolean {
  const mem = extractKeywords(memText)
  for (const k of mem.multi) if (ctxMulti.has(k)) return true
  for (const s of mem.singles) if (ctxRaw.includes(s)) return true
  for (const s of ctxSingles) if (memText.includes(s)) return true
  return false
}

export interface RecallOptions {
  /** 兜底条数：无任何命中时取最活跃的前 N 条，默认 5 */
  fallbackCount?: number
  /** 排序基准时间（测试可传固定值），默认 Date.now() */
  now?: number
}

/**
 * 按需召回：对话注入时只带与当前话题相关的记忆 + 重要记忆，其余省略。
 * 匹配规则（简单可靠）：
 * 1. pinned 恒全量包含（重要记忆永远带）
 * 2. 主题命中：contextText 出现某个主题词（吃/猫/家人…）→ 该主题全部记忆带上
 *    （旧数据无 topic 字段的按 inferTopic 推断，避免「养猫」这类记忆落空）
 * 3. 关键词命中：记忆 text 与 contextText 有 ≥1 个共同实词（长度 ≥2 的字/词，单独的单字实词也算）
 * 4. 其余（不相关的非 pinned）不注入
 * 兜底：一条都没命中（context 太短/太泛）→ 退化为最活跃的前 fallbackCount 条（含全部 pinned）
 * 返回排序（双源信任）：pinned 恒最前 → 用户明说的（explicit）次之 → 其余按活跃度。
 * 纯函数，不修改输入数组。
 */
export function recallRelevantMemories(
  items: MemoryItem[],
  contextText: string,
  opts: RecallOptions = {},
): MemoryItem[] {
  const now = opts.now ?? Date.now()
  const fallbackCount = opts.fallbackCount ?? 10
  const valid = (Array.isArray(items) ? items : []).filter(
    (m): m is MemoryItem => m != null && typeof m.text === 'string',
  )
  if (valid.length === 0) return []

  const pinned = valid.filter((m) => m.pinned === true)
  const rest = valid.filter((m) => m.pinned !== true)

  const ctxRaw = String(contextText ?? '')
  const ctxKw = extractKeywords(ctxRaw)

  // 主题命中：context 里出现主题词表里的词 → 该主题全部记忆带上
  const hitTopics = new Set<string>()
  for (const [re, topic] of TOPIC_RULES) {
    if (re.test(ctxRaw)) hitTopics.add(topic)
  }

  const matched: MemoryItem[] = []
  const seen = new Set<string>()
  for (const m of rest) {
    const topic = m.topic?.trim() || inferTopic(m.text)
    if (hitTopics.has(topic)) {
      seen.add(m.id)
      matched.push(m)
      continue
    }
    if (seen.has(m.id)) continue
    if (hasCommonKeyword(m.text, ctxRaw, ctxKw.multi, ctxKw.singles)) {
      seen.add(m.id)
      matched.push(m)
    }
  }

  // 一条都没命中 → 兜底：pinned 全量 + explicit（用户明说）全量 + 其余按活跃度补到 fallbackCount。
  // 刷新对话/无上下文时走这里：保证关键事实（置顶的、用户亲口说的）永远在 TA 的脑子里。
  if (matched.length === 0) {
    const ranked = rankDualSource(valid, now)
    const pin = ranked.filter((m) => m.pinned === true)
    const explicit = ranked.filter((m) => m.explicit === true && m.pinned !== true)
    const others = ranked.filter((m) => m.pinned !== true && m.explicit !== true)
    const restCount = Math.max(0, fallbackCount - pin.length - explicit.length)
    return [...pin, ...explicit, ...others.slice(0, restCount)]
  }

  return rankDualSource([...pinned, ...matched], now)
}
