// 纪念日（重要的日子）读写，localStorage 存储
// date 支持两种格式：
//   'MM-DD'        每年循环（如生日、认识纪念日）
//   'YYYY-MM-DD'   一次性（如某次约定的日子）
// 纯逻辑（buildDefaultAnniversary / daysUntil / formatAnniversaryDate / isValidAnniversaryDate）
// 不碰 localStorage，可被 Node 脚本直接跑单测；读写与广播才依赖浏览器。

import { MEMORY_UPDATED_EVENT } from './memory.ts'
import { getFirstSeen } from './storage.ts'

export interface Anniversary {
  id: string
  /** 名称：认识纪念日 / 生日 / 在一起纪念日… */
  label: string
  /** 'MM-DD'（每年循环）或 'YYYY-MM-DD'（一次性） */
  date: string
  /** 创建时间戳 */
  createdAt: number
}

const ANNIVERSARIES_KEY = 'ai_companion_anniversaries'
/** 是否已生成过默认「认识纪念日」：用户把纪念日删光后，下次进来不再自动复活默认 */
const DEFAULT_SEEDED_KEY = 'ai_companion_anniversaries_seeded'

function newId(): string {
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** 广播"纪念日有变化"：与记忆共用同一个事件名，记忆页/聊天页监听到就同步刷新 */
function broadcastAnniversariesUpdated(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new Event(MEMORY_UPDATED_EVENT))
}

/** 读取全部纪念日；数据损坏/格式不对就返回空数组 */
export function loadAnniversaries(): Anniversary[] {
  try {
    const raw = localStorage.getItem(ANNIVERSARIES_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (a): a is Anniversary =>
        a != null && typeof a.id === 'string' && typeof a.label === 'string' && isValidAnniversaryDate(a.date),
    )
  } catch {
    return []
  }
}

/** 保存全部纪念日（调用方负责广播） */
export function saveAnniversaries(list: Anniversary[]): void {
  localStorage.setItem(ANNIVERSARIES_KEY, JSON.stringify(list))
}

/** 新增一条纪念日：新条目放最前，保存并广播，返回更新后的全部纪念日 */
export function addAnniversary(label: string, date: string): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return loadAnniversaries()
  const item: Anniversary = {
    id: newId(),
    label: l,
    date: d,
    createdAt: Date.now(),
  }
  const next = [item, ...loadAnniversaries()]
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

/** 更新一条纪念日的名称/日期；找不到 id 就原样返回。保存并广播，返回更新后的全部纪念日 */
export function updateAnniversary(id: string, label: string, date: string): Anniversary[] {
  const l = label.trim()
  const d = date.trim()
  if (!l || !isValidAnniversaryDate(d)) return loadAnniversaries()
  const next = loadAnniversaries().map((a) => (a.id === id ? { ...a, label: l, date: d } : a))
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

/** 删除一条纪念日；找不到 id 就原样返回。保存并广播，返回更新后的全部纪念日 */
export function removeAnniversary(id: string): Anniversary[] {
  const next = loadAnniversaries().filter((a) => a.id !== id)
  saveAnniversaries(next)
  broadcastAnniversariesUpdated()
  return next
}

/** 解析纪念日日期字符串 → { year?, month, day }；非法返回 null */
function parseAnniversaryDate(date: string): { year?: number; month: number; day: number } | null {
  if (typeof date !== 'string') return null
  const t = date.trim()
  const mm = /^(\d{1,2})-(\d{1,2})$/.exec(t)
  if (mm) {
    const month = Number(mm[1])
    const day = Number(mm[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day }
    return null
  }
  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (full) {
    const year = Number(full[1])
    const month = Number(full[2])
    const day = Number(full[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day }
    return null
  }
  return null
}

/** 日期是否合法：'MM-DD'（每年循环）或 'YYYY-MM-DD'（一次性） */
export function isValidAnniversaryDate(date: string): boolean {
  return parseAnniversaryDate(date) != null
}

/** 本地日历日序号（从 1970 起的天数），用 UTC 算，避免夏令时把一天算成 23/25 小时 */
function dayNumber(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 86400000
}

/** 把相差天数转成倒计时文案：0=今天，1=明天，正=还剩 N 天，负=已过 N 天 */
function countdownLabel(diff: number): string {
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff > 0) return `还剩 ${diff} 天`
  return `已过 ${-diff} 天`
}

/**
 * 纪念日倒计时文案：
 * - 'MM-DD'（每年循环）：按今年算——还没到显示「还剩 N 天」，已过（非今天）显示「已过 N 天」
 * - 'YYYY-MM-DD'（一次性）：按绝对日期算，未来显示「还剩 N 天」，过去显示「已过 N 天」
 * 日期非法返回空串。
 */
export function daysUntil(date: string, now: number = Date.now()): string {
  const parsed = parseAnniversaryDate(date)
  if (!parsed) return ''
  const d = new Date(now)
  const today = dayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate())
  const year = parsed.year ?? d.getFullYear()
  return countdownLabel(dayNumber(year, parsed.month, parsed.day) - today)
}

/**
 * 纪念日展示日期：'MM-DD' →「8月22日」（每年循环不去年份）；
 * 'YYYY-MM-DD' →「2026年8月22日」（一次性带完整年）。非法返回空串。
 */
export function formatAnniversaryDate(date: string): string {
  const parsed = parseAnniversaryDate(date)
  if (!parsed) return ''
  const base = `${parsed.month}月${parsed.day}日`
  return parsed.year != null ? `${parsed.year}年${base}` : base
}

/**
 * 纯函数：由 firstSeen 时间戳生成默认「认识纪念日」（date 取 MM-DD，每年循环）。
 * 与 getDefaultAnniversary 拆开，方便 Node 单测。
 */
export function buildDefaultAnniversary(firstSeen: number, now: number = Date.now()): Anniversary {
  const d = new Date(firstSeen)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return {
    id: `default-${mm}-${dd}-${firstSeen}`,
    label: '认识纪念日',
    date: `${mm}-${dd}`,
    createdAt: now,
  }
}

/**
 * 首次进入（还没有任何纪念日、也没发过默认）时，用 getFirstSeen() 生成并保存默认「认识纪念日」；
 * 已有纪念日、或用户曾经把纪念日删光过，都返回 null（删光了不自动复活）。
 */
export function getDefaultAnniversary(): Anniversary | null {
  if (loadAnniversaries().length > 0) return null
  try {
    if (localStorage.getItem(DEFAULT_SEEDED_KEY)) return null
  } catch {
    // 读不到标记按首次处理
  }
  const a = buildDefaultAnniversary(getFirstSeen())
  saveAnniversaries([a])
  try {
    localStorage.setItem(DEFAULT_SEEDED_KEY, '1')
  } catch {
    // 标记存不下也不影响本次生成
  }
  return a
}
