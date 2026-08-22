// 记忆页 v2 · 顶部「TA 眼中的你」纯逻辑（统计 / 一句话点评 / 日期格式化 / LLM 提示词）
// 本文件不碰 localStorage、不发网络请求，可被 Node 脚本直接跑单测。
// 运行时只依赖 memory.ts 的主题推断（同一份规则，保证统计和展示一致）。

import { inferTopic } from './memory.ts'
import type { MemoryItem } from './memory.ts'
import type { ApiMessage } from './api.ts'

export interface MemoryStats {
  /** 记忆总条数（只算字段合法的） */
  count: number
  /** 主题数（旧数据没主题的按关键词推断） */
  topicCount: number
  /** 条数最多的主题：条数 ≥2 才给，全部并列取最先出现的；不满足返回 null */
  topTopic: string | null
  /** 最早一条的时间戳；没有返回 null */
  earliestTs: number | null
  /** 从最早一条算起的相处天数（自然日差 +1，至少 1） */
  daysKnown: number
  /** 重要记忆（用户置顶）条数 */
  pinnedCount: number
}

/** 相处天数：按自然日差 +1，至少 1 天（今天算第 1 天） */
export function computeKnownDays(firstTs: number, now: number = Date.now()): number {
  if (!Number.isFinite(firstTs)) return 1
  const a = new Date(firstTs)
  const b = new Date(now)
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  const diff = Math.round((b0 - a0) / 86400000)
  return Math.max(1, diff + 1)
}

/**
 * 汇总记忆：总条数 / 主题数 / 最常惦记的主题 / 最早一条 / 相处天数 / 重要（置顶）条数。
 * now 可选（默认当前时刻），测试可传固定值保证确定性——相处天数按自然日算。
 */
export function summarizeStats(items: MemoryItem[], now: number = Date.now()): MemoryStats {
  const valid = (Array.isArray(items) ? items : []).filter(
    (m): m is MemoryItem => m != null && typeof m.text === 'string',
  )
  if (valid.length === 0) {
    return { count: 0, topicCount: 0, topTopic: null, earliestTs: null, daysKnown: 1, pinnedCount: 0 }
  }

  const counts = new Map<string, number>()
  const order: string[] = []
  let earliestTs: number | null = null
  let pinnedCount = 0

  for (const m of valid) {
    if (m.pinned === true) pinnedCount++
    const t = m.topic?.trim() || inferTopic(m.text)
    if (!counts.has(t)) {
      counts.set(t, 0)
      order.push(t)
    }
    counts.set(t, counts.get(t)! + 1)
    if (typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)) {
      if (earliestTs == null || m.createdAt < earliestTs) earliestTs = m.createdAt
    }
  }

  // 条数最多者；并列取最先出现的；最高条数 <2 不算「最常惦记」
  let topTopic: string | null = null
  let topCount = 0
  for (const t of order) {
    const c = counts.get(t)!
    if (c > topCount) {
      topCount = c
      topTopic = t
    }
  }
  if (topCount < 2) topTopic = null

  return {
    count: valid.length,
    topicCount: order.length,
    topTopic,
    earliestTs,
    daysKnown: earliestTs != null ? computeKnownDays(earliestTs, now) : 1,
    pinnedCount,
  }
}

/** 一句话点评：topTopic 为 null 时返回 null（调用方不展示） */
export function buildTopTopicLine(topTopic: string | null): string | null {
  if (!topTopic) return null
  return `TA 最常惦记你的${topTopic}`
}

/** 汇总卡日期：8月20日（跨年带年份）；时间戳非法返回空串 */
export function formatSummaryDate(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`
}

/** 汇总卡最早一条：从 8月20日起记得你（无合法时间戳返回空串） */
export function buildKnownSince(ts: number, now: number = Date.now()): string {
  const d = formatSummaryDate(ts, now)
  return d ? `从 ${d}起记得你` : ''
}

/** 单条记忆的日期小字：TA 从 8月20日起记得（跨年带年份；无合法时间戳返回空串） */
export function formatFirstRememberedDate(ts: number, now: number = Date.now()): string {
  const d = formatSummaryDate(ts, now)
  return d ? `TA 从 ${d}起记得` : ''
}

/** 组装「TA 眼中的你」LLM 提示词：system 是 TA 的口吻约束，user 是人设 + 昵称 + 全部记忆 */
export function buildSummaryMessages(
  taName: string,
  yourName: string,
  persona: string,
  items: MemoryItem[],
): ApiMessage[] {
  const system =
    `你是「${taName}」，正以 TA 的口吻给「${yourName}」写一段心里话。` +
    `80 字以内，口语化、真诚、有温度，像真人想起在意的人时心里的话。` +
    `直接写心里话，不罗列事实，不提「记忆」「记录」「记得」这类词。` +
    `禁止 emoji；不要自称 AI/助手/模型。`

  let user = `你心里装着「${yourName}」。你对 TA 的了解：\n`
  for (const m of items) user += `- ${m.text}\n`
  if (persona?.trim()) user += `\n你的性格：\n${persona.trim()}\n`
  user += `\n直接写这段心里话，只要正文，不要引号。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 清洗 LLM 返回的心里话：trim、去成对引号、过滤空串（AI 可能自己加引号） */
export function cleanSummaryText(text: string): string | null {
  let t = String(text ?? '').trim()
  if (!t) return null
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ['“', '”'],
    ['「', '」'],
    ["'", "'"],
    ['‘', '’'],
  ]
  for (const [open, close] of pairs) {
    if (t.startsWith(open) && t.endsWith(close)) {
      t = t.slice(1, -1).trim()
      break
    }
  }
  return t || null
}
