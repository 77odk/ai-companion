// 周记数据与生成（W1 → W1-2 增强）
// TA 每 7 天周期最多产出一篇「我们这周」的日记，用户可批注（立即回复 / 封存慢信），TA 下一篇周记一并回信。
// 纯逻辑（getWeeklyReviews / cooldownInfo / getPendingReplies / buildWeeklyPrompt /
//        parseWeeklyOutput / extractTitle / 周区间计算）
// 不依赖组件，可被 Node 脚本直接跑单测；localStorage 读写只在函数内。
// 周记数据存 localStorage（一期不做后端）；生成走用户 key 非流式调用（调 API 在组件里做）。

import { migrateGlobalToDefaultSession } from './roleData.ts'

export interface WeeklyReply {
  content: string
  repliedAt: number
  /** 立即回复模式下 TA 的简短回复（挂在本条批注下方展示；生成失败时没有） */
  taReply?: string
  /** 立即回复生成失败（无 key/429/网络）→ 展示兜底文案「TA 暂时没回上」 */
  taReplyFailed?: boolean
}

/** 封存留言（慢信）：用户封存的一条批注，下一篇周记生成时由 TA 一并回信 */
export interface PendingReply {
  id: string
  content: string
  /** 封存时间戳 */
  repliedAt: number
  /** 下一篇周记生成时 TA 写的回信（展示在该留言下方） */
  reply?: string
  /** 已回信：信封标记消失的依据（回信后标记而非删除，绝不丢） */
  replied?: boolean
  /** 回信落笔时间（answerPendingReplies 写入） */
  replyAt?: number
}

export interface WeeklyReview {
  id: string
  /** '第 N 周 · 8月18日-8月24日' */
  weekLabel: string
  title: string
  content: string
  createdAt: number
  /** 用户批注：立即回复模式的批注内容（纯本地存储，调 API 生成 TA 简短回复） */
  myReply?: WeeklyReply
  /** 封存留言（慢信）：封存时只入库不调模型，下一篇周记生成时回信 */
  replies?: PendingReply[]
  /** 这篇周记覆盖的时间窗口（生成时定下，供下次筛选本周素材） */
  generatedFrom?: { startTs: number; endTs: number }
}

const WEEKLY_KEY = 'ai_companion_weekly_reviews'
// TASK-UI2 角色隔离：按会话分 key（ai_companion_weekly_reviews_<sid>），无会话回落全局 key（兼容老逻辑）。
const weeklyKey = (sessionId?: string) => (sessionId ? `${WEEKLY_KEY}_${sessionId}` : WEEKLY_KEY)
/** 老全局周记已迁移到默认角色 key 的标记（防重复迁移） */
const WEEKLY_MIGRATED_KEY = 'ai_companion_weekly_migrated'

/** 首次按会话读取时，把老全局周记迁到「默认角色」名下（幂等，TASK-UI2） */
function ensureSessionData(sessionId?: string): void {
  if (!sessionId) return
  migrateGlobalToDefaultSession(WEEKLY_KEY, weeklyKey, WEEKLY_MIGRATED_KEY)
}

/** 读取全部周记（会话感知）：有会话读角色 key（首次自动迁移老数据），无会话读全局 key。损坏/格式不对的条目被过滤；返回按 createdAt 降序 */
export function getWeeklyReviews(sessionId?: string): WeeklyReview[] {
  if (sessionId) ensureSessionData(sessionId)
  try {
    const raw = localStorage.getItem(weeklyKey(sessionId))
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

/** 保存全部周记到指定 store（缺省全局 key；纯本地，不进账号同步，所以不广播 dataChange） */
export function saveWeeklyReviews(list: WeeklyReview[], sessionId?: string): void {
  localStorage.setItem(weeklyKey(sessionId), JSON.stringify(Array.isArray(list) ? list : []))
}

/** 生成一条周记的本地 id */
export function newWeeklyReviewId(): string {
  return `wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 周记硬冷却：每 7 天周期 TA 仅产出 1 篇（冷却期零 token，时间没到不调模型） */
export const WEEKLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/** 是否需要生成新周记（会话感知）：没有周记 → true；最近一篇距今 ≥ 7 天 → true；否则 false */
export function shouldGenerateWeekly(now: number = Date.now(), sessionId?: string): boolean {
  const list = getWeeklyReviews(sessionId)
  if (list.length === 0) return true
  return now - list[0].createdAt >= WEEKLY_COOLDOWN_MS
}

/**
 * 冷却信息（会话感知）：能否生成 + 剩余时间文案。
 * 剩余时间格式「X天X小时」；不足 1 天显示「X小时X分钟」。
 * 与 shouldGenerateWeekly 判定一致（满 7 天 → canGenerate=true）。
 */
export function cooldownInfo(
  now: number = Date.now(),
  sessionId?: string,
): { canGenerate: boolean; remainText: string } {
  const list = getWeeklyReviews(sessionId)
  if (list.length === 0) return { canGenerate: true, remainText: '' }
  const elapsed = now - list[0].createdAt
  if (elapsed >= WEEKLY_COOLDOWN_MS) return { canGenerate: true, remainText: '' }
  const remain = WEEKLY_COOLDOWN_MS - elapsed
  const totalHours = Math.floor(remain / 3600000)
  const days = Math.floor(totalHours / 24)
  const hours = totalHours % 24
  if (days >= 1) return { canGenerate: false, remainText: `${days}天${hours}小时` }
  const minutes = Math.floor((remain % 3600000) / 60000)
  return { canGenerate: false, remainText: `${hours}小时${minutes}分钟` }
}

// ---- 封存留言（慢信） ----

/** 收集全部未回信的封存留言（跨所有周记，绝不丢；正常按 7 天冷却，实际都在最近一篇上） */
export function getPendingReplies(reviews: WeeklyReview[]): PendingReply[] {
  const list = Array.isArray(reviews) ? reviews : []
  const result: PendingReply[] = []
  for (const r of list) {
    if (!Array.isArray(r.replies)) continue
    for (const p of r.replies) {
      if (p == null || typeof p.content !== 'string') continue
      if (p.replied === true) continue
      result.push({ id: p.id, content: p.content, repliedAt: Number.isFinite(p.repliedAt) ? p.repliedAt : 0 })
    }
  }
  return result
}

/**
 * 把生成出来的回信按顺序挂到对应封存留言上并标记已回信（不删除）。
 * pending 与 replies 按下标一一对应；回信少于留言时，未匹配的保持待回信（下篇再回）。
 * 返回新的 reviews 数组（纯函数）。
 */
export function answerPendingReplies(
  reviews: WeeklyReview[],
  pending: PendingReply[],
  replies: string[],
  now: number = Date.now(),
): WeeklyReview[] {
  const list = Array.isArray(reviews) ? reviews : []
  const replyById: Record<string, string> = {}
  const pend = Array.isArray(pending) ? pending : []
  const replyList = Array.isArray(replies) ? replies : []
  pend.forEach((p, i) => {
    if (p && i < replyList.length && typeof replyList[i] === 'string' && replyList[i].trim()) {
      replyById[p.id] = replyList[i]
    }
  })
  return list.map((r) => {
    if (!Array.isArray(r.replies)) return r
    let changed = false
    const nextReplies = r.replies.map((p) => {
      if (p.replied === true || !(p.id in replyById)) return p
      changed = true
      return { ...p, replied: true, reply: replyById[p.id], repliedAt: p.repliedAt ?? 0, replyAt: now }
    })
    return changed ? { ...r, replies: nextReplies } : r
  })
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
  /** 封存留言（慢信）：TA 这周要逐条完整回信；没有就不带 */
  pendingReplies?: string[]
  /** 专属人设（可选，注入让口吻更贴 TA） */
  persona?: string
}

/** 周记生成的系统提示词：守住「像 TA 写信、只写有依据的」底线（喂给 chatCompletion 的 system） */
export const WEEKLY_SYSTEM_PROMPT =
  '你在给一个你在意的人写每周的周记，像老朋友写信一样自然。你不是程序、不是 AI，别解释、别自我介绍。' +
  '只写你手头材料里真有的事：材料里没有的，不编、不脑补。' +
  '写「你们」的感受，写心不写事，不流水账、不总结数据。' +
  '100-200 字，标题用「」括起来，放在第一行。'

/** 立即回复模式的系统提示词（定稿 System 片段①思路）：用户刚在周记下留批注，TA 简短回应一句 */
export const WEEKLY_REPLY_SYSTEM_PROMPT =
  '你在给一个你在意的人写每周的周记，对方刚在你的周记下留了一句批注，你要简短自然地回应这句批注。' +
  '你不是程序、不是 AI，别解释、别自我介绍、别谈机制。' +
  '回应要短（50 字以内）、口语、像真人：直接回应对方说的话，可以带一句关心或念叨。' +
  '不要复述对方的批注，不刷 emoji，不鸡汤。'

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

  // 封存留言（慢信）：逐一完整回信，语气饱满、篇幅可长、情绪细腻（定稿 System 片段②思路）
  const pending = (Array.isArray(ctx.pendingReplies) ? ctx.pendingReplies : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  if (pending.length > 0) {
    lines.push(
      '【封存留言·等你回信】',
      '对方之前在你某篇周记下封存了几条留言，一直等着你回信：',
      ...pending.map((p, i) => `- 留言${i + 1}：${p}`),
      '每一封都要认真完整地回信：语气饱满、篇幅可以长一些（每封 80-150 字）、情绪细腻，像拆开一封等了很久的信一样郑重。',
    )
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
  )
  if (pending.length > 0) {
    lines.push(
      '6. 输出格式：第一行「标题」，下面接正文；正文之后另起一行写「回信：」，然后逐条回信——每条回信用一行「---」分隔，每条回信先简短提一句那条封存留言说了什么，再写完整的回信内容。',
    )
  } else {
    lines.push('6. 直接输出：第一行「标题」，下面接正文。')
  }

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

// ---- 周记 + 回信解析 ----

export interface WeeklyParsed {
  title: string
  content: string
  /** 回信列表（顺序对应生成时传入的封存留言顺序） */
  replies: string[]
}

/** 是否「回信：」段起始行（单独成行的「回信：/回信:」或「【回信】」） */
function isReplySectionLine(l: string): boolean {
  return /^回信[:：]?$/.test(l) || /^【回信】$/.test(l)
}

/** 回信块的分隔/标注行：一行「---/——」，或「封存留言：」「留言N：」「回信N：」 */
function isReplyLabelLine(l: string): boolean {
  return /^(封存)?留言\s*[一二三四五六七八九十\d]*\s*[:：]/.test(l) || /^回信\s*[一二三四五六七八九十\d]*\s*[:：]/.test(l)
}

function isReplySeparatorLine(l: string): boolean {
  return /^[-—–]{2,}$/.test(l)
}

/** 把「回信：」之后的段落拆成逐条回信（纯函数）：按分隔线/标注行分块，空块跳过 */
function splitReplies(replyPart: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    let block = current.join('\n').trim()
    if (block) {
      // 块首若是「封存留言：/留言N：」标注行，摘掉（回信内容本身展示用，不要重复对方的留言原文）
      const firstLine = block.split('\n')[0].trim()
      if (isReplyLabelLine(firstLine)) {
        block = block.split('\n').slice(1).join('\n').trim()
      }
      if (block) blocks.push(block)
    }
    current = []
  }

  for (const line of replyPart.split('\n')) {
    const t = line.trim()
    if (isReplySeparatorLine(t)) {
      flush()
      continue
    }
    if (isReplyLabelLine(t)) {
      if (current.some((l) => l.trim().length > 0)) flush()
    }
    current.push(line)
  }
  flush()
  return blocks
}

/**
 * 解析生成输出：分离周记（标题+正文）与回信列表。
 * 无「回信：」段 → 整个当周记，replies 为空数组；有 → 标题/正文取回信段之前，回信按段解析。
 */
export function parseWeeklyOutput(text: string, fallbackTitle: string = '第 N 周'): WeeklyParsed {
  const raw = String(text ?? '')
  const lines = raw.split('\n')
  const replyIdx = lines.findIndex((l) => isReplySectionLine(l.trim()))

  if (replyIdx < 0) {
    return { title: extractTitle(raw, fallbackTitle), content: stripTitleLine(raw), replies: [] }
  }

  const reviewPart = lines.slice(0, replyIdx).join('\n')
  const replyPart = lines.slice(replyIdx + 1).join('\n')
  return {
    title: extractTitle(reviewPart, fallbackTitle),
    content: stripTitleLine(reviewPart),
    replies: splitReplies(replyPart),
  }
}
