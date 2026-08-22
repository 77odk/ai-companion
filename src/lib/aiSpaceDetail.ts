// TA 的详情页 · 纯逻辑（相处数据 / 聊天记录按天分组 / 记忆时间线）
// 本文件不碰 localStorage、不发网络请求，方便被 Node 脚本直接跑单测。
// 运行时只依赖 memory.ts 的文案清洗；其余 import 均为类型引用，Node 类型剥离时会擦除。

import { stripMemoryMarkers } from './memory.ts'
import type { SpacePost } from './aiSpaceCore.ts'
import type { MemoryItem } from './memory.ts'
import type { StoredMessage } from './storage.ts'

/** 本地日期 key：YYYY-MM-DD（跨天按本地时区分组） */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y || 0, (m || 1) - 1, d || 1)
}

/** 日期 key 加减 N 天：用日历日运算，避免跨天/时区误差 */
function shiftDayKey(key: string, delta: number): string {
  const d = parseDayKey(key)
  d.setDate(d.getDate() + delta)
  return dayKey(d.getTime())
}

/** 日期标题：今天 / 昨天 / 8月22日 */
export function formatDayLabel(key: string, now: number = Date.now()): string {
  const today = dayKey(now)
  if (key === today) return '今天'
  if (key === shiftDayKey(today, -1)) return '昨天'
  const d = parseDayKey(key)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 当天最后一条消息的预览：压平换行空白、截断到 max 字（超出加省略号） */
export function truncatePreview(text: string, max = 20): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

export interface DayGroup {
  /** 本地日期 key：YYYY-MM-DD */
  key: string
  /** 展示标题：今天 / 昨天 / 8月22日 */
  label: string
  /** 当天全部消息，按时间正序 */
  messages: StoredMessage[]
  /** 当天最后一条消息的预览（20 字截断，去掉 TA 记住的标记行） */
  preview: string
}

/**
 * 把聊天记录按本地日期分组，日期倒序（最近的组在最上）。
 * 组内保持输入顺序（历史消息数组即时间正序），预览取当天最后一条。
 */
export function groupMessagesByDay(messages: StoredMessage[], now: number = Date.now()): DayGroup[] {
  const map = new Map<string, StoredMessage[]>()
  for (const m of messages) {
    if (m == null || typeof m.ts !== 'number' || !Number.isFinite(m.ts)) continue
    const k = dayKey(m.ts)
    const list = map.get(k)
    if (list) list.push(m)
    else map.set(k, [m])
  }
  const groups: DayGroup[] = []
  for (const [key, list] of map) {
    const last = list[list.length - 1]
    groups.push({
      key,
      label: formatDayLabel(key, now),
      messages: list,
      preview: truncatePreview(stripMemoryMarkers(last?.content ?? '')),
    })
  }
  groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
  return groups
}

/** 相处天数：按自然日差 +1，至少 1 天（今天认识的显示第 1 天） */
export function computeDaysKnown(firstSeen: number, now: number = Date.now()): number {
  if (!Number.isFinite(firstSeen) || !Number.isFinite(now)) return 1
  const a = new Date(firstSeen)
  const b = new Date(now)
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  const diff = Math.round((b0 - a0) / (24 * 60 * 60 * 1000))
  return Math.max(1, diff + 1)
}

export interface FirstSeenCandidates {
  messages: StoredMessage[]
  memories: MemoryItem[]
  posts: SpacePost[]
}

/** 从聊天记录 / 记忆 / 动态里挑最早的时间戳作为 firstSeen；全空返回 null */
export function pickFirstSeen(candidates: FirstSeenCandidates): number | null {
  const tss: number[] = []
  for (const m of candidates.messages) {
    if (m && typeof m.ts === 'number' && Number.isFinite(m.ts)) tss.push(m.ts)
  }
  for (const m of candidates.memories) {
    if (m && typeof m.createdAt === 'number' && Number.isFinite(m.createdAt)) tss.push(m.createdAt)
  }
  for (const p of candidates.posts) {
    if (p && typeof p.at === 'number' && Number.isFinite(p.at)) tss.push(p.at)
  }
  if (tss.length === 0) return null
  return Math.min(...tss)
}

/** 记忆时间线的小字：记于 8月21日（跨年带年份）；时间戳非法返回空串 */
export function formatMemoryDate(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
  const d = new Date(ts)
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date(now).getFullYear() ? `记于 ${md}` : `记于 ${d.getFullYear()}年${md}`
}
