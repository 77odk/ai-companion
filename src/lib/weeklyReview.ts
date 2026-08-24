// 周记数据与生成（W1）
// TA 每周写一篇「我们这周」的日记，用户可批注，TA 下周回应。
// 纯逻辑（getWeeklyReviews / shouldGenerateWeekly / buildWeeklyPrompt / extractTitle / 周区间计算）
// 不依赖组件，可被 Node 脚本直接跑单测；localStorage 读写只在函数内。
// 周记数据存 localStorage（一期不做后端）；生成走用户 key 非流式调用（调 API 在组件里做）。

export interface WeeklyReply {
  content: string
  repliedAt: number
}

export interface WeeklyReview {
  id: string
  /** '第 N 周 · 8月18日-8月24日' */
  weekLabel: string
  title: string
  content: string
  createdAt: number
  /** 用户批注：TA 下周写周记时会看到并回应（纯本地存储，不调 API） */
  myReply?: WeeklyReply
  /** 这篇周记覆盖的时间窗口（生成时定下，供下次筛选本周素材） */
  generatedFrom?: { startTs: number; endTs: number }
}

const WEEKLY_KEY = 'ai_companion_weekly_reviews'

/** 读取全部周记：损坏/格式不对的条目被过滤；返回按 createdAt 降序 */
export function getWeeklyReviews(): WeeklyReview[] {
  try {
    const raw = localStorage.getItem(WEEKLY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const list = arr.filter(
      (r): r is WeeklyReview =>
        r != null &&
        typeof r.id === 'string' &&
        typeof r.weekLabel === 'string' &&
        typeof r.title === 'string' &&
        typeof r.content === 'string' &&
        typeof r.createdAt === 'number',
    )
    return list.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

/** 保存全部周记（纯本地，不进账号同步，所以不广播 dataChange） */
export function saveWeeklyReviews(list: WeeklyReview[]): void {
  localStorage.setItem(WEEKLY_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

/** 生成一条周记的本地 id */
export function newWeeklyReviewId(): string {
  return `wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 是否需要生成新周记：没有周记 → true；最近一篇距今 ≥ 7 天 → true；否则 false */
export function shouldGenerateWeekly(now: number = Date.now()): boolean {
  const list = getWeeklyReviews()
  if (list.length === 0) return true
  return now - list[0].createdAt >= 7 * 24 * 60 * 60 * 1000
}

// ---- 周区间计算（滚动的最近 7 天，如 8月18日-8月24日） ----

/** 本地日历日序号（1970 起的天数），用 UTC 算避免夏令时把一天算成 23/25 小时 */
function dayNumber(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000
}

/** 认识第几周：以 firstSeen 当天为第 1 周起点，每满 7 个日历日进 1 周 */
export function getWeekNumber(now: number, firstSeen: number): number {
  const first = Number.isFinite(firstSeen) && firstSeen > 0 ? firstSeen : now
  return Math.floor((dayNumber(now) - dayNumber(first)) / 7) + 1
}

/** 拼周记标题下的时间范围文案：'第 N 周 · 8月18日-8月24日' */
export function buildWeekLabel(startTs: number, endTs: number, weekNumber: number): string {
  const s = new Date(startTs)
  const e = new Date(endTs)
  return `第 ${weekNumber} 周 · ${s.getMonth() + 1}月${s.getDate()}日-${e.getMonth() + 1}月${e.getDate()}日`
}

export interface WeekRange {
  startTs: number
  endTs: number
  weekLabel: string
  weekNumber: number
}

/** 当前周的时间窗口 + 周数 + 标签：最近的 7 天（今天 0 点往前 6 天到今天 23:59:59），正好 7 天 */
export function getWeekRange(now: number = Date.now(), firstSeen?: number): WeekRange {
  const d = new Date(now)
  const endTs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
  const startTs = endTs - 7 * 24 * 60 * 60 * 1000 + 1
  const weekNumber = getWeekNumber(now, firstSeen ?? now)
  return { startTs, endTs, weekLabel: buildWeekLabel(startTs, endTs, weekNumber), weekNumber }
}

// ---- 素材格式化 ----

export interface WeeklyMessageLine {
  role: 'user' | 'assistant'
  content: string
  ts: number
}

/** 一条消息的精简行：'8月18日 你：…' / '8月18日 TA：…'（内容压缩空白并截断到 60 字，防 prompt 膨胀） */
export function formatMessageLine(m: WeeklyMessageLine): string {
  const d = new Date(m.ts)
  const who = m.role === 'user' ? '你' : 'TA'
  const text = String(m.content ?? '').replace(/\s+/g, ' ').trim()
  const clipped = text.length > 60 ? `${text.slice(0, 60)}…` : text
  return `${d.getMonth() + 1}月${d.getDate()}日 ${who}：${clipped}`
}

// ---- 提示词组装 ----

export interface WeeklyPromptContext {
  /** 本周时间段文案（'第 N 周 · 8月18日-8月24日'） */
  weekLabel: string
  /** 本周聊天摘要：最多 40 条精简消息行（调用方已按时间升序排好） */
  summaryLines: string[]
  /** 本周新增记忆的 text 列表 */
  newMemories: string[]
  /** 认识第 N 天（getFirstSeen 算） */
  daysKnown: number
  /** 上一篇周记下对方的批注（TA 这周要回应；没有就不带） */
  lastReply?: string
  /** 专属人设（可选，注入让口吻更贴 TA） */
  persona?: string
}

/** 周记生成的系统提示词：守住「像 TA 写信、只写有依据的」底线（喂给 chatCompletion 的 system） */
export const WEEKLY_SYSTEM_PROMPT =
  '你在给一个你在意的人写每周的周记，像老朋友写信一样自然。你不是程序、不是 AI，别解释、别自我介绍。' +
  '只写你手头材料里真有的事：材料里没有的，不编、不脑补。' +
  '写「你们」的感受，写心不写事，不流水账、不总结数据。' +
  '100-200 字，标题用「」括起来，放在第一行。'

/** 组装周记生成提示词（纯函数，可单测）：时间段 / 聊天摘要 / 本周记忆 / 相处天数 / 上篇批注 / 写作要求 */
export function buildWeeklyPrompt(ctx: WeeklyPromptContext): string {
  const lines: string[] = []
  lines.push(`【本周时间段】${ctx.weekLabel}`)

  lines.push('【本周聊天摘要】')
  const summary = (Array.isArray(ctx.summaryLines) ? ctx.summaryLines : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  if (summary.length === 0) lines.push('这周你们还没怎么聊。')
  else lines.push(...summary)

  lines.push('【本周记住的事】')
  const memories = (Array.isArray(ctx.newMemories) ? ctx.newMemories : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  if (memories.length === 0) lines.push('这周没有记住什么新的事。')
  else lines.push(...memories.map((m) => `- ${m}`))

  lines.push(`【相处天数】今天是你们认识的第 ${ctx.daysKnown} 天。`)

  if (ctx.lastReply?.trim()) {
    lines.push(`【上一篇批注】对方在你上篇周记下留了批注：${ctx.lastReply.trim()}`)
  }

  if (ctx.persona?.trim()) {
    lines.push(`【你的性格】${ctx.persona.trim()}`)
  }

  lines.push(
    '【写作要求】',
    '以你的口吻，给 TA 写一篇 100-200 字的周记：',
    '1. 给这周取个标题，贴合本周发生的事（像《关于熬夜和米粉的一周》）。',
    '2. 写「你们」的感受，写心不写事——不流水账、不总结数据。',
    '3. 结尾一句关心或念叨 TA 的话。',
    '4. 只写上面材料里有依据的：材料里没发生的，不写、不编。',
    '5. 不刷 emoji（最多 1 个颜文字点缀）；不鸡汤、不喊口号。',
    '直接输出：第一行「标题」，下面接正文。',
  )

  return lines.join('\n')
}

// ---- 结果解析 ----

/** 从生成结果解析标题：第一行里「」或《》括起来的内容、或整行当标题；都没有 → 兜底标题 */
export function extractTitle(content: string, fallbackTitle: string): string {
  const firstLine = String(content ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (firstLine) {
    const inBracket = /「([^」]+)」/.exec(firstLine) ?? /《([^》]+)》/.exec(firstLine)
    if (inBracket) return inBracket[1].trim()
    return firstLine.replace(/[。.!！?？]$/, '').trim()
  }
  return fallbackTitle || '第 N 周'
}

/** 去掉第一行标题，返回正文（不含标题行；没有正文返回空串） */
export function stripTitleLine(content: string): string {
  const lines = String(content ?? '').split('\n')
  const firstIdx = lines.findIndex((l) => l.trim().length > 0)
  if (firstIdx < 0) return ''
  return lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim()
}
